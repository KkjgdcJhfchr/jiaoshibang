import net from 'node:net';
import tls from 'node:tls';
import { randomBytes, randomUUID } from 'node:crypto';

export class MessageServiceError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'MessageServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function buildStoredSmtpConfig(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MessageServiceError(400, 'INVALID_SMTP_CONFIG', 'SMTP 配置必须是对象');
  }
  const existing = options.existing && typeof options.existing === 'object' ? options.existing : null;
  const sealPassword = options.sealPassword;
  if (typeof sealPassword !== 'function') throw new Error('sealPassword is required');

  const host = cleanHeaderValue(input.host, 253).toLowerCase();
  if (!host || !isValidHostname(host)) {
    throw new MessageServiceError(400, 'INVALID_SMTP_HOST', '请填写有效的 SMTP 主机名或 IP 地址');
  }
  const security = String(input.security || input.encryption || 'starttls').toLowerCase();
  if (!['tls', 'starttls', 'plain'].includes(security)) {
    throw new MessageServiceError(400, 'INVALID_SMTP_SECURITY', 'SMTP 加密方式仅支持 tls、starttls 或 plain');
  }
  if (security === 'plain' && options.allowInsecure !== true) {
    throw new MessageServiceError(400, 'INSECURE_SMTP_BLOCKED', 'SMTP 必须启用 TLS 或 STARTTLS');
  }
  const defaultPort = security === 'tls' ? 465 : security === 'starttls' ? 587 : 25;
  const port = Number(input.port ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MessageServiceError(400, 'INVALID_SMTP_PORT', 'SMTP 端口必须在 1-65535 之间');
  }
  const username = cleanHeaderValue(input.username, 320);
  const fromEmail = normalizeEmail(input.fromEmail ?? input.senderEmail);
  const fromName = cleanHeaderValue(input.fromName ?? input.senderName ?? '教师帮', 100) || '教师帮';
  if (!fromEmail) throw new MessageServiceError(400, 'INVALID_SMTP_FROM_EMAIL', '请填写有效的发件邮箱');

  let encryptedPassword = existing?.encryptedPassword || null;
  const passwordProvided = Object.prototype.hasOwnProperty.call(input, 'password');
  if (input.clearPassword === true) encryptedPassword = null;
  else if (passwordProvided) {
    const password = typeof input.password === 'string' ? input.password : '';
    if (!password || password.length > 4096 || /[\r\n\0]/.test(password)) {
      throw new MessageServiceError(400, 'INVALID_SMTP_PASSWORD', '请填写有效的 SMTP 密码或授权码');
    }
    encryptedPassword = sealPassword(password);
  }
  if (username && !encryptedPassword) {
    throw new MessageServiceError(400, 'SMTP_PASSWORD_REQUIRED', '配置 SMTP 用户名时必须填写密码或授权码');
  }

  const timestamp = new Date().toISOString();
  const configurationChanged = !existing
    || passwordProvided
    || input.clearPassword === true
    || host !== existing.host
    || port !== existing.port
    || security !== existing.security
    || username !== (existing.username || '')
    || fromName !== existing.fromName
    || fromEmail !== existing.fromEmail;
  return {
    version: 1,
    host,
    port,
    security,
    username,
    encryptedPassword,
    fromName,
    fromEmail,
    updatedAt: timestamp,
    updatedBy: cleanHeaderValue(options.updatedBy, 100) || 'admin',
    testedAt: configurationChanged ? null : existing?.testedAt || null,
  };
}

export function publicSmtpConfig(config) {
  if (!config) {
    return {
      configured: false,
      host: '',
      port: null,
      security: 'starttls',
      username: '',
      passwordConfigured: false,
      fromName: '教师帮',
      fromEmail: '',
      updatedAt: null,
      testedAt: null,
    };
  }
  return {
    configured: Boolean(config.host && config.fromEmail),
    host: config.host,
    port: config.port,
    security: config.security,
    username: config.username || '',
    passwordConfigured: Boolean(config.encryptedPassword),
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    updatedAt: config.updatedAt || null,
    testedAt: config.testedAt || null,
  };
}

export function createMessageService(options = {}) {
  const loadSmtpConfig = options.loadSmtpConfig;
  const openPassword = options.openPassword;
  const allowInsecure = options.allowInsecure === true;
  const timeoutMs = positiveInteger(options.timeoutMs, 15_000);
  if (typeof loadSmtpConfig !== 'function' || typeof openPassword !== 'function') {
    throw new Error('loadSmtpConfig and openPassword are required');
  }

  async function sendEmail({ to, subject, text }) {
    const config = loadSmtpConfig();
    if (!config) throw new MessageServiceError(503, 'SMTP_NOT_CONFIGURED', '尚未配置 SMTP 发信服务');
    if (config.security === 'plain' && !allowInsecure) {
      throw new MessageServiceError(503, 'INSECURE_SMTP_BLOCKED', '当前 SMTP 配置未启用加密，服务器拒绝发信');
    }
    const recipient = normalizeEmail(to);
    if (!recipient) throw new MessageServiceError(400, 'INVALID_EMAIL_RECIPIENT', '收件邮箱格式无效');
    const safeSubject = cleanHeaderValue(subject, 180);
    const safeText = String(text || '').replace(/\r?\n/g, '\r\n').slice(0, 100_000);
    if (!safeSubject || !safeText) throw new MessageServiceError(400, 'INVALID_EMAIL_CONTENT', '邮件主题和正文不能为空');
    let password = '';
    if (config.username) {
      try {
        password = openPassword(config);
      } catch {
        throw new MessageServiceError(503, 'SMTP_SECRET_ERROR', 'SMTP 密码无法解密，请管理员重新保存通信配置');
      }
    }
    try {
      return await sendSmtpMessage({ config, password, to: recipient, subject: safeSubject, text: safeText, timeoutMs });
    } catch (error) {
      if (error instanceof MessageServiceError) throw error;
      throw new MessageServiceError(502, 'SMTP_SEND_FAILED', 'SMTP 发信失败，请检查服务器地址、加密方式和凭据', {
        reason: sanitizeSmtpError(error),
      });
    }
  }

  async function sendVerificationCode({ to, code, purpose = '登录', expiresMinutes = 10 }) {
    return sendEmail({
      to,
      subject: `教师帮${purpose}验证码`,
      text: [
        `您的教师帮${purpose}验证码是：${code}`,
        '',
        `验证码将在 ${expiresMinutes} 分钟后失效，且只能使用一次。`,
        '如果不是您本人操作，请忽略本邮件并及时检查管理员账号安全。',
      ].join('\n'),
    });
  }

  async function sendTestEmail({ to }) {
    return sendEmail({
      to,
      subject: '教师帮 SMTP 测试邮件',
      text: [
        '这是一封来自教师帮管理后台的 SMTP 测试邮件。',
        '',
        `发送时间：${new Date().toISOString()}`,
        '收到此邮件说明当前通信配置可以正常发信。',
      ].join('\n'),
    });
  }

  return { sendEmail, sendTestEmail, sendVerificationCode };
}

async function sendSmtpMessage({ config, password, to, subject, text, timeoutMs }) {
  let socket;
  let protocol;
  try {
    socket = config.security === 'tls'
      ? await connectTls(config, timeoutMs)
      : await connectPlain(config, timeoutMs);
    protocol = new SmtpProtocol(socket, timeoutMs);
    await expectReply(await protocol.readReply(), [220], 'SMTP 服务未返回欢迎消息');

    let ehlo = await protocol.command(`EHLO ${smtpClientName()}`);
    await expectReply(ehlo, [250], 'SMTP EHLO 失败');

    if (config.security === 'starttls') {
      if (!ehlo.lines.join('\n').toUpperCase().includes('STARTTLS')) {
        throw new MessageServiceError(502, 'SMTP_STARTTLS_UNAVAILABLE', 'SMTP 服务器未提供 STARTTLS');
      }
      await expectReply(await protocol.command('STARTTLS'), [220], 'SMTP STARTTLS 升级失败');
      protocol.detach();
      socket = await upgradeTls(socket, config, timeoutMs);
      protocol = new SmtpProtocol(socket, timeoutMs);
      ehlo = await protocol.command(`EHLO ${smtpClientName()}`);
      await expectReply(ehlo, [250], 'SMTP TLS 握手后的 EHLO 失败');
    }

    if (config.username) await authenticate(protocol, ehlo, config.username, password);
    await expectReply(await protocol.command(`MAIL FROM:<${config.fromEmail}>`), [250], 'SMTP 拒绝发件地址');
    await expectReply(await protocol.command(`RCPT TO:<${to}>`), [250, 251], 'SMTP 拒绝收件地址');
    await expectReply(await protocol.command('DATA'), [354], 'SMTP 未接受邮件正文');

    const messageId = `<${randomUUID()}@${messageIdDomain(config.fromEmail)}>`;
    socket.write(`${buildRawMessage({ config, to, subject, text, messageId })}\r\n.\r\n`);
    await expectReply(await protocol.readReply(), [250], 'SMTP 未接受邮件');
    protocol.command('QUIT').catch(() => {});
    return { accepted: true, messageId };
  } finally {
    protocol?.detach();
    socket?.end();
  }
}

async function authenticate(protocol, ehlo, username, password) {
  const capabilities = ehlo.lines.join('\n').toUpperCase();
  if (capabilities.includes('AUTH') && capabilities.includes('PLAIN')) {
    const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
    await expectReply(await protocol.command(`AUTH PLAIN ${token}`), [235], 'SMTP 身份验证失败');
    return;
  }
  if (capabilities.includes('AUTH') && capabilities.includes('LOGIN')) {
    await expectReply(await protocol.command('AUTH LOGIN'), [334], 'SMTP 不支持 LOGIN 认证');
    await expectReply(await protocol.command(Buffer.from(username).toString('base64')), [334], 'SMTP 用户名被拒绝');
    await expectReply(await protocol.command(Buffer.from(password).toString('base64')), [235], 'SMTP 密码被拒绝');
    return;
  }
  throw new MessageServiceError(502, 'SMTP_AUTH_UNAVAILABLE', 'SMTP 服务器未提供受支持的 AUTH PLAIN 或 AUTH LOGIN');
}

function buildRawMessage({ config, to, subject, text, messageId }) {
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `From: ${encodeDisplayName(config.fromName)} <${config.fromEmail}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const dotStuffed = text.replace(/^\./gm, '..');
  return `${headers.join('\r\n')}\r\n\r\n${dotStuffed}`;
}

class SmtpProtocol {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.current = [];
    this.replies = [];
    this.waiters = [];
    this.onData = (chunk) => this.consume(chunk);
    this.onError = (error) => this.fail(error);
    this.onClose = () => this.fail(new Error('SMTP connection closed'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  consume(chunk) {
    this.buffer += chunk.toString('utf8');
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) continue;
      this.current.push(line);
      if (match[2] === ' ') {
        const reply = { code: Number(match[1]), lines: this.current };
        this.current = [];
        const waiter = this.waiters.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(reply);
        } else this.replies.push(reply);
      }
    }
  }

  readReply() {
    if (this.replies.length) return Promise.resolve(this.replies.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((entry) => entry.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('SMTP response timeout'));
      }, this.timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  async command(value) {
    if (/\r|\n/.test(value)) throw new Error('SMTP command contains a newline');
    this.socket.write(`${value}\r\n`);
    return this.readReply();
  }

  fail(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.fail(new Error('SMTP protocol detached'));
  }
}

function connectPlain(config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.host, port: config.port });
    const timer = setTimeout(() => socket.destroy(new Error('SMTP connection timeout')), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function connectTls(config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: net.isIP(config.host) ? undefined : config.host,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
    const timer = setTimeout(() => socket.destroy(new Error('SMTP TLS connection timeout')), timeoutMs);
    socket.once('secureConnect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function upgradeTls(socket, config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: net.isIP(config.host) ? undefined : config.host,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
    const timer = setTimeout(() => secureSocket.destroy(new Error('SMTP STARTTLS timeout')), timeoutMs);
    secureSocket.once('secureConnect', () => { clearTimeout(timer); resolve(secureSocket); });
    secureSocket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

async function expectReply(reply, allowedCodes, message) {
  if (!allowedCodes.includes(reply.code)) {
    throw new MessageServiceError(502, 'SMTP_PROTOCOL_ERROR', message, {
      smtpCode: reply.code,
      response: reply.lines.join(' ').slice(0, 300),
    });
  }
  return reply;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 320 || /[\r\n\0]/.test(email)) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : '';
}

function cleanHeaderValue(value, maxLength) {
  return String(value || '').trim().replace(/[\r\n\0]/g, '').slice(0, maxLength);
}

function isValidHostname(host) {
  if (net.isIP(host)) return true;
  if (host.length > 253 || host.startsWith('.') || host.endsWith('.')) return false;
  return host.split('.').every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function encodeDisplayName(value) {
  return /[^\x20-\x7e]/.test(value) ? encodeHeader(value) : `"${value.replace(/["\\]/g, '\\$&')}"`;
}

function smtpClientName() {
  return 'teacher-helper.local';
}

function messageIdDomain(email) {
  return email.split('@')[1] || 'teacher-helper.local';
}

function sanitizeSmtpError(error) {
  const value = String(error?.message || 'unknown error');
  return value.replace(/[\r\n]/g, ' ').slice(0, 240);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export { normalizeEmail as normalizeEmailAddress };

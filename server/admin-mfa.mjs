import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export class AdminMfaError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AdminMfaError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createAdminMfaCoordinator(options = {}) {
  const pepper = String(options.pepper || '');
  if (pepper.length < 32) throw new Error('MFA challenge pepper must contain at least 32 characters');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const loginTtlMs = positiveInteger(options.loginTtlMs, 5 * 60 * 1000);
  const emailTtlMs = positiveInteger(options.emailTtlMs, 10 * 60 * 1000);
  const enrollmentTtlMs = positiveInteger(options.enrollmentTtlMs, 10 * 60 * 1000);
  const maxAttempts = positiveInteger(options.maxAttempts, 5);
  const issueWindowMs = positiveInteger(options.issueWindowMs, 10 * 60 * 1000);
  const maxIssues = positiveInteger(options.maxIssues, 5);
  const maxEmailIssues = positiveInteger(options.maxEmailIssues, 3);
  const challenges = new Map();
  const issueBuckets = new Map();

  function issue({ purpose, channel, username, binding, payload = {}, ttlMs }) {
    cleanup();
    enforceIssueLimit({ purpose, channel, username, binding });
    const issuedAt = now();
    const id = `mfa_${randomBytes(24).toString('base64url')}`;
    const challenge = {
      id,
      purpose,
      channel,
      username,
      binding,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      attempts: 0,
      usedAt: null,
      payload,
    };
    challenges.set(id, challenge);
    return challenge;
  }

  function issueTotpLogin({ username, binding }) {
    return publicChallenge(issue({
      purpose: 'login',
      channel: 'totp',
      username,
      binding,
      ttlMs: loginTtlMs,
    }));
  }

  function issueEmailCode({ purpose, username, binding, destination }) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge = issue({
      purpose,
      channel: 'email',
      username,
      binding,
      ttlMs: purpose === 'login' ? emailTtlMs : enrollmentTtlMs,
      payload: { destination, codeHash: '' },
    });
    challenge.payload.codeHash = digest(`${challenge.id}:${code}`, pepper);
    return { challenge: publicChallenge(challenge, destination), code };
  }

  async function issueTotpEnrollment({ username, binding, issuer = '教师帮' }) {
    const secret = generateTotpSecret();
    const challenge = issue({
      purpose: 'totp_enrollment',
      channel: 'totp',
      username,
      binding,
      ttlMs: enrollmentTtlMs,
      payload: { secret },
    });
    const otpauthUri = buildOtpAuthUri({ secret, account: username, issuer });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
      type: 'image/png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
    });
    return {
      enrollmentId: challenge.id,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      secret,
      otpauthUri,
      qrCodeDataUrl,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      periodSeconds: TOTP_PERIOD_SECONDS,
    };
  }

  function inspect(challengeId, { purpose, binding } = {}) {
    cleanup();
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge) throw new AdminMfaError(400, 'MFA_CHALLENGE_INVALID', '验证码请求无效或已过期，请重新登录');
    if (challenge.usedAt) throw new AdminMfaError(409, 'MFA_CHALLENGE_USED', '该验证码已使用，请重新登录');
    if (challenge.expiresAt <= now()) {
      challenge.usedAt = now();
      challenge.payload = {};
      throw new AdminMfaError(410, 'MFA_CHALLENGE_EXPIRED', '验证码已过期，请重新获取');
    }
    if (purpose && challenge.purpose !== purpose) {
      throw new AdminMfaError(400, 'MFA_CHALLENGE_INVALID', '验证码用途不匹配');
    }
    if (binding && !safeEqual(challenge.binding, binding)) {
      throw new AdminMfaError(403, 'MFA_CHALLENGE_BINDING_MISMATCH', '验证码请求与当前设备不匹配');
    }
    if (challenge.attempts >= maxAttempts) {
      throw new AdminMfaError(429, 'MFA_CHALLENGE_LOCKED', '验证码尝试次数过多，请重新登录');
    }
    return challenge;
  }

  function verifyEmailCode(challengeId, code, options = {}) {
    const challenge = inspect(challengeId, options);
    if (challenge.channel !== 'email' || !challenge.payload.codeHash) {
      throw new AdminMfaError(400, 'MFA_CHALLENGE_INVALID', '当前验证方式不是邮件验证码');
    }
    const normalized = normalizeNumericCode(code);
    const actual = digest(`${challenge.id}:${normalized}`, pepper);
    if (!normalized || !safeEqual(actual, challenge.payload.codeHash)) {
      fail(challenge.id);
      throw invalidCodeError(challenge, maxAttempts);
    }
    return challenge;
  }

  function totpEnrollmentSecret(challengeId, options = {}) {
    const challenge = inspect(challengeId, { ...options, purpose: 'totp_enrollment' });
    return challenge.payload.secret;
  }

  function fail(challengeId) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge || challenge.usedAt) return;
    challenge.attempts += 1;
    if (challenge.attempts >= maxAttempts) {
      challenge.usedAt = now();
      challenge.payload = {};
    }
  }

  function consume(challengeId) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge || challenge.usedAt) {
      throw new AdminMfaError(409, 'MFA_CHALLENGE_USED', '该验证码已使用，请重新登录');
    }
    challenge.usedAt = now();
    challenge.payload = {};
  }

  function revoke(challengeId) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge) return;
    challenge.usedAt = now();
    challenge.payload = {};
  }

  function revokeForUsername(username) {
    let revoked = 0;
    for (const challenge of challenges.values()) {
      if (challenge.username !== username || challenge.usedAt) continue;
      challenge.usedAt = now();
      challenge.payload = {};
      revoked += 1;
    }
    return revoked;
  }

  function reject(challengeId) {
    const challenge = inspect(challengeId);
    fail(challenge.id);
    throw invalidCodeError(challenge, maxAttempts);
  }

  function enforceIssueLimit({ purpose, channel, username, binding }) {
    const key = `${purpose}:${channel}:${username}:${binding}`;
    const limit = channel === 'email' ? maxEmailIssues : maxIssues;
    const timestamp = now();
    const bucket = issueBuckets.get(key);
    if (!bucket || timestamp - bucket.startedAt >= issueWindowMs) {
      issueBuckets.set(key, { startedAt: timestamp, count: 1 });
      return;
    }
    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.startedAt + issueWindowMs - timestamp) / 1000));
      throw new AdminMfaError(429, 'MFA_CODE_RATE_LIMITED', '验证码发送过于频繁，请稍后再试', { retryAfterSeconds });
    }
    bucket.count += 1;
  }

  function cleanup() {
    const timestamp = now();
    for (const [id, challenge] of challenges) {
      if (challenge.expiresAt + issueWindowMs < timestamp || (challenge.usedAt && challenge.usedAt + issueWindowMs < timestamp)) {
        challenges.delete(id);
      }
    }
    for (const [key, bucket] of issueBuckets) {
      if (bucket.startedAt + issueWindowMs < timestamp) issueBuckets.delete(key);
    }
  }

  return {
    consume,
    fail,
    inspect,
    issueEmailCode,
    issueTotpEnrollment,
    issueTotpLogin,
    reject,
    revoke,
    revokeForUsername,
    totpEnrollmentSecret,
    verifyEmailCode,
  };
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes));
}

export function generateTotpCode(secret, options = {}) {
  const timestamp = Number(options.timestamp ?? Date.now());
  const counter = Number(options.counter ?? Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS));
  return hotp(secret, counter, Number(options.digits ?? TOTP_DIGITS));
}

export function verifyTotpCode(secret, code, options = {}) {
  const normalized = normalizeNumericCode(code);
  if (!normalized) return null;
  const timestamp = Number(options.timestamp ?? Date.now());
  const currentCounter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  const window = Number.isInteger(options.window) ? Math.max(0, Math.min(options.window, 5)) : 1;
  const lastAcceptedCounter = Number.isInteger(options.lastAcceptedCounter) ? options.lastAcceptedCounter : -1;
  const offsets = [0];
  for (let distance = 1; distance <= window; distance += 1) offsets.push(-distance, distance);
  for (const offset of offsets) {
    const counter = currentCounter + offset;
    if (counter < 0 || counter <= lastAcceptedCounter) continue;
    if (safeEqual(hotp(secret, counter, normalized.length), normalized)) return { counter };
  }
  return null;
}

export function buildOtpAuthUri({ secret, account, issuer = '教师帮' }) {
  const label = `${issuer}:${account}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function generateRecoveryCodes(count = 10) {
  const total = Math.max(1, Math.min(Number(count) || 10, 20));
  const codes = new Set();
  while (codes.size < total) {
    let raw = '';
    const bytes = randomBytes(12);
    for (const byte of bytes) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return [...codes];
}

export function createRecoveryCodeRecords(codes, { pepper, username }) {
  return codes.map((code) => ({
    hash: recoveryDigest(code, pepper, username),
    usedAt: null,
  }));
}

export function consumeRecoveryCode(records, code, { pepper, username, now = Date.now() }) {
  if (!Array.isArray(records)) return null;
  const normalized = normalizeRecoveryCode(code);
  if (!/^[A-Z2-9]{12}$/.test(normalized)) return null;
  const provided = recoveryDigest(normalized, pepper, username);
  let matchedIndex = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const matches = !record?.usedAt && typeof record?.hash === 'string' && safeEqual(record.hash, provided);
    if (matches) matchedIndex = index;
  }
  if (matchedIndex < 0) return null;
  const updatedRecords = records.map((record, index) => (
    index === matchedIndex ? { ...record, usedAt: new Date(now).toISOString() } : { ...record }
  ));
  return { updatedRecords, matchedIndex };
}

export function isAdminMfaEnabled(admin) {
  if (admin?.mfa?.enabled !== true) return false;
  return enabledMfaMethods(admin).length > 0;
}

export function enabledMfaMethods(admin) {
  const methods = [];
  if (admin?.mfa?.methods?.totp?.enabled === true && admin.mfa.methods.totp.encryptedSecret) methods.push('totp');
  if (admin?.mfa?.methods?.email?.enabled === true && admin.mfa.methods.email.address) methods.push('email');
  return methods;
}

export function preferredMfaMethod(admin) {
  const enabled = enabledMfaMethods(admin);
  return enabled.includes(admin?.mfa?.preferredMethod) ? admin.mfa.preferredMethod : enabled[0] || null;
}

export function publicAdminMfaStatus(admin) {
  const methods = enabledMfaMethods(admin);
  const recoveryCodes = Array.isArray(admin?.mfa?.recoveryCodes) ? admin.mfa.recoveryCodes : [];
  return {
    enabled: isAdminMfaEnabled(admin),
    preferredMethod: preferredMfaMethod(admin),
    methods: {
      totp: {
        enabled: methods.includes('totp'),
        enabledAt: admin?.mfa?.methods?.totp?.enabledAt || null,
      },
      email: {
        enabled: methods.includes('email'),
        destination: methods.includes('email') ? maskEmail(admin.mfa.methods.email.address) : null,
        enabledAt: admin?.mfa?.methods?.email?.enabledAt || null,
      },
    },
    recoveryCodesRemaining: recoveryCodes.filter((record) => !record?.usedAt).length,
    updatedAt: admin?.mfa?.updatedAt || null,
  };
}

export function maskEmail(value) {
  const email = String(value || '').trim();
  const separator = email.lastIndexOf('@');
  if (separator < 1) return '';
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

function hotp(secret, counter, digits) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digestBuffer = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digestBuffer[digestBuffer.length - 1] & 0x0f;
  const binary = ((digestBuffer[offset] & 0x7f) << 24)
    | ((digestBuffer[offset + 1] & 0xff) << 16)
    | ((digestBuffer[offset + 2] & 0xff) << 8)
    | (digestBuffer[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const normalized = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  if (!normalized) throw new Error('TOTP secret is invalid');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('TOTP secret is invalid');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function publicChallenge(challenge, destination = '') {
  return {
    id: challenge.id,
    channel: challenge.channel,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    ...(destination ? { destination: maskEmail(destination) } : {}),
  };
}

function invalidCodeError(challenge, maxAttempts) {
  const attemptsRemaining = Math.max(0, maxAttempts - challenge.attempts);
  return new AdminMfaError(
    attemptsRemaining ? 401 : 429,
    attemptsRemaining ? 'MFA_CODE_INVALID' : 'MFA_CHALLENGE_LOCKED',
    attemptsRemaining ? '验证码错误或已失效' : '验证码尝试次数过多，请重新登录',
    { attemptsRemaining },
  );
}

function normalizeNumericCode(value) {
  const code = String(value || '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(code) ? code : '';
}

function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function recoveryDigest(code, pepper, username) {
  return digest(`${username}:${normalizeRecoveryCode(code)}`, pepper);
}

function digest(value, pepper) {
  return createHmac('sha256', pepper).update(String(value)).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

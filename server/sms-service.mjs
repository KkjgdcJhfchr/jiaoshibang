import {
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { decryptSecret, encryptSecret } from './security.mjs';

const SETTINGS_VERSION = 1;
const PROVIDERS = new Set(['aliyun', 'tencent']);
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export class SmsServiceError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'SmsServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createSmsService({ dataDir, encryptionSecret, fetchImpl = globalThis.fetch }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const settingsFile = join(dataDir, 'sms-settings.json');

  function readSettings() {
    if (!existsSync(settingsFile)) return null;
    try {
      const value = JSON.parse(readFileSync(settingsFile, 'utf8'));
      return value?.version === SETTINGS_VERSION ? value : null;
    } catch (error) {
      throw new SmsServiceError('SMS_SETTINGS_INVALID', `短信配置无法读取：${error.message}`, 500);
    }
  }

  function publicSettings() {
    const settings = readSettings();
    if (!settings) {
      return {
        configured: false,
        enabled: false,
        provider: 'aliyun',
        accessKeyIdMasked: '',
        signName: '',
        templateCode: '',
        region: 'ap-guangzhou',
        sdkAppId: '',
        updatedAt: null,
      };
    }
    return {
      configured: hasRequiredSettings(settings),
      enabled: settings.enabled === true,
      provider: settings.provider,
      accessKeyIdMasked: maskCredential(settings.accessKeyId),
      signName: settings.signName,
      templateCode: settings.templateCode,
      region: settings.region || 'ap-guangzhou',
      sdkAppId: settings.sdkAppId || '',
      updatedAt: settings.updatedAt || null,
    };
  }

  function saveSettings(input, updatedBy = 'admin') {
    assertPlainObject(input);
    const previous = readSettings();
    const provider = cleanText(input.provider || previous?.provider || 'aliyun', 20).toLowerCase();
    if (!PROVIDERS.has(provider)) {
      throw new SmsServiceError('SMS_PROVIDER_INVALID', '短信服务商仅支持阿里云或腾讯云');
    }
    const providerChanged = Boolean(previous && previous.provider !== provider);
    const accessKeyId = cleanText(input.accessKeyId ?? (providerChanged ? '' : previous?.accessKeyId), 128);
    const signName = cleanText(input.signName ?? previous?.signName, 100);
    const templateCode = cleanText(input.templateCode ?? previous?.templateCode, 100);
    const region = cleanText(input.region ?? previous?.region ?? 'ap-guangzhou', 64);
    const sdkAppId = cleanText(input.sdkAppId ?? previous?.sdkAppId, 64);
    const rawSecret = typeof input.accessKeySecret === 'string' ? input.accessKeySecret.trim() : '';
    const secretEnvelope = rawSecret
      ? encryptSecret(rawSecret, encryptionSecret, `sms:${provider}:access-key-secret`)
      : !providerChanged && previous?.provider === provider ? previous.secretEnvelope : null;

    if (!accessKeyId || !signName || !templateCode || !secretEnvelope) {
      throw new SmsServiceError('SMS_SETTINGS_INCOMPLETE', '请完整填写访问密钥、短信签名和验证码模板');
    }
    if (provider === 'tencent' && !sdkAppId) {
      throw new SmsServiceError('SMS_SETTINGS_INCOMPLETE', '腾讯云短信必须填写短信应用 SDK AppID');
    }

    const now = new Date().toISOString();
    const next = {
      version: SETTINGS_VERSION,
      enabled: input.enabled === true,
      provider,
      accessKeyId,
      secretEnvelope,
      signName,
      templateCode,
      region,
      sdkAppId,
      updatedAt: now,
      updatedBy: cleanText(updatedBy, 100) || 'admin',
    };
    writeJsonAtomic(settingsFile, next);
    return publicSettings();
  }

  async function sendVerificationCode({ phone, code, purpose = 'register' }) {
    const normalizedPhone = normalizeChinesePhone(phone);
    if (!PHONE_PATTERN.test(normalizedPhone)) {
      throw new SmsServiceError('PHONE_INVALID', '请输入有效的中国大陆手机号');
    }
    if (!/^\d{6}$/.test(String(code || ''))) {
      throw new SmsServiceError('VERIFICATION_CODE_INVALID', '验证码格式无效');
    }
    const settings = readSettings();
    if (!settings || !hasRequiredSettings(settings) || settings.enabled !== true) {
      throw new SmsServiceError('SMS_NOT_CONFIGURED', '短信验证码通道尚未启用，请联系管理员配置', 503);
    }
    const secret = decryptSecret(
      settings.secretEnvelope,
      encryptionSecret,
      `sms:${settings.provider}:access-key-secret`,
    );
    if (settings.provider === 'aliyun') {
      return sendAliyunSms({ settings, secret, phone: normalizedPhone, code, purpose, fetchImpl });
    }
    return sendTencentSms({ settings, secret, phone: normalizedPhone, code, purpose, fetchImpl });
  }

  async function sendTest(phone) {
    const code = String(Number.parseInt(randomBytes(4).toString('hex'), 16) % 1_000_000).padStart(6, '0');
    const result = await sendVerificationCode({ phone, code, purpose: 'configuration_test' });
    return { ...result, destination: maskPhone(normalizeChinesePhone(phone)) };
  }

  return {
    getPublicSettings: publicSettings,
    isConfigured: () => {
      const settings = readSettings();
      return Boolean(settings && settings.enabled === true && hasRequiredSettings(settings));
    },
    saveSettings,
    sendTest,
    sendVerificationCode,
  };
}

async function sendAliyunSms({ settings, secret, phone, code, fetchImpl }) {
  const host = 'dysmsapi.aliyuncs.com';
  const action = 'SendSms';
  const version = '2017-05-25';
  const now = new Date();
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = randomUUID();
  const bodyHash = sha256Hex('');
  const query = canonicalQuery({
    PhoneNumbers: phone,
    SignName: settings.signName,
    TemplateCode: settings.templateCode,
    TemplateParam: JSON.stringify({ code }),
  });
  const signedHeaders = 'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version';
  const canonicalHeaders = [
    `host:${host}`,
    `x-acs-action:${action}`,
    `x-acs-content-sha256:${bodyHash}`,
    `x-acs-date:${date}`,
    `x-acs-signature-nonce:${nonce}`,
    `x-acs-version:${version}`,
    '',
  ].join('\n');
  const canonicalRequest = ['POST', '/', query, canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacHex(secret, stringToSign);
  const authorization = `ACS3-HMAC-SHA256 Credential=${settings.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;

  const response = await fetchWithTimeout(fetchImpl, `https://${host}/?${query}`, {
    method: 'POST',
    headers: {
      authorization,
      host,
      'x-acs-action': action,
      'x-acs-content-sha256': bodyHash,
      'x-acs-date': date,
      'x-acs-signature-nonce': nonce,
      'x-acs-version': version,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.Code !== 'OK') {
    throw new SmsServiceError(
      'SMS_PROVIDER_REJECTED',
      payload.Message || `阿里云短信发送失败（HTTP ${response.status}）`,
      502,
      { provider: 'aliyun', providerCode: payload.Code || '', requestId: payload.RequestId || '' },
    );
  }
  return { provider: 'aliyun', requestId: payload.RequestId || '', accepted: true };
}

async function sendTencentSms({ settings, secret, phone, code, fetchImpl }) {
  const host = 'sms.tencentcloudapi.com';
  const service = 'sms';
  const action = 'SendSms';
  const version = '2021-01-11';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: settings.sdkAppId,
    SignName: settings.signName,
    TemplateId: settings.templateCode,
    TemplateParamSet: [String(code)],
  });
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(payload)].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const secretDate = hmacBuffer(`TC3${secret}`, date);
  const secretService = hmacBuffer(secretDate, service);
  const secretSigning = hmacBuffer(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetchWithTimeout(fetchImpl, `https://${host}/`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': contentType,
      host,
      'x-tc-action': action,
      'x-tc-region': settings.region || 'ap-guangzhou',
      'x-tc-timestamp': String(timestamp),
      'x-tc-version': version,
    },
    body: payload,
  });
  const body = await response.json().catch(() => ({}));
  const result = body.Response || {};
  const status = result.SendStatusSet?.[0];
  if (!response.ok || result.Error || (status && status.Code !== 'Ok')) {
    throw new SmsServiceError(
      'SMS_PROVIDER_REJECTED',
      result.Error?.Message || status?.Message || `腾讯云短信发送失败（HTTP ${response.status}）`,
      502,
      { provider: 'tencent', providerCode: result.Error?.Code || status?.Code || '', requestId: result.RequestId || '' },
    );
  }
  return { provider: 'tencent', requestId: result.RequestId || '', accepted: true };
}

async function fetchWithTimeout(fetchImpl, url, options) {
  if (typeof fetchImpl !== 'function') {
    throw new SmsServiceError('SMS_TRANSPORT_UNAVAILABLE', '服务器缺少可用的 HTTPS 请求能力', 500);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new SmsServiceError('SMS_PROVIDER_TIMEOUT', '短信服务商响应超时，请稍后重试', 504);
    }
    throw new SmsServiceError('SMS_PROVIDER_UNREACHABLE', `无法连接短信服务商：${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

function hasRequiredSettings(settings) {
  return Boolean(
    PROVIDERS.has(settings?.provider)
    && settings.accessKeyId
    && settings.secretEnvelope
    && settings.signName
    && settings.templateCode
    && (settings.provider !== 'tencent' || settings.sdkAppId),
  );
}

function normalizeChinesePhone(value) {
  return String(value || '').trim().replace(/^(?:\+?86|0086)/, '').replace(/[\s-]/g, '');
}

function canonicalQuery(values) {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function hmacBuffer(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function maskCredential(value) {
  const text = String(value || '');
  if (!text) return '';
  return text.length <= 8 ? `${text.slice(0, 2)}****${text.slice(-2)}` : `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function maskPhone(phone) {
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`;
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SmsServiceError('SMS_SETTINGS_INVALID', '短信配置必须是 JSON 对象');
  }
}

function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

export const smsInternals = {
  canonicalQuery,
  maskCredential,
  normalizeChinesePhone,
};

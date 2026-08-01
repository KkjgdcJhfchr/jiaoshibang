import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SESSION_ISSUER = 'teacher-helper';
const ENCRYPTION_VERSION = 1;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const keyLength = 64;
  const hash = scryptSync(password, salt, keyLength);
  return {
    algorithm: 'scrypt',
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    keyLength,
  };
}

export function verifyPassword(password, record) {
  if (!record || record.algorithm !== 'scrypt') return false;
  try {
    const salt = Buffer.from(record.salt, 'hex');
    const expected = Buffer.from(record.hash, 'hex');
    const keyLength = Number(record.keyLength) || expected.length;
    if (salt.length < 8 || expected.length === 0 || keyLength !== expected.length) return false;
    const actual = scryptSync(password, salt, keyLength);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken({ subject, role, secret, ttlSeconds, now = Date.now() }) {
  const issuedAtMilliseconds = Math.floor(now);
  const issuedAt = Math.floor(issuedAtMilliseconds / 1000);
  const expiresAtSeconds = issuedAt + ttlSeconds;
  const payload = {
    v: 1,
    iss: SESSION_ISSUER,
    sub: subject,
    role,
    iat: issuedAt,
    sat: issuedAtMilliseconds,
    exp: expiresAtSeconds,
    nonce: randomBytes(12).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encoded, secret);
  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

export function verifySessionToken(token, { role, secret, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSignature] = parts;
  const expectedSignature = sign(encoded, secret);
  const actualBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(now / 1000);
    if (
      payload?.v !== 1
      || payload?.iss !== SESSION_ISSUER
      || payload?.role !== role
      || typeof payload?.sub !== 'string'
      || !Number.isInteger(payload?.iat)
      || (payload?.sat !== undefined && !Number.isInteger(payload.sat))
      || !Number.isInteger(payload?.exp)
      || payload.exp <= nowSeconds
      || payload.iat > nowSeconds + 60
      || (Number.isInteger(payload.sat) && payload.sat > now + 60_000)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || cookies.has(name)) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export function sessionCookie(name, token, ttlSeconds, secure) {
  return [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    `Max-Age=${ttlSeconds}`,
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie(name, secure) {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    secure ? 'Secure' : '',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].filter(Boolean).join('; ');
}

export function encryptSecret(plaintext, secret, context) {
  if (typeof plaintext !== 'string' || !plaintext) throw new Error('待加密密钥不能为空');
  const key = deriveEncryptionKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: ENCRYPTION_VERSION,
    algorithm: 'aes-256-gcm',
    kdf: 'hkdf-sha256',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function decryptSecret(envelope, secret, context) {
  if (
    !envelope
    || envelope.version !== ENCRYPTION_VERSION
    || envelope.algorithm !== 'aes-256-gcm'
    || envelope.kdf !== 'hkdf-sha256'
  ) throw new Error('不支持的密钥加密格式');
  const key = deriveEncryptionKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function stablePrivateHash(value, salt) {
  return createHmac('sha256', salt).update(String(value)).digest('hex');
}

export function redactDirectIdentifiers(input) {
  const categories = new Set();
  let count = 0;
  const sensitiveKey = /^(?:user(?:name|id)?|account|email|e-mail|phone|mobile|telephone|idcard|identitycard|address|teachername|studentname|schoolname|classname)$/i;

  function redact(value, key = '') {
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => {
        if (sensitiveKey.test(childKey)) {
          count += 1;
          categories.add(childKey.toLowerCase());
          return [childKey, '[已去标识]'];
        }
        return [childKey, redact(child, childKey)];
      }));
    }
    if (typeof value !== 'string') return value;
    if (sensitiveKey.test(key)) {
      count += 1;
      categories.add(key.toLowerCase());
      return '[已去标识]';
    }
    let result = value;
    result = replace(result, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已去标识]', 'email');
    result = replace(result, /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[手机号已去标识]', 'phone');
    result = replace(result, /(?<!\d)\d{17}[0-9Xx](?!\d)/g, '[证件号已去标识]', 'identity');
    result = replace(result, /[\u4e00-\u9fa5]{2,30}(?:学校|中学|小学|学院)/g, '[学校已去标识]', 'school');
    result = replace(
      result,
      /((?:教师|老师|学生|姓名)[：:\s]*)[\u4e00-\u9fa5]{2,4}/g,
      '$1[姓名已去标识]',
      'name',
    );
    return result;
  }

  function replace(value, pattern, replacement, category) {
    let matches = 0;
    const next = value.replace(pattern, (...args) => {
      matches += 1;
      return typeof replacement === 'string' && replacement.includes('$1')
        ? replacement.replace('$1', args[1] || '')
        : replacement;
    });
    if (matches) {
      count += matches;
      categories.add(category);
    }
    return next;
  }

  return { value: redact(input), count, categories: [...categories].sort() };
}

function deriveEncryptionKey(secret) {
  return Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('teacher-helper:model-channel:v1', 'utf8'),
    Buffer.from('api-key-encryption', 'utf8'),
    32,
  ));
}

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const ALLOWED_PURPOSES = new Set(['register', 'login', 'reset_password', 'checkout']);

export class VerificationCodeError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'VerificationCodeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createVerificationCodeService({
  secret,
  ttlMs = 5 * 60 * 1000,
  resendAfterMs = 60 * 1000,
  maxPerHour = 6,
  maxAttempts = 5,
  now = () => Date.now(),
}) {
  const challenges = new Map();
  const deliveryHistory = new Map();

  async function issue({ identifier, purpose, deliver, shouldDeliver = true }) {
    assertPurpose(purpose);
    const target = normalizeVerificationTarget(identifier, { allowPhone: purpose === 'checkout' });
    const key = challengeKey(target.key, purpose);
    enforceDeliveryRate(key);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const issuedAt = now();
    const challenge = {
      id: `vfy_${randomUUID()}`,
      identifierKey: target.key,
      channel: target.channel,
      purpose,
      codeHash: hashCode(code, secret, key),
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      attemptsRemaining: maxAttempts,
      consumedAt: null,
    };

    if (shouldDeliver) {
      if (typeof deliver !== 'function') {
        throw new VerificationCodeError('DELIVERY_NOT_CONFIGURED', '验证码发送通道尚未配置', 503);
      }
      await deliver({
        channel: target.channel,
        destination: target.value,
        code,
        purpose,
        expiresInMinutes: Math.max(1, Math.ceil(ttlMs / 60_000)),
      });
    }

    challenges.set(key, challenge);
    recordDelivery(key, issuedAt);
    prune();
    return {
      accepted: true,
      verificationId: challenge.id,
      channel: target.channel,
      destination: maskTarget(target),
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      resendAfterSeconds: Math.ceil(resendAfterMs / 1000),
    };
  }

  function verify({ identifier, purpose, code, verificationId = '' }) {
    assertPurpose(purpose);
    const target = normalizeVerificationTarget(identifier, { allowPhone: purpose === 'checkout' });
    const key = challengeKey(target.key, purpose);
    const challenge = challenges.get(key);
    const provided = String(code || '').trim();
    if (!/^\d{6}$/.test(provided)) {
      throw new VerificationCodeError('VERIFICATION_CODE_INVALID', '请输入 6 位验证码');
    }
    if (!challenge || challenge.consumedAt) {
      throw new VerificationCodeError('VERIFICATION_CODE_INVALID', '验证码无效或已使用');
    }
    if (verificationId && verificationId !== challenge.id) {
      throw new VerificationCodeError('VERIFICATION_CODE_INVALID', '验证码与本次验证请求不匹配');
    }
    if (challenge.expiresAt <= now()) {
      challenges.delete(key);
      throw new VerificationCodeError('VERIFICATION_CODE_EXPIRED', '验证码已过期，请重新获取');
    }
    if (challenge.attemptsRemaining <= 0) {
      challenges.delete(key);
      throw new VerificationCodeError('VERIFICATION_CODE_LOCKED', '验证码尝试次数过多，请重新获取', 429);
    }

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(hashCode(provided, secret, key), 'hex');
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!valid) {
      challenge.attemptsRemaining -= 1;
      if (challenge.attemptsRemaining <= 0) challenges.delete(key);
      throw new VerificationCodeError(
        'VERIFICATION_CODE_INVALID',
        challenge.attemptsRemaining > 0
          ? `验证码错误，还可尝试 ${challenge.attemptsRemaining} 次`
          : '验证码尝试次数过多，请重新获取',
        challenge.attemptsRemaining > 0 ? 400 : 429,
      );
    }
    challenge.consumedAt = now();
    challenges.delete(key);
    return { verified: true, channel: challenge.channel };
  }

  function enforceDeliveryRate(key) {
    const current = now();
    const recent = (deliveryHistory.get(key) || []).filter((timestamp) => current - timestamp < 60 * 60 * 1000);
    deliveryHistory.set(key, recent);
    const last = recent.at(-1);
    if (last && current - last < resendAfterMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resendAfterMs - (current - last)) / 1000));
      throw new VerificationCodeError(
        'VERIFICATION_CODE_TOO_FREQUENT',
        `请在 ${retryAfterSeconds} 秒后重新获取验证码`,
        429,
        { retryAfterSeconds },
      );
    }
    if (recent.length >= maxPerHour) {
      throw new VerificationCodeError('VERIFICATION_CODE_RATE_LIMITED', '验证码发送次数过多，请稍后再试', 429);
    }
  }

  function recordDelivery(key, timestamp) {
    const history = deliveryHistory.get(key) || [];
    history.push(timestamp);
    deliveryHistory.set(key, history);
  }

  function prune() {
    const current = now();
    for (const [key, challenge] of challenges) {
      if (challenge.expiresAt <= current || challenge.consumedAt) challenges.delete(key);
    }
    for (const [key, history] of deliveryHistory) {
      const recent = history.filter((timestamp) => current - timestamp < 60 * 60 * 1000);
      if (recent.length) deliveryHistory.set(key, recent);
      else deliveryHistory.delete(key);
    }
  }

  return { issue, verify };
}

export function normalizeVerificationTarget(identifier, { allowPhone = false } = {}) {
  const original = String(identifier || '').trim();
  if (allowPhone) {
    const phone = original.replace(/^(?:\+?86|0086)/, '').replace(/[\s-]/g, '');
    if (/^1[3-9]\d{9}$/.test(phone)) {
      return { channel: 'sms', value: phone, key: `phone:${phone}` };
    }
  }
  const email = original.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email) && email.length <= 254) {
    return { channel: 'email', value: email, key: `email:${email}` };
  }
  throw new VerificationCodeError('IDENTIFIER_INVALID', allowPhone ? '请输入有效的邮箱或中国大陆手机号' : '请输入有效的邮箱地址');
}

function assertPurpose(purpose) {
  if (!ALLOWED_PURPOSES.has(purpose)) {
    throw new VerificationCodeError('VERIFICATION_PURPOSE_INVALID', '验证码用途无效');
  }
}

function challengeKey(identifierKey, purpose) {
  return `${purpose}:${identifierKey}`;
}

function hashCode(code, secret, key) {
  return createHmac('sha256', secret).update(`${key}:${code}`).digest('hex');
}

function maskTarget(target) {
  if (target.channel === 'sms') return `${target.value.slice(0, 3)} **** ${target.value.slice(-4)}`;
  const [name, domain] = target.value.split('@');
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, name.length - visible.length)))}@${domain}`;
}

export const verificationInternals = { maskTarget };

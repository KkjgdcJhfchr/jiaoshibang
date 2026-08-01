import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from './security.mjs';
import {
  PAYMENT_PROVIDERS,
  PaymentError,
  testPaymentConfig,
  transitionPayment,
  validatePaymentConfig,
} from './payment-core.mjs';

const SECRET_FIELDS = Object.freeze({
  wechat: ['merchantPrivateKeyPem', 'apiV3Key', 'verifierPublicKeyPem'],
  alipay: ['appPrivateKeyPem', 'alipayPublicKeyPem'],
});

const PUBLIC_FIELDS = Object.freeze({
  wechat: ['displayName', 'appId', 'merchantId', 'merchantCertificateSerial', 'verifierSerial', 'notifyUrl'],
  alipay: ['displayName', 'appId', 'sellerId', 'notifyUrl', 'returnUrl', 'environment'],
});

export function createPaymentStore({ dataDir, encryptionSecret, now = () => new Date() }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'payments.json');
  const state = readState(filename);
  assertState(state);

  function listPublicConfigs() {
    return PAYMENT_PROVIDERS.map((provider) => publicPaymentConfig(provider, state.configs[provider] || null));
  }

  function getPublicConfig(provider) {
    assertProvider(provider);
    return publicPaymentConfig(provider, state.configs[provider] || null);
  }

  function getConfigWithSecrets(provider) {
    assertProvider(provider);
    const record = state.configs[provider];
    if (!record) return null;
    let secrets;
    try {
      secrets = JSON.parse(decryptSecret(record.encryptedSecrets, encryptionSecret, configContext(provider)));
    } catch {
      throw new PaymentError(503, 'PAYMENT_CREDENTIAL_DECRYPT_FAILED', `${providerLabel(provider)}凭据无法解密，请管理员重新保存配置`);
    }
    return { ...record.settings, ...secrets, enabled: Boolean(record.enabled), provider };
  }

  function saveConfig(provider, input, updatedBy = 'admin') {
    assertProvider(provider);
    requireEncryptionSecret();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new PaymentError(400, 'PAYMENT_CONFIG_INVALID', '支付配置必须是对象');
    }
    const existing = state.configs[provider] || null;
    const existingFull = existing ? getConfigWithSecrets(provider) : {};
    const settings = {};
    for (const field of PUBLIC_FIELDS[provider]) {
      const fallback = existing?.settings?.[field] ?? defaultPublicValue(provider, field);
      settings[field] = cleanSetting(input[field] ?? fallback, field === 'notifyUrl' || field === 'returnUrl' ? 2000 : 200);
    }
    if (provider === 'alipay') settings.environment = ['sandbox', 'production'].includes(settings.environment) ? settings.environment : 'production';

    const secrets = {};
    for (const field of SECRET_FIELDS[provider]) {
      const provided = typeof input[field] === 'string' ? input[field].trim() : '';
      secrets[field] = provided || existingFull[field] || '';
    }
    const full = { ...settings, ...secrets };
    const validation = validatePaymentConfig(provider, full);
    if (!validation.ok) {
      throw new PaymentError(422, 'PAYMENT_CONFIG_VALIDATION_FAILED', '支付配置校验失败', { errors: validation.errors });
    }
    const localTest = testPaymentConfig(provider, full);
    if (!localTest.ok) {
      throw new PaymentError(422, 'PAYMENT_CONFIG_CRYPTO_CHECK_FAILED', '支付凭据本地密码学自检失败', { errors: localTest.errors });
    }
    const timestamp = isoNow(now);
    const record = {
      version: 1,
      provider,
      enabled: input.enabled === undefined ? Boolean(existing?.enabled) : Boolean(input.enabled),
      settings,
      encryptedSecrets: encryptSecret(JSON.stringify(secrets), encryptionSecret, configContext(provider)),
      credentialHints: credentialHints(provider, secrets),
      validation: { ok: true, mode: localTest.mode, checkedAt: timestamp, errors: [] },
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: cleanSetting(updatedBy, 100) || 'admin',
    };
    state.configs[provider] = record;
    writeState(filename, state);
    return publicPaymentConfig(provider, record);
  }

  function testConfig(provider) {
    const config = getConfigWithSecrets(provider);
    if (!config) throw new PaymentError(404, 'PAYMENT_CONFIG_NOT_FOUND', `${providerLabel(provider)}尚未配置`);
    const result = testPaymentConfig(provider, config);
    const record = state.configs[provider];
    record.validation = { ...result, checkedAt: isoNow(now) };
    record.updatedAt = isoNow(now);
    if (!result.ok) record.enabled = false;
    writeState(filename, state);
    return { config: publicPaymentConfig(provider, record), result };
  }

  function setConfigEnabled(provider, enabled, updatedBy = 'admin') {
    const config = getConfigWithSecrets(provider);
    if (!config) throw new PaymentError(404, 'PAYMENT_CONFIG_NOT_FOUND', `${providerLabel(provider)}尚未配置`);
    if (enabled) {
      const result = testPaymentConfig(provider, config);
      if (!result.ok) throw new PaymentError(422, 'PAYMENT_CONFIG_NOT_READY', '配置未通过本地校验，不能启用', { errors: result.errors });
      state.configs[provider].validation = { ...result, checkedAt: isoNow(now) };
    }
    state.configs[provider].enabled = Boolean(enabled);
    state.configs[provider].updatedAt = isoNow(now);
    state.configs[provider].updatedBy = cleanSetting(updatedBy, 100) || 'admin';
    writeState(filename, state);
    return publicPaymentConfig(provider, state.configs[provider]);
  }

  function findOrderById(orderId) {
    return state.orders.find((order) => order.id === orderId) || null;
  }

  function findOrderByMerchantNo(merchantOrderNo) {
    return state.orders.find((order) => order.merchantOrderNo === merchantOrderNo) || null;
  }

  function findIdempotentOrder(provider, userId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return state.orders.find((order) => (
      order.provider === provider
      && order.userId === userId
      && order.idempotencyKey === idempotencyKey
    )) || null;
  }

  function createOrder(order) {
    if (findOrderById(order.id) || findOrderByMerchantNo(order.merchantOrderNo)) {
      throw new PaymentError(409, 'PAYMENT_ORDER_EXISTS', '支付订单号已存在');
    }
    const existing = findIdempotentOrder(order.provider, order.userId, order.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== order.requestHash) {
        throw new PaymentError(409, 'IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同订单参数');
      }
      return { order: existing, created: false };
    }
    state.orders.push(order);
    writeState(filename, state);
    return { order, created: true };
  }

  function updateOrder(orderId, updater) {
    const index = state.orders.findIndex((order) => order.id === orderId);
    if (index < 0) throw new PaymentError(404, 'PAYMENT_ORDER_NOT_FOUND', '支付订单不存在');
    const updated = updater({ ...state.orders[index] });
    state.orders[index] = updated;
    writeState(filename, state);
    return updated;
  }

  function applyNotification({ provider, eventId, merchantOrderNo, nextState, metadata = {}, validate }) {
    assertProvider(provider);
    const normalizedEventId = cleanSetting(eventId, 180);
    if (!normalizedEventId) throw new PaymentError(400, 'PAYMENT_EVENT_ID_REQUIRED', '支付通知缺少唯一事件 ID');
    const previous = state.processedEvents.find((event) => event.provider === provider && event.eventId === normalizedEventId);
    if (previous) {
      return { order: findOrderById(previous.orderId), duplicate: true, changed: false };
    }
    const index = state.orders.findIndex((order) => order.merchantOrderNo === merchantOrderNo && order.provider === provider);
    if (index < 0) throw new PaymentError(404, 'PAYMENT_ORDER_NOT_FOUND', '通知对应的支付订单不存在');
    const current = state.orders[index];
    if (typeof validate === 'function') validate(current);
    const transitioned = transitionPayment(current, nextState, { ...metadata, eventId: normalizedEventId }, now());
    state.orders[index] = transitioned.order;
    state.processedEvents.push({
      provider,
      eventId: normalizedEventId,
      orderId: current.id,
      merchantOrderNo,
      state: nextState,
      processedAt: isoNow(now),
    });
    if (state.processedEvents.length > 20_000) state.processedEvents.splice(0, state.processedEvents.length - 20_000);
    writeState(filename, state);
    return { order: transitioned.order, duplicate: false, changed: transitioned.changed };
  }

  function listOrders({ offset = 0, limit = 50, provider = '', status = '', userId = '' } = {}) {
    const filtered = state.orders.filter((order) => (
      (!provider || order.provider === provider)
      && (!status || order.status === status)
      && (!userId || order.userId === userId)
    )).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      items: filtered.slice(offset, offset + limit).map(publicPaymentOrder),
      total: filtered.length,
      offset,
      limit,
    };
  }

  return {
    applyNotification,
    createOrder,
    findIdempotentOrder,
    findOrderById,
    findOrderByMerchantNo,
    getConfigWithSecrets,
    getPublicConfig,
    listOrders,
    listPublicConfigs,
    saveConfig,
    setConfigEnabled,
    testConfig,
    updateOrder,
  };

  function requireEncryptionSecret() {
    if (typeof encryptionSecret !== 'string' || encryptionSecret.length < 32) {
      throw new PaymentError(503, 'PAYMENT_ENCRYPTION_SECRET_REQUIRED', '保存支付凭据前必须配置至少 32 字符的持久化 SESSION_SECRET');
    }
  }
}

export function publicPaymentConfig(provider, record) {
  if (!record) {
    return {
      provider,
      displayName: providerLabel(provider),
      configured: false,
      enabled: false,
      validation: { ok: false, checkedAt: null, errors: ['尚未配置'] },
      credentials: Object.fromEntries(SECRET_FIELDS[provider].map((field) => [field, false])),
    };
  }
  return {
    provider,
    ...record.settings,
    configured: true,
    enabled: Boolean(record.enabled),
    validation: record.validation || { ok: false, checkedAt: null, errors: ['尚未校验'] },
    credentials: Object.fromEntries(SECRET_FIELDS[provider].map((field) => [field, Boolean(record.credentialHints?.[field])])),
    credentialHints: record.credentialHints,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

export function publicPaymentOrder(order) {
  return {
    id: order.id,
    merchantOrderNo: order.merchantOrderNo,
    provider: order.provider,
    userId: order.userId,
    planId: order.planId,
    quoteId: order.quoteId || '',
    subject: order.subject,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    providerState: order.providerState || '',
    providerTradeNo: order.providerTradeNo || '',
    gatewayUnknown: Boolean(order.gatewayUnknown),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt || null,
    closedAt: order.closedAt || null,
    statusHistory: order.statusHistory || [],
    checkout: order.checkout || null,
    fulfillment: order.fulfillment ? {
      status: order.fulfillment.status || 'PENDING',
      attempts: Number(order.fulfillment.attempts || 0),
      creditsGranted: Number(order.fulfillment.creditsGranted || 0),
      membershipStartsAt: order.fulfillment.membershipStartsAt || null,
      membershipExpiresAt: order.fulfillment.membershipExpiresAt || null,
      fulfilledAt: order.fulfillment.fulfilledAt || null,
      updatedAt: order.fulfillment.updatedAt || null,
    } : { status: order.status === 'PAID' ? 'RETRY_REQUIRED' : 'PENDING', attempts: 0 },
  };
}

function credentialHints(provider, secrets) {
  return Object.fromEntries(SECRET_FIELDS[provider].map((field) => {
    const value = String(secrets[field] || '');
    if (!value) return [field, ''];
    if (field === 'apiV3Key') return [field, `末四位 ${value.slice(-4)}`];
    return [field, '已加密保存'];
  }));
}

function readState(filename) {
  if (!existsSync(filename)) return { version: 1, configs: {}, orders: [], processedEvents: [] };
  try { return JSON.parse(readFileSync(filename, 'utf8')); } catch (error) {
    throw new Error(`支付数据无法读取：${error.message}`);
  }
}

function writeState(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function assertState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('payments.json 数据结构无效');
  if (!state.configs || typeof state.configs !== 'object' || Array.isArray(state.configs)) throw new Error('payments.json configs 无效');
  if (!Array.isArray(state.orders) || !Array.isArray(state.processedEvents)) throw new Error('payments.json 订单或事件结构无效');
}

function assertProvider(provider) {
  if (!PAYMENT_PROVIDERS.includes(provider)) throw new PaymentError(400, 'PAYMENT_PROVIDER_INVALID', '不支持的支付渠道');
}

function configContext(provider) {
  return `payment-config:${provider}:v1`;
}

function defaultPublicValue(provider, field) {
  if (field === 'displayName') return providerLabel(provider);
  if (field === 'environment') return 'production';
  return '';
}

function cleanSetting(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum);
}

function isoNow(now) {
  const value = typeof now === 'function' ? now() : now;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function providerLabel(provider) {
  return provider === 'wechat' ? '微信支付' : '支付宝';
}

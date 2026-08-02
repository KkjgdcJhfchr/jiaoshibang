import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'node:crypto';

export const PAYMENT_PROVIDERS = Object.freeze(['wechat', 'alipay']);
export const PAYMENT_STATES = Object.freeze([
  'CREATED',
  'PENDING',
  'PAID',
  'CLOSED',
  'FAILED',
  'CANCELED',
  'REFUNDING',
  'REFUNDED',
]);

const PAYMENT_TRANSITIONS = Object.freeze({
  CREATED: new Set(['PENDING', 'PAID', 'CLOSED', 'FAILED', 'CANCELED', 'REFUNDING', 'REFUNDED']),
  PENDING: new Set(['PAID', 'CLOSED', 'FAILED', 'CANCELED', 'REFUNDING', 'REFUNDED']),
  PAID: new Set(['REFUNDING', 'REFUNDED']),
  REFUNDING: new Set(['PAID', 'REFUNDED']),
  CLOSED: new Set(),
  FAILED: new Set(),
  CANCELED: new Set(),
  REFUNDED: new Set(),
});

export class PaymentError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function canTransitionPayment(from, to) {
  if (from === to) return true;
  return Boolean(PAYMENT_TRANSITIONS[from]?.has(to));
}

export function transitionPayment(order, nextState, metadata = {}, now = new Date()) {
  if (!order || !PAYMENT_STATES.includes(order.status)) {
    throw new PaymentError(500, 'INVALID_ORDER_STATE', '订单当前状态无效');
  }
  if (!PAYMENT_STATES.includes(nextState)) {
    throw new PaymentError(400, 'INVALID_PAYMENT_STATE', '目标支付状态无效');
  }
  if (order.status === nextState) {
    return { order, changed: false, duplicate: true };
  }
  if (!canTransitionPayment(order.status, nextState)) {
    throw new PaymentError(
      409,
      'PAYMENT_STATE_CONFLICT',
      `订单不能从 ${order.status} 变更为 ${nextState}`,
      { currentState: order.status, requestedState: nextState },
    );
  }
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const event = {
    from: order.status,
    to: nextState,
    at: timestamp,
    source: cleanText(metadata.source, 64) || 'system',
    ...(metadata.eventId ? { eventId: cleanText(metadata.eventId, 160) } : {}),
    ...(metadata.reason ? { reason: cleanText(metadata.reason, 300) } : {}),
  };
  const updated = {
    ...order,
    status: nextState,
    updatedAt: timestamp,
    paidAt: nextState === 'PAID' ? order.paidAt || timestamp : order.paidAt || null,
    closedAt: ['CLOSED', 'CANCELED'].includes(nextState) ? order.closedAt || timestamp : order.closedAt || null,
    refundedAt: nextState === 'REFUNDED' ? order.refundedAt || timestamp : order.refundedAt || null,
    statusHistory: [...(order.statusHistory || []), event],
    ...(metadata.providerTradeNo ? { providerTradeNo: cleanText(metadata.providerTradeNo, 128) } : {}),
    ...(metadata.providerState ? { providerState: cleanText(metadata.providerState, 64) } : {}),
    ...(metadata.gatewayUnknown !== undefined ? { gatewayUnknown: Boolean(metadata.gatewayUnknown) } : {}),
  };
  return { order: updated, changed: true, duplicate: false };
}

export function normalizeCreateOrderInput(input) {
  assertPlainObject(input, '订单请求必须是对象');
  const provider = cleanText(input.provider, 20).toLowerCase();
  if (!PAYMENT_PROVIDERS.includes(provider)) {
    throw new PaymentError(400, 'PAYMENT_PROVIDER_INVALID', '请选择微信支付或支付宝');
  }
  const rawAmount = input.amountCents ?? input.totalCents ?? input.amount;
  const amountCents = rawAmount === undefined || rawAmount === null || rawAmount === '' ? null : normalizeAmountCents(rawAmount);
  const subject = cleanText(input.subject ?? input.title ?? input.planName, 120);
  const planId = cleanText(input.planId ?? input.productId, 80);
  if (!planId || !/^[A-Za-z0-9_.:-]{2,80}$/.test(planId)) {
    throw new PaymentError(400, 'PAYMENT_PLAN_REQUIRED', '请选择有效的会员套餐');
  }
  const idempotencyKey = cleanText(input.idempotencyKey, 128);
  if (idempotencyKey && !/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) {
    throw new PaymentError(400, 'IDEMPOTENCY_KEY_INVALID', '幂等键需为 8-128 位字母、数字或 _ . : -');
  }
  return {
    provider,
    amountCents,
    currency: 'CNY',
    subject,
    planId,
    idempotencyKey,
    clientMetadata: sanitizeClientMetadata(input.clientMetadata),
  };
}

export function applyAuthoritativeProductQuote(selection, product) {
  assertPlainObject(selection, '支付选择必须是对象');
  assertPlainObject(product, '服务端套餐报价必须是对象');
  const planId = cleanText(product.planId ?? product.id, 80);
  if (!planId || planId !== selection.planId) {
    throw new PaymentError(500, 'PAYMENT_PRODUCT_ID_MISMATCH', '服务端套餐目录返回了不一致的套餐标识');
  }
  const amountCents = normalizeAmountCents(product.amountCents ?? product.totalCents ?? product.amount);
  const currency = cleanText(product.currency || 'CNY', 8).toUpperCase();
  if (currency !== 'CNY') throw new PaymentError(500, 'PAYMENT_PRODUCT_CURRENCY_INVALID', '当前支付通道只支持人民币套餐');
  const subject = cleanText(product.subject ?? product.name ?? product.title, 120);
  if (!subject) throw new PaymentError(500, 'PAYMENT_PRODUCT_SUBJECT_REQUIRED', '服务端套餐目录缺少订单标题');
  if (selection.amountCents !== null && selection.amountCents !== amountCents) {
    throw new PaymentError(409, 'PAYMENT_QUOTE_CHANGED', '套餐价格已经变化，请刷新结算页面后重新确认', {
      quotedAmountCents: amountCents,
      currency,
    });
  }
  return {
    ...selection,
    planId,
    amountCents,
    currency,
    subject,
    quoteId: cleanText(product.quoteId, 120),
    productSnapshot: normalizeProductEntitlement(product.entitlement, {
      planId,
      quoteId: cleanText(product.quoteId, 120),
    }),
  };
}

function normalizeProductEntitlement(entitlement, { planId, quoteId }) {
  assertPlainObject(entitlement, '服务端套餐目录缺少权益定义');
  const type = cleanText(entitlement.type, 30);
  const tier = cleanText(entitlement.tier, 40);
  const billingPeriod = cleanText(entitlement.billingPeriod, 20);
  const catalogVersion = cleanText(entitlement.catalogVersion, 80);
  const durationDays = Number(entitlement.durationDays);
  const credits = Number(entitlement.credits);
  const tierRank = Number(entitlement.tierRank);
  if (type !== 'membership' || !/^[A-Za-z0-9_.:-]{2,40}$/.test(tier)) {
    throw new PaymentError(500, 'PAYMENT_PRODUCT_ENTITLEMENT_INVALID', '服务端套餐目录的会员权益类型无效');
  }
  if (!['month', 'quarter', 'half_year', 'year'].includes(billingPeriod)) {
    throw new PaymentError(500, 'PAYMENT_PRODUCT_ENTITLEMENT_INVALID', '服务端套餐目录的计费周期无效');
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3_660) {
    throw new PaymentError(500, 'PAYMENT_PRODUCT_ENTITLEMENT_INVALID', '服务端套餐目录的有效期无效');
  }
  if (!Number.isSafeInteger(credits) || credits < 0 || credits > 1_000_000) {
    throw new PaymentError(500, 'PAYMENT_PRODUCT_ENTITLEMENT_INVALID', '服务端套餐目录的点数权益无效');
  }
  if (!Number.isSafeInteger(tierRank) || tierRank < 1 || tierRank > 10_000) {
    throw new PaymentError(500, 'PAYMENT_PRODUCT_ENTITLEMENT_INVALID', '服务端套餐目录的等级权重无效');
  }
  return Object.freeze({
    type,
    planId,
    tier,
    tierRank,
    billingPeriod,
    durationDays,
    credits,
    catalogVersion,
    quoteId: cleanText(entitlement.quoteId || quoteId, 120),
  });
}

export function paymentRequestHash({ provider, amountCents, currency, subject, planId, userId }) {
  return createHash('sha256').update(JSON.stringify({
    provider,
    amountCents,
    currency,
    subject,
    planId,
    userId,
  })).digest('hex');
}

export function generateMerchantOrderNo(now = Date.now()) {
  const timestamp = Math.floor(Number(now) / 1000).toString(36).toUpperCase().padStart(7, '0');
  return `JSH${timestamp}${randomBytes(8).toString('hex').toUpperCase()}`.slice(0, 32);
}

export function validatePaymentConfig(provider, config) {
  const errors = [];
  if (!PAYMENT_PROVIDERS.includes(provider)) return { ok: false, errors: ['不支持的支付渠道'] };
  if (!config || typeof config !== 'object') return { ok: false, errors: ['支付配置不能为空'] };

  if (provider === 'wechat') {
    if (!/^wx[A-Za-z0-9]{8,30}$/.test(String(config.appId || ''))) errors.push('微信 AppID 格式不正确');
    if (!/^\d{8,32}$/.test(String(config.merchantId || ''))) errors.push('微信商户号格式不正确');
    if (!/^[A-Fa-f0-9]{20,64}$/.test(String(config.merchantCertificateSerial || ''))) errors.push('商户 API 证书序列号格式不正确');
    if (!/^(?:PUB_KEY_ID_[0-9]+|[A-Fa-f0-9]{20,64})$/.test(String(config.verifierSerial || ''))) errors.push('微信支付公钥 ID / 平台证书序列号格式不正确');
    validateHttpsUrl(config.notifyUrl, '微信回调地址', errors);
    if (Buffer.byteLength(String(config.apiV3Key || ''), 'utf8') !== 32) errors.push('API v3 密钥必须正好为 32 字节');
    validatePrivateKey(config.merchantPrivateKeyPem, '微信商户私钥', errors);
    validatePublicKey(config.verifierPublicKeyPem, '微信支付公钥或平台证书', errors);
  } else {
    if (!/^\d{10,32}$/.test(String(config.appId || ''))) errors.push('支付宝 AppID 格式不正确');
    if (config.sellerId && !/^\d{16,32}$/.test(String(config.sellerId))) errors.push('支付宝卖家 ID 格式不正确');
    validateHttpsUrl(config.notifyUrl, '支付宝异步回调地址', errors);
    if (config.returnUrl) validateHttpsUrl(config.returnUrl, '支付宝同步返回地址', errors);
    if ((config.environment || 'production') !== 'production') errors.push('支付宝支付只能使用生产环境');
    validatePrivateKey(config.appPrivateKeyPem, '支付宝应用私钥', errors, true);
    validatePublicKey(config.alipayPublicKeyPem, '支付宝公钥', errors, true);
  }
  return { ok: errors.length === 0, errors };
}

export function testPaymentConfig(provider, config) {
  const validation = validatePaymentConfig(provider, config);
  if (!validation.ok) return validation;
  try {
    const message = `teacher-helper-payment-config-test\n${provider}\n`;
    const privateKey = normalizePrivateKey(provider === 'wechat' ? config.merchantPrivateKeyPem : config.appPrivateKeyPem, provider === 'alipay');
    const derivedPublicKey = createPublicKey(createPrivateKey(privateKey));
    const signature = cryptoSign('RSA-SHA256', Buffer.from(message), privateKey);
    if (!cryptoVerify('RSA-SHA256', Buffer.from(message), derivedPublicKey, signature)) {
      return { ok: false, errors: ['应用私钥本地签名自检失败'] };
    }
    const verifier = provider === 'wechat'
      ? normalizePublicKey(config.verifierPublicKeyPem)
      : normalizePublicKey(config.alipayPublicKeyPem, true);
    createPublicKey(verifier);
    return { ok: true, errors: [], checkedAt: new Date().toISOString(), mode: 'local-cryptographic-validation' };
  } catch {
    return { ok: false, errors: ['密钥材料无法完成本地密码学自检'] };
  }
}

export function buildWechatSignatureMessage(method, canonicalPath, timestamp, nonce, body = '') {
  const normalizedMethod = String(method || '').toUpperCase();
  if (!/^[A-Z]+$/.test(normalizedMethod)) throw new PaymentError(400, 'WECHAT_METHOD_INVALID', '微信请求方法无效');
  const path = String(canonicalPath || '');
  if (!path.startsWith('/') || path.includes('\n')) throw new PaymentError(400, 'WECHAT_PATH_INVALID', '微信请求路径无效');
  return `${normalizedMethod}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
}

export function buildWechatAuthorization({ method, canonicalPath, body = '', merchantId, certificateSerial, privateKeyPem, timestamp = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex') }) {
  const message = buildWechatSignatureMessage(method, canonicalPath, timestamp, nonce, body);
  const signature = cryptoSign('RSA-SHA256', Buffer.from(message), normalizePrivateKey(privateKeyPem)).toString('base64');
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${headerToken(merchantId)}",nonce_str="${headerToken(nonce)}",timestamp="${headerToken(timestamp)}",serial_no="${headerToken(certificateSerial)}",signature="${signature}"`;
  return { authorization, signature, timestamp: String(timestamp), nonce, message };
}

export function buildWechatNativeOrderRequest(order, config, options = {}) {
  const canonicalPath = '/v3/pay/transactions/native';
  const payload = {
    appid: config.appId,
    mchid: config.merchantId,
    description: order.subject.slice(0, 127),
    out_trade_no: order.merchantOrderNo,
    notify_url: config.notifyUrl,
    amount: { total: order.amountCents, currency: order.currency },
    attach: Buffer.from(JSON.stringify({ orderId: order.id, planId: order.planId })).toString('base64url').slice(0, 128),
  };
  if (order.expiresAt) payload.time_expire = order.expiresAt;
  const body = JSON.stringify(payload);
  const auth = buildWechatAuthorization({
    method: 'POST',
    canonicalPath,
    body,
    merchantId: config.merchantId,
    certificateSerial: config.merchantCertificateSerial,
    privateKeyPem: config.merchantPrivateKeyPem,
    timestamp: options.timestamp,
    nonce: options.nonce,
  });
  return {
    url: `https://api.mch.weixin.qq.com${canonicalPath}`,
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth.authorization },
    body,
    signature: auth,
    payload,
  };
}

export function verifyWechatSignedMessage({ timestamp, nonce, body, signature, publicKeyPem }) {
  if (!timestamp || !nonce || !body || !signature) return false;
  if (String(signature).startsWith('WECHATPAY/SIGNTEST/')) return false;
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  try {
    return cryptoVerify(
      'RSA-SHA256',
      Buffer.from(message),
      normalizePublicKey(publicKeyPem),
      Buffer.from(String(signature), 'base64'),
    );
  } catch {
    return false;
  }
}

export function assertWechatNotificationSignature({ headers, rawBody, config, now = Date.now(), toleranceSeconds = 300 }) {
  const timestamp = getHeader(headers, 'wechatpay-timestamp');
  const nonce = getHeader(headers, 'wechatpay-nonce');
  const serial = getHeader(headers, 'wechatpay-serial');
  const signature = getHeader(headers, 'wechatpay-signature');
  if (!timestamp || !nonce || !serial || !signature) {
    throw new PaymentError(401, 'WECHAT_SIGNATURE_HEADERS_MISSING', '微信支付通知缺少验签请求头');
  }
  if (!safeStringEqual(serial, config.verifierSerial)) {
    throw new PaymentError(401, 'WECHAT_VERIFIER_UNKNOWN', '微信支付通知使用了未配置的公钥或证书序列号');
  }
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(Number(now) / 1000) - seconds) > toleranceSeconds) {
    throw new PaymentError(401, 'WECHAT_TIMESTAMP_INVALID', '微信支付通知时间戳超出允许范围');
  }
  if (!verifyWechatSignedMessage({ timestamp, nonce, body: rawBody, signature, publicKeyPem: config.verifierPublicKeyPem })) {
    throw new PaymentError(401, 'WECHAT_SIGNATURE_INVALID', '微信支付通知验签失败');
  }
  return true;
}

export function decryptWechatResource(resource, apiV3Key) {
  if (resource?.algorithm !== 'AEAD_AES_256_GCM') {
    throw new PaymentError(400, 'WECHAT_RESOURCE_ALGORITHM_UNSUPPORTED', '微信支付通知加密算法不受支持');
  }
  if (Buffer.byteLength(String(apiV3Key || ''), 'utf8') !== 32) {
    throw new PaymentError(500, 'WECHAT_API_V3_KEY_INVALID', '微信 API v3 密钥配置无效');
  }
  try {
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    if (encrypted.length <= 16) throw new Error('ciphertext too short');
    const ciphertext = encrypted.subarray(0, -16);
    const authTag = encrypted.subarray(-16);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    throw new PaymentError(400, 'WECHAT_RESOURCE_DECRYPT_FAILED', '微信支付通知资源解密失败');
  }
}

export function mapWechatTradeState(value) {
  return ({ SUCCESS: 'PAID', REFUND: 'REFUNDING', NOTPAY: 'PENDING', CLOSED: 'CLOSED', REVOKED: 'CANCELED', USERPAYING: 'PENDING', PAYERROR: 'FAILED' })[value] || null;
}

export function canonicalizeAlipayParams(input) {
  const grouped = new Map();
  const entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input || {});
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey);
    if (key === 'sign' || key === 'sign_type' || rawValue === undefined || rawValue === null || rawValue === '') continue;
    const values = grouped.get(key) || [];
    values.push(String(rawValue));
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .join('&');
}

export function buildAlipayPagePayRequest(order, config, options = {}) {
  const gateway = 'https://openapi.alipay.com/gateway.do';
  const siteName = cleanText(
    typeof options.getSiteName === 'function' ? options.getSiteName() : options.siteName,
    60,
  ) || '在线教育平台';
  const fields = {
    app_id: config.appId,
    method: 'alipay.trade.page.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatAlipayTimestamp(options.now || new Date()),
    version: '1.0',
    notify_url: config.notifyUrl,
    ...(config.returnUrl ? { return_url: config.returnUrl } : {}),
    biz_content: JSON.stringify({
      out_trade_no: order.merchantOrderNo,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: centsToAlipayAmount(order.amountCents),
      subject: order.subject.slice(0, 120),
      body: `${siteName}会员订单 ${order.planId}`.slice(0, 128),
      passback_params: encodeURIComponent(Buffer.from(JSON.stringify({ orderId: order.id })).toString('base64url')),
    }),
  };
  const canonical = canonicalizeAlipayParams(fields);
  fields.sign = cryptoSign('RSA-SHA256', Buffer.from(canonical, 'utf8'), normalizePrivateKey(config.appPrivateKeyPem, true)).toString('base64');
  return { action: gateway, method: 'POST', fields, canonical };
}

export function verifyAlipayNotification(parameters, alipayPublicKeyPem) {
  const params = parameters instanceof URLSearchParams ? parameters : new URLSearchParams(parameters || {});
  const seen = new Set();
  for (const [key] of params) {
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const signature = params.get('sign');
  if (!signature) return false;
  const canonical = canonicalizeAlipayParams(params);
  try {
    return cryptoVerify(
      'RSA-SHA256',
      Buffer.from(canonical, 'utf8'),
      normalizePublicKey(alipayPublicKeyPem, true),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export function mapAlipayTradeStatus(value) {
  return ({ WAIT_BUYER_PAY: 'PENDING', TRADE_SUCCESS: 'PAID', TRADE_FINISHED: 'PAID', TRADE_CLOSED: 'CLOSED' })[value] || null;
}

export function centsToAlipayAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new PaymentError(400, 'PAYMENT_AMOUNT_INVALID', '支付金额必须为正整数分');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function alipayAmountToCents(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/);
  if (!match) throw new PaymentError(400, 'ALIPAY_AMOUNT_INVALID', '支付宝通知金额格式无效');
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

export function safeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizePrivateKey(value, allowBare = false) {
  const text = String(value || '').trim().replace(/\\n/g, '\n');
  if (text.includes('BEGIN')) return text;
  if (allowBare && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const compact = text.replace(/\s+/g, '');
    return `-----BEGIN PRIVATE KEY-----\n${compact.match(/.{1,64}/g)?.join('\n') || compact}\n-----END PRIVATE KEY-----`;
  }
  return text;
}

export function normalizePublicKey(value, allowBare = false) {
  const text = String(value || '').trim().replace(/\\n/g, '\n');
  if (text.includes('BEGIN')) return text;
  if (allowBare && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const compact = text.replace(/\s+/g, '');
    return `-----BEGIN PUBLIC KEY-----\n${compact.match(/.{1,64}/g)?.join('\n') || compact}\n-----END PUBLIC KEY-----`;
  }
  return text;
}

function normalizeAmountCents(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000_000) {
    throw new PaymentError(400, 'PAYMENT_AMOUNT_INVALID', '订单金额必须为 1-100000000 分之间的整数');
  }
  return value;
}

function validatePrivateKey(value, label, errors, allowBare = false) {
  try { createPrivateKey(normalizePrivateKey(value, allowBare)); } catch { errors.push(`${label}不是有效的 RSA 私钥`); }
}

function validatePublicKey(value, label, errors, allowBare = false) {
  try { createPublicKey(normalizePublicKey(value, allowBare)); } catch { errors.push(`${label}不是有效的 RSA 公钥或证书`); }
}

function validateHttpsUrl(value, label, errors) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid');
  } catch { errors.push(`${label}必须是无账号信息和片段的 HTTPS 地址`); }
}

function formatAlipayTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getHeader(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name) || '';
  const target = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === target);
  return Array.isArray(entry?.[1]) ? entry[1][0] : String(entry?.[1] || '');
}

function headerToken(value) {
  const text = String(value || '');
  if (!text || /["\\\r\n]/.test(text)) throw new PaymentError(400, 'WECHAT_HEADER_VALUE_INVALID', '微信支付签名参数无效');
  return text;
}

function cleanText(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum);
}

function sanitizeClientMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => [
    cleanText(key, 40),
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? cleanText(item, 200) : '',
  ]).filter(([key]) => key));
}

function assertPlainObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PaymentError(400, 'INVALID_PAYMENT_REQUEST', message);
  }
}

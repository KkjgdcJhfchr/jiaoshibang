import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createCipheriv,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  PaymentError,
  alipayAmountToCents,
  applyAuthoritativeProductQuote,
  buildWechatNativeOrderRequest,
  canonicalizeAlipayParams,
  centsToAlipayAmount,
  normalizeCreateOrderInput,
  transitionPayment,
} from './payment-core.mjs';
import { createPaymentService } from './payment-service.mjs';
import { createPaymentStore } from './payment-store.mjs';
import { createDataStore } from './data-store.mjs';
import { createMembershipCatalog, listMembershipProducts, resolveMembershipProduct } from './membership-catalog.mjs';

const FIXED_DATE = new Date('2026-08-01T02:03:04.000Z');
const ENCRYPTION_SECRET = 'payment-tests-only-session-secret-0123456789abcdef';
const WECHAT_API_V3_KEY = '0123456789abcdef0123456789abcdef';

const merchantKeys = rsaKeys();
const wechatVerifierKeys = rsaKeys();
const alipayAppKeys = rsaKeys();
const alipayPlatformKeys = rsaKeys();

const WECHAT_CONFIG = Object.freeze({
  displayName: '微信支付',
  appId: 'wx1234567890abcdef',
  merchantId: '1234567890',
  merchantCertificateSerial: 'A'.repeat(40),
  verifierSerial: 'PUB_KEY_ID_3000000001',
  notifyUrl: 'https://pay.example.test/api/payments/notify/wechat',
  merchantPrivateKeyPem: merchantKeys.privateKey,
  apiV3Key: WECHAT_API_V3_KEY,
  verifierPublicKeyPem: wechatVerifierKeys.publicKey,
});

const ALIPAY_CONFIG = Object.freeze({
  displayName: '支付宝',
  appId: '2026000000000001',
  sellerId: '2088000000000001',
  notifyUrl: 'https://pay.example.test/api/payments/notify/alipay',
  returnUrl: 'https://www.example.test/payment/result',
  environment: 'production',
  appPrivateKeyPem: alipayAppKeys.privateKey,
  alipayPublicKeyPem: alipayPlatformKeys.publicKey,
});

test('订单状态机只允许显式转换，并将重复通知视为幂等', () => {
  const order = {
    status: 'CREATED',
    statusHistory: [],
    updatedAt: FIXED_DATE.toISOString(),
    paidAt: null,
    closedAt: null,
    refundedAt: null,
  };
  const pending = transitionPayment(order, 'PENDING', { source: 'test' }, FIXED_DATE);
  assert.equal(pending.changed, true);
  assert.equal(pending.order.status, 'PENDING');
  assert.equal(pending.order.statusHistory.at(-1).source, 'test');

  const duplicate = transitionPayment(pending.order, 'PENDING', { source: 'duplicate' }, FIXED_DATE);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.duplicate, true);

  const trustedCallbackJump = transitionPayment(order, 'PAID', { source: 'verified-provider-notify' }, FIXED_DATE);
  assert.equal(trustedCallbackJump.order.status, 'PAID');

  assert.throws(
    () => transitionPayment(trustedCallbackJump.order, 'PENDING', { source: 'invalid' }, FIXED_DATE),
    (error) => error instanceof PaymentError && error.code === 'PAYMENT_STATE_CONFLICT',
  );
});

test('支付宝金额和待签名参数使用确定性规范化', () => {
  assert.equal(centsToAlipayAmount(1), '0.01');
  assert.equal(centsToAlipayAmount(123456), '1234.56');
  assert.equal(alipayAmountToCents('1234.5'), 123450);
  assert.equal(
    canonicalizeAlipayParams(new URLSearchParams('z=last&sign=ignored&a=first&sign_type=RSA2&empty=')),
    'a=first&z=last',
  );
  const changedQuote = normalizeCreateOrderInput({ provider: 'alipay', planId: 'annual', amountCents: 8700 });
  assert.throws(
    () => applyAuthoritativeProductQuote(changedQuote, { planId: 'annual', amountCents: 8800, subject: '教师帮年度会员' }),
    (error) => error instanceof PaymentError && error.code === 'PAYMENT_QUOTE_CHANGED',
  );
});

test('服务端会员目录提供固定人民币报价和不可由浏览器覆盖的权益快照', () => {
  const plans = listMembershipProducts();
  assert.deepEqual(plans.map((plan) => plan.planId), [
    'pro-monthly',
    'pro-quarterly',
    'pro-half-yearly',
    'pro-yearly',
    'research-monthly',
    'research-quarterly',
    'research-half-yearly',
    'research-yearly',
  ]);
  assert.deepEqual(
    [...new Set(plans.map((plan) => plan.billingPeriod))].sort(),
    ['half_year', 'month', 'quarter', 'year'],
  );
  assert.equal(plans.find((plan) => plan.planId === 'pro-monthly').amountCents, 3900);
  const product = resolveMembershipProduct({ planId: 'pro-monthly' });
  const selection = normalizeCreateOrderInput({ provider: 'alipay', planId: 'pro-monthly', amountCents: 3900 });
  const quote = applyAuthoritativeProductQuote(selection, product);
  assert.equal(quote.productSnapshot.credits, 20);
  assert.equal(quote.productSnapshot.durationDays, 30);
  assert.equal(quote.productSnapshot.planId, 'pro-monthly');
});

test('管理员维护的套餐与限时优惠持久化，且仅在有效期内成为服务端成交价', (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  const activeAt = new Date('2026-08-10T00:00:00.000Z');
  const catalog = createMembershipCatalog({ dataDir, now: () => activeAt });
  const saved = catalog.saveProduct('pro-monthly', {
    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    promotion: {
      label: '开学限时优惠',
      amountCents: 2_900,
      startsAt: '2026-08-05T00:00:00.000Z',
      endsAt: '2026-08-20T00:00:00.000Z',
    },
  }, 'catalog-admin');
  assert.equal(saved.amountCents, 2900);
  assert.equal(saved.regularAmountCents, 3900);
  assert.equal(saved.promotion.active, true);
  assert.equal(catalog.resolveProduct({ planId: 'pro-monthly' }).amountCents, 2900);

  const expiredCatalog = createMembershipCatalog({ dataDir, now: () => new Date('2026-08-21T00:00:00.000Z') });
  const expired = expiredCatalog.listProducts({ includeInactive: true }).find((plan) => plan.planId === 'pro-monthly');
  assert.equal(expired.amountCents, 3900);
  assert.equal(expired.promotion.active, false);
  assert.equal(expiredCatalog.resolveProduct({ planId: 'pro-monthly' }).amountCents, 3900);
});

test('微信 Native 下单请求按 API v3 规范签名', () => {
  const order = {
    id: 'pay_00000000-0000-4000-8000-000000000001',
    merchantOrderNo: 'JSH202608010000000000000001',
    subject: '教师帮专业会员',
    amountCents: 2990,
    currency: 'CNY',
    planId: 'pro-monthly',
  };
  const timestamp = Math.floor(FIXED_DATE.getTime() / 1000);
  const request = buildWechatNativeOrderRequest(order, WECHAT_CONFIG, { timestamp, nonce: 'offline-test-nonce' });
  assert.equal(request.url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/native');
  assert.equal(request.payload.out_trade_no, order.merchantOrderNo);
  assert.equal(request.payload.amount.total, 2990);
  assert.match(request.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
  assert.equal(
    cryptoVerify(
      'RSA-SHA256',
      Buffer.from(request.signature.message),
      merchantKeys.publicKey,
      Buffer.from(request.signature.signature, 'base64'),
    ),
    true,
  );
});

test('未配置支付通道时明确不可用，且不会发起网关请求', async (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  let fetchCalls = 0;
  const service = createPaymentService({
    dataDir,
    encryptionSecret: ENCRYPTION_SECRET,
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); },
    now: () => FIXED_DATE,
  });

  await assert.rejects(
    service.createOrder(
      { id: 'user-unconfigured' },
      { provider: 'wechat', amountCents: 100, subject: '测试会员', planId: 'test' },
      { idempotencyKey: 'unconfigured-0001' },
    ),
    (error) => error instanceof PaymentError && error.status === 503 && error.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED',
  );
  assert.equal(fetchCalls, 0);
});

test('支付凭据只以加密信封落盘，公开配置不返回密钥原文', (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  const store = createPaymentStore({ dataDir, encryptionSecret: ENCRYPTION_SECRET, now: () => FIXED_DATE });
  const publicConfig = store.saveConfig('wechat', { ...WECHAT_CONFIG, enabled: true }, 'test-admin');
  const disk = readFileSync(join(dataDir, 'payments.json'), 'utf8');

  assert.equal(publicConfig.enabled, true);
  assert.equal(publicConfig.credentials.merchantPrivateKeyPem, true);
  assert.equal(publicConfig.credentials.apiV3Key, true);
  assert.equal('merchantPrivateKeyPem' in publicConfig, false);
  assert.equal(disk.includes(WECHAT_API_V3_KEY), false);
  assert.equal(disk.includes(merchantKeys.privateKey), false);
  assert.equal(disk.includes(wechatVerifierKeys.publicKey), false);
  assert.match(disk, /"ciphertext"\s*:/);
});

test('已配置网关但未接入服务端套餐目录时仍然禁止真实下单', async (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  const service = createPaymentService({ dataDir, encryptionSecret: ENCRYPTION_SECRET, now: () => FIXED_DATE });
  service.saveConfig('alipay', { ...ALIPAY_CONFIG, enabled: true }, 'test-admin');
  await assert.rejects(
    service.createOrder(
      { id: 'user-no-catalog' },
      { provider: 'alipay', planId: 'annual', amountCents: 8800 },
      { idempotencyKey: 'catalog-required-0001' },
    ),
    (error) => error instanceof PaymentError && error.status === 503 && error.code === 'PAYMENT_PRODUCT_CATALOG_UNAVAILABLE',
  );
  assert.equal(service.listOrders().total, 0);
});

test('微信下单、幂等重放、回调验签解密和重复通知保持一致', async (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  const gatewayTimestamp = String(Math.floor(FIXED_DATE.getTime() / 1000));
  let fetchCalls = 0;
  const fetchImpl = async (url, options) => {
    fetchCalls += 1;
    assert.equal(url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    assert.equal(options.method, 'POST');
    assert.match(options.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
    const raw = JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=offline-test' });
    const nonce = 'gateway-response-nonce';
    return new Response(raw, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Wechatpay-Timestamp': gatewayTimestamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Serial': WECHAT_CONFIG.verifierSerial,
        'Wechatpay-Signature': signWechatMessage(gatewayTimestamp, nonce, raw, wechatVerifierKeys.privateKey),
      },
    });
  };
  const service = createPaymentService({
    dataDir,
    encryptionSecret: ENCRYPTION_SECRET,
    fetchImpl,
    now: () => FIXED_DATE,
    resolveProduct: resolveTestProduct,
    fulfillPaidOrder: (order) => ({
      fulfillmentId: `ent_${order.id.slice(4)}`,
      creditsGranted: order.productSnapshot.credits,
      membershipStartsAt: FIXED_DATE.toISOString(),
      membershipExpiresAt: new Date(FIXED_DATE.getTime() + 30 * 86_400_000).toISOString(),
    }),
  });
  service.saveConfig('wechat', { ...WECHAT_CONFIG, enabled: true }, 'test-admin');

  const request = { provider: 'wechat', amountCents: 2990, subject: '教师帮专业会员', planId: 'pro-monthly' };
  const first = await service.createOrder({ id: 'user-wechat' }, request, { idempotencyKey: 'wechat-checkout-0001' });
  assert.equal(first.created, true);
  assert.equal(first.order.status, 'PENDING');
  assert.equal(first.order.checkout.type, 'wechat_native_qr');
  assert.equal(fetchCalls, 1);

  const replay = await service.createOrder({ id: 'user-wechat' }, request, { idempotencyKey: 'wechat-checkout-0001' });
  assert.equal(replay.created, false);
  assert.equal(replay.idempotent, true);
  assert.equal(fetchCalls, 1);

  await assert.rejects(
    service.createOrder({ id: 'user-wechat' }, { ...request, planId: 'pro-yearly', amountCents: 3990 }, { idempotencyKey: 'wechat-checkout-0001' }),
    (error) => error instanceof PaymentError && error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const resource = {
    appid: WECHAT_CONFIG.appId,
    mchid: WECHAT_CONFIG.merchantId,
    out_trade_no: first.order.merchantOrderNo,
    transaction_id: '4200000000202608010000000001',
    trade_type: 'NATIVE',
    trade_state: 'SUCCESS',
    success_time: '2026-08-01T10:03:04+08:00',
    amount: { total: 2990, payer_total: 2990, currency: 'CNY', payer_currency: 'CNY' },
  };
  const rawNotification = createWechatNotification('wechat-event-0001', resource);
  const notificationNonce = 'notification-nonce';
  const headers = {
    'wechatpay-timestamp': gatewayTimestamp,
    'wechatpay-nonce': notificationNonce,
    'wechatpay-serial': WECHAT_CONFIG.verifierSerial,
    'wechatpay-signature': signWechatMessage(gatewayTimestamp, notificationNonce, rawNotification, wechatVerifierKeys.privateKey),
  };
  const paid = await service.handleWechatNotification({ headers, rawBody: rawNotification });
  assert.equal(paid.order.status, 'PAID');
  assert.equal(paid.order.providerTradeNo, resource.transaction_id);
  assert.equal(paid.order.fulfillment.status, 'FULFILLED');
  assert.equal(paid.order.fulfillment.creditsGranted, 20);
  assert.equal(paid.duplicate, false);

  const duplicate = await service.handleWechatNotification({ headers, rawBody: rawNotification });
  assert.equal(duplicate.order.status, 'PAID');
  assert.equal(duplicate.duplicate, true);
});

test('支付宝页面支付签名、回调验签、金额校验与通知幂等闭环', async (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  let checkoutConfirmations = 0;
  const service = createPaymentService({
    dataDir,
    encryptionSecret: ENCRYPTION_SECRET,
    fetchImpl: async () => { throw new Error('Alipay page pay does not call a gateway from the server'); },
    now: () => FIXED_DATE,
    resolveProduct: resolveTestProduct,
    confirmCheckout: ({ rawInput }) => {
      checkoutConfirmations += 1;
      assert.equal(rawInput.verificationCode, '123456');
    },
    fulfillPaidOrder: (order) => ({
      fulfillmentId: `ent_${order.id.slice(4)}`,
      creditsGranted: order.productSnapshot.credits,
      membershipStartsAt: FIXED_DATE.toISOString(),
      membershipExpiresAt: new Date(FIXED_DATE.getTime() + 365 * 86_400_000).toISOString(),
    }),
  });
  service.saveConfig('alipay', { ...ALIPAY_CONFIG, enabled: true }, 'test-admin');

  const created = await service.createOrder(
    { id: 'user-alipay' },
    { provider: 'alipay', amountCents: 8800, subject: '教师帮年度会员', planId: 'annual', verificationCode: '123456' },
    { idempotencyKey: 'alipay-checkout-0001' },
  );
  assert.equal(created.order.status, 'PENDING');
  assert.equal(created.order.checkout.type, 'alipay_page_form');
  assert.equal(created.order.checkout.action, 'https://openapi.alipay.com/gateway.do');
  assert.equal(checkoutConfirmations, 1);

  const idempotent = await service.createOrder(
    { id: 'user-alipay' },
    { provider: 'alipay', amountCents: 8800, planId: 'annual' },
    { idempotencyKey: 'alipay-checkout-0001' },
  );
  assert.equal(idempotent.idempotent, true);
  assert.equal(checkoutConfirmations, 1);

  const checkoutFields = created.order.checkout.fields;
  assert.equal(
    cryptoVerify(
      'RSA-SHA256',
      Buffer.from(canonicalizeAlipayParams(checkoutFields), 'utf8'),
      alipayAppKeys.publicKey,
      Buffer.from(checkoutFields.sign, 'base64'),
    ),
    true,
  );

  const notification = new URLSearchParams({
    notify_time: '2026-08-01 10:03:04',
    notify_type: 'trade_status_sync',
    notify_id: 'alipay-notify-0001',
    app_id: ALIPAY_CONFIG.appId,
    charset: 'utf-8',
    version: '1.0',
    sign_type: 'RSA2',
    trade_no: '2026080122000000000000000001',
    out_trade_no: created.order.merchantOrderNo,
    trade_status: 'TRADE_SUCCESS',
    total_amount: '88.00',
    receipt_amount: '88.00',
    buyer_pay_amount: '88.00',
    seller_id: ALIPAY_CONFIG.sellerId,
  });
  notification.set('sign', cryptoSign(
    'RSA-SHA256',
    Buffer.from(canonicalizeAlipayParams(notification), 'utf8'),
    alipayPlatformKeys.privateKey,
  ).toString('base64'));

  const paid = await service.handleAlipayNotification({ rawBody: notification.toString() });
  assert.equal(paid.order.status, 'PAID');
  assert.equal(paid.order.providerTradeNo, notification.get('trade_no'));
  assert.equal(paid.order.fulfillment.status, 'FULFILLED');
  assert.equal(paid.duplicate, false);

  const duplicate = await service.handleAlipayNotification({ rawBody: notification.toString() });
  assert.equal(duplicate.order.status, 'PAID');
  assert.equal(duplicate.duplicate, true);
});

test('权益发放失败会让支付通知返回可重试错误，重复通知可补发且不会重复加权益', async (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  let fulfillmentCalls = 0;
  const service = createPaymentService({
    dataDir,
    encryptionSecret: ENCRYPTION_SECRET,
    now: () => FIXED_DATE,
    resolveProduct: resolveTestProduct,
    fulfillPaidOrder: (order) => {
      fulfillmentCalls += 1;
      if (fulfillmentCalls === 1) throw new Error('temporary entitlement store outage');
      return {
        fulfillmentId: `ent_${order.id.slice(4)}`,
        duplicate: true,
        creditsGranted: order.productSnapshot.credits,
        membershipStartsAt: FIXED_DATE.toISOString(),
        membershipExpiresAt: new Date(FIXED_DATE.getTime() + 365 * 86_400_000).toISOString(),
      };
    },
  });
  service.saveConfig('alipay', { ...ALIPAY_CONFIG, enabled: true }, 'test-admin');
  const created = await service.createOrder(
    { id: 'user-fulfillment-retry' },
    { provider: 'alipay', amountCents: 8800, planId: 'annual' },
    { idempotencyKey: 'fulfillment-retry-0001' },
  );
  const notification = signedAlipayNotification(created.order, 'alipay-notify-retry-0001');
  await assert.rejects(
    service.handleAlipayNotification({ rawBody: notification.toString() }),
    (error) => error instanceof PaymentError && error.status === 503 && error.code === 'PAYMENT_FULFILLMENT_RETRY_REQUIRED',
  );
  const pendingFulfillment = service.getOrder(created.order.id, 'user-fulfillment-retry');
  assert.equal(pendingFulfillment.status, 'PAID');
  assert.equal(pendingFulfillment.fulfillment.status, 'RETRY_REQUIRED');

  const retried = await service.handleAlipayNotification({ rawBody: notification.toString() });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.order.fulfillment.status, 'FULFILLED');
  assert.equal(retried.order.fulfillment.attempts, 2);
  assert.equal(fulfillmentCalls, 2);
});

test('会员权益按支付订单幂等发放，同等级续费顺延且点数只增加一次', (context) => {
  const dataDir = temporaryDataDir();
  context.after(() => removeTemporaryDataDir(dataDir));
  const store = createDataStore(dataDir, { now: () => FIXED_DATE });
  const user = store.registerUser({
    account: 'payment-user@example.test',
    accountKey: 'payment-user@example.test',
    displayName: '支付测试用户',
    subject: '语文',
    password: 'test-hash',
    credits: 3,
    trainingConsent: false,
  });
  const product = resolveMembershipProduct({ planId: 'pro-monthly' });
  const quote = applyAuthoritativeProductQuote(
    normalizeCreateOrderInput({ provider: 'alipay', planId: product.planId, amountCents: product.amountCents }),
    product,
  );
  const first = store.grantMembershipPurchase({
    orderId: 'pay_00000000-0000-4000-8000-000000000101',
    userId: user.id,
    planId: product.planId,
    entitlement: quote.productSnapshot,
    paidAt: FIXED_DATE,
  });
  const duplicate = store.grantMembershipPurchase({
    orderId: 'pay_00000000-0000-4000-8000-000000000101',
    userId: user.id,
    planId: product.planId,
    entitlement: quote.productSnapshot,
    paidAt: FIXED_DATE,
  });
  const renewal = store.grantMembershipPurchase({
    orderId: 'pay_00000000-0000-4000-8000-000000000102',
    userId: user.id,
    planId: product.planId,
    entitlement: quote.productSnapshot,
    paidAt: FIXED_DATE,
  });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(renewal.duplicate, false);
  assert.equal(store.findUserById(user.id).credits, 43);
  assert.equal(renewal.grant.startsAt, first.grant.expiresAt);
  assert.equal(store.findUserById(user.id).membershipGrants[0].planId, 'pro-monthly');
});

function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function resolveTestProduct({ planId }) {
  const product = ({
    'pro-monthly': { planId: 'pro-monthly', amountCents: 2990, currency: 'CNY', subject: '教师帮专业会员', durationDays: 30, credits: 20 },
    'pro-yearly': { planId: 'pro-yearly', amountCents: 3990, currency: 'CNY', subject: '教师帮专业年卡', durationDays: 365, credits: 240 },
    annual: { planId: 'annual', amountCents: 8800, currency: 'CNY', subject: '教师帮年度会员', durationDays: 365, credits: 240 },
  })[planId] || null;
  if (!product) return null;
  return {
    ...product,
    quoteId: `test:${product.planId}`,
    entitlement: {
      type: 'membership',
      tier: 'pro',
      tierRank: 10,
      billingPeriod: product.durationDays === 30 ? 'month' : 'year',
      durationDays: product.durationDays,
      credits: product.credits,
      catalogVersion: 'test-v1',
      quoteId: `test:${product.planId}`,
    },
  };
}

function createWechatNotification(eventId, resource) {
  const nonce = '0123456789ab';
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(WECHAT_API_V3_KEY, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(resource), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
  return JSON.stringify({
    id: eventId,
    create_time: '2026-08-01T10:03:04+08:00',
    resource_type: 'encrypt-resource',
    event_type: 'TRANSACTION.SUCCESS',
    summary: '支付成功',
    resource: {
      original_type: 'transaction',
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext,
      associated_data: associatedData,
      nonce,
    },
  });
}

function signedAlipayNotification(order, eventId) {
  const notification = new URLSearchParams({
    notify_time: '2026-08-01 10:03:04',
    notify_type: 'trade_status_sync',
    notify_id: eventId,
    app_id: ALIPAY_CONFIG.appId,
    charset: 'utf-8',
    version: '1.0',
    sign_type: 'RSA2',
    trade_no: `2026080122${eventId.replace(/\D/g, '').padEnd(20, '0').slice(0, 20)}`,
    out_trade_no: order.merchantOrderNo,
    trade_status: 'TRADE_SUCCESS',
    total_amount: centsToTestAmount(order.amountCents),
    seller_id: ALIPAY_CONFIG.sellerId,
  });
  notification.set('sign', cryptoSign(
    'RSA-SHA256',
    Buffer.from(canonicalizeAlipayParams(notification), 'utf8'),
    alipayPlatformKeys.privateKey,
  ).toString('base64'));
  return notification;
}

function centsToTestAmount(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function signWechatMessage(timestamp, nonce, rawBody, privateKey) {
  return cryptoSign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), privateKey).toString('base64');
}

function temporaryDataDir() {
  const root = resolve(tmpdir());
  const directory = resolve(mkdtempSync(join(root, 'teacher-helper-payment-')));
  assert.equal(dirname(directory), root, 'temporary payment directory must stay directly under the system temp directory');
  return directory;
}

function removeTemporaryDataDir(directory) {
  const absolute = resolve(directory);
  assert.equal(dirname(absolute), resolve(tmpdir()), 'refusing to remove a directory outside the system temp directory');
  assert.match(absolute.slice(resolve(tmpdir()).length), /^[\\/]teacher-helper-payment-/);
  rmSync(absolute, { recursive: true, force: true });
}

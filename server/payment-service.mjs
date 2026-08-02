import { randomUUID } from 'node:crypto';
import {
  PaymentError,
  applyAuthoritativeProductQuote,
  alipayAmountToCents,
  assertWechatNotificationSignature,
  buildAlipayPagePayRequest,
  buildWechatNativeOrderRequest,
  decryptWechatResource,
  generateMerchantOrderNo,
  mapAlipayTradeStatus,
  mapWechatTradeState,
  normalizeCreateOrderInput,
  paymentRequestHash,
  safeStringEqual,
  testPaymentConfig,
  transitionPayment,
  verifyAlipayNotification,
} from './payment-core.mjs';
import { createPaymentStore, publicPaymentOrder } from './payment-store.mjs';

export function createPaymentService({
  dataDir,
  encryptionSecret,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  gatewayTimeoutMs = 15_000,
  resolveProduct,
  publicBaseUrl = '',
  fulfillPaidOrder,
  confirmCheckout,
}) {
  const store = createPaymentStore({ dataDir, encryptionSecret, now });

  function listConfigs() {
    return store.listPublicConfigs();
  }

  function saveConfig(provider, input, actor) {
    return store.saveConfig(provider, input, actor);
  }

  function testConfig(provider) {
    return store.testConfig(provider);
  }

  function setEnabled(provider, enabled, actor) {
    return store.setConfigEnabled(provider, enabled, actor);
  }

  function listOrders(filters) {
    return store.listOrders(filters);
  }

  function getOrder(orderId, userId = '') {
    const order = store.findOrderById(orderId);
    if (!order || (userId && order.userId !== userId)) {
      throw new PaymentError(404, 'PAYMENT_ORDER_NOT_FOUND', '支付订单不存在');
    }
    return publicPaymentOrder(order);
  }

  async function createOrder(user, rawInput, requestOptions = {}) {
    if (!user?.id) throw new PaymentError(401, 'PAYMENT_AUTH_REQUIRED', '请先登录后再创建支付订单');
    const selection = normalizeCreateOrderInput({
      ...rawInput,
      idempotencyKey: requestOptions.idempotencyKey || rawInput?.idempotencyKey,
    });
    if (!selection.idempotencyKey) {
      throw new PaymentError(400, 'IDEMPOTENCY_KEY_REQUIRED', '创建支付订单必须提供 Idempotency-Key');
    }
    const config = requireEnabledConfig(selection.provider);
    const input = await resolveAuthoritativeProduct(selection, user);
    const requestHash = paymentRequestHash({ ...input, userId: user.id });
    const idempotent = store.findIdempotentOrder(input.provider, user.id, input.idempotencyKey);
    if (idempotent) {
      if (idempotent.requestHash !== requestHash) {
        throw new PaymentError(409, 'IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同订单参数');
      }
      return { order: publicPaymentOrder(idempotent), created: false, idempotent: true };
    }
    if (typeof confirmCheckout === 'function') {
      await confirmCheckout({ user, selection: input, rawInput });
    }

    const timestamp = isoNow(now);
    const order = {
      id: `pay_${randomUUID()}`,
      merchantOrderNo: generateMerchantOrderNo(new Date(timestamp).getTime()),
      provider: input.provider,
      userId: user.id,
      planId: input.planId,
      subject: input.subject,
      amountCents: input.amountCents,
      currency: input.currency,
      quoteId: input.quoteId,
      productSnapshot: input.productSnapshot,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      clientMetadata: input.clientMetadata,
      status: 'CREATED',
      statusHistory: [{ from: null, to: 'CREATED', at: timestamp, source: 'checkout' }],
      checkout: null,
      providerTradeNo: '',
      providerState: '',
      gatewayUnknown: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      paidAt: null,
      closedAt: null,
      refundedAt: null,
      fulfillment: { status: 'PENDING', attempts: 0, updatedAt: timestamp },
    };
    const inserted = store.createOrder(order);
    if (!inserted.created) return { order: publicPaymentOrder(inserted.order), created: false, idempotent: true };

    if (input.provider === 'alipay') {
      const request = buildAlipayPagePayRequest(order, config, { now: now() });
      const checkout = { type: 'alipay_page_form', action: request.action, method: request.method, fields: request.fields };
      const transitioned = store.updateOrder(order.id, (current) => ({
        ...transitionPayment(current, 'PENDING', { source: 'alipay.checkout' }, now()).order,
        checkout,
      }));
      return { order: publicPaymentOrder(transitioned), created: true, idempotent: false };
    }

    return createWechatOrder(order, config);
  }

  async function createWechatOrder(order, config) {
    if (typeof fetchImpl !== 'function') {
      store.updateOrder(order.id, (current) => transitionPayment(current, 'FAILED', { source: 'wechat.native', reason: 'HTTP client unavailable' }, now()).order);
      throw new PaymentError(503, 'PAYMENT_HTTP_CLIENT_UNAVAILABLE', '服务器未提供可用的 HTTPS 客户端');
    }
    const gatewayRequest = buildWechatNativeOrderRequest(order, config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), gatewayTimeoutMs);
    let gatewayResponse;
    let rawResponse = '';
    try {
      gatewayResponse = await fetchImpl(gatewayRequest.url, {
        method: gatewayRequest.method,
        headers: gatewayRequest.headers,
        body: gatewayRequest.body,
        signal: controller.signal,
      });
      rawResponse = await gatewayResponse.text();
    } catch {
      const uncertain = store.updateOrder(order.id, (current) => transitionPayment(current, 'PENDING', {
        source: 'wechat.native',
        reason: '网关请求结果未知，必须主动查单',
        gatewayUnknown: true,
      }, now()).order);
      throw new PaymentError(502, 'PAYMENT_GATEWAY_UNCERTAIN', '微信支付下单结果未知，订单已进入待核实状态，禁止用新订单号直接重试', {
        order: publicPaymentOrder(uncertain),
        reconciliationRequired: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    try {
      assertWechatNotificationSignature({ headers: gatewayResponse.headers, rawBody: rawResponse, config, now: now() });
    } catch {
      const uncertain = store.updateOrder(order.id, (current) => transitionPayment(current, 'PENDING', {
        source: 'wechat.native',
        reason: '网关响应验签失败，必须主动查单',
        gatewayUnknown: true,
      }, now()).order);
      throw new PaymentError(502, 'PAYMENT_GATEWAY_SIGNATURE_INVALID', '微信支付响应无法通过验签，订单已进入待核实状态', {
        order: publicPaymentOrder(uncertain),
        reconciliationRequired: true,
      });
    }

    let parsed;
    try {
      parsed = safeJson(rawResponse);
    } catch {
      const uncertain = store.updateOrder(order.id, (current) => transitionPayment(current, 'PENDING', {
        source: 'wechat.native',
        reason: '网关响应结构无效，必须主动查单',
        gatewayUnknown: true,
      }, now()).order);
      throw new PaymentError(502, 'PAYMENT_GATEWAY_RESPONSE_INVALID', '微信支付返回了无法解析的响应，订单已进入待核实状态', {
        order: publicPaymentOrder(uncertain),
        reconciliationRequired: true,
      });
    }
    if (!gatewayResponse.ok) {
      const isAmbiguous = gatewayResponse.status >= 500;
      const nextState = isAmbiguous ? 'PENDING' : 'FAILED';
      const failed = store.updateOrder(order.id, (current) => transitionPayment(current, nextState, {
        source: 'wechat.native',
        reason: cleanGatewayMessage(parsed?.message || parsed?.code || `HTTP ${gatewayResponse.status}`),
        gatewayUnknown: isAmbiguous,
      }, now()).order);
      throw new PaymentError(
        isAmbiguous ? 502 : 422,
        isAmbiguous ? 'PAYMENT_GATEWAY_UNCERTAIN' : 'PAYMENT_GATEWAY_REJECTED',
        isAmbiguous ? '微信支付暂未确认下单结果，订单需要主动查单' : '微信支付拒绝了下单请求',
        { order: publicPaymentOrder(failed), gatewayCode: cleanGatewayCode(parsed?.code), reconciliationRequired: isAmbiguous },
      );
    }
    if (!parsed?.code_url || typeof parsed.code_url !== 'string' || !parsed.code_url.startsWith('weixin://')) {
      const uncertain = store.updateOrder(order.id, (current) => transitionPayment(current, 'PENDING', {
        source: 'wechat.native',
        reason: '成功响应缺少 code_url，必须主动查单',
        gatewayUnknown: true,
      }, now()).order);
      throw new PaymentError(502, 'WECHAT_CODE_URL_MISSING', '微信支付响应缺少有效二维码地址，订单已进入待核实状态', {
        order: publicPaymentOrder(uncertain),
        reconciliationRequired: true,
      });
    }
    const checkout = { type: 'wechat_native_qr', codeUrl: parsed.code_url };
    const pending = store.updateOrder(order.id, (current) => ({
      ...transitionPayment(current, 'PENDING', { source: 'wechat.native' }, now()).order,
      checkout,
    }));
    return { order: publicPaymentOrder(pending), created: true, idempotent: false };
  }

  async function handleWechatNotification({ headers, rawBody }) {
    const config = requireConfiguredConfig('wechat');
    assertWechatNotificationSignature({ headers, rawBody, config, now: now() });
    const envelope = safeJson(rawBody, 400, 'WECHAT_NOTIFICATION_INVALID_JSON', '微信支付通知不是有效 JSON');
    if (!envelope?.id || !envelope?.resource) throw new PaymentError(400, 'WECHAT_NOTIFICATION_INVALID', '微信支付通知结构无效');
    const resource = decryptWechatResource(envelope.resource, config.apiV3Key);
    const nextState = mapWechatTradeState(resource.trade_state);
    if (!nextState) throw new PaymentError(400, 'WECHAT_TRADE_STATE_UNSUPPORTED', '微信支付通知包含未知交易状态');
    const notification = store.applyNotification({
      provider: 'wechat',
      eventId: envelope.id,
      merchantOrderNo: resource.out_trade_no,
      nextState,
      metadata: {
        source: 'wechat.notify',
        providerTradeNo: resource.transaction_id,
        providerState: resource.trade_state,
      },
      validate(order) {
        if (!safeStringEqual(resource.appid, config.appId) || !safeStringEqual(resource.mchid, config.merchantId)) {
          throw new PaymentError(400, 'WECHAT_MERCHANT_MISMATCH', '微信支付通知商户身份与配置不一致');
        }
        if (Number(resource.amount?.total) !== order.amountCents || String(resource.amount?.currency || 'CNY') !== order.currency) {
          throw new PaymentError(400, 'WECHAT_AMOUNT_MISMATCH', '微信支付通知金额或币种与订单不一致');
        }
      },
    });
    return ensurePaidOrderFulfilled(notification);
  }

  async function handleAlipayNotification({ rawBody }) {
    const config = requireConfiguredConfig('alipay');
    const parameters = new URLSearchParams(rawBody);
    if (!verifyAlipayNotification(parameters, config.alipayPublicKeyPem)) {
      throw new PaymentError(401, 'ALIPAY_SIGNATURE_INVALID', '支付宝通知验签失败');
    }
    const merchantOrderNo = parameters.get('out_trade_no') || '';
    const eventId = parameters.get('notify_id') || '';
    const providerState = parameters.get('trade_status') || '';
    const nextState = mapAlipayTradeStatus(providerState);
    if (!nextState) throw new PaymentError(400, 'ALIPAY_TRADE_STATE_UNSUPPORTED', '支付宝通知包含未知交易状态');
    const notification = store.applyNotification({
      provider: 'alipay',
      eventId,
      merchantOrderNo,
      nextState,
      metadata: {
        source: 'alipay.notify',
        providerTradeNo: parameters.get('trade_no') || '',
        providerState,
      },
      validate(order) {
        if (!safeStringEqual(parameters.get('app_id'), config.appId) || !safeStringEqual(parameters.get('seller_id'), config.sellerId)) {
          throw new PaymentError(400, 'ALIPAY_MERCHANT_MISMATCH', '支付宝通知应用或卖家身份与配置不一致');
        }
        if (alipayAmountToCents(parameters.get('total_amount')) !== order.amountCents) {
          throw new PaymentError(400, 'ALIPAY_AMOUNT_MISMATCH', '支付宝通知金额与订单不一致');
        }
      },
    });
    return ensurePaidOrderFulfilled(notification);
  }

  async function ensurePaidOrderFulfilled(notification) {
    const current = store.findOrderById(notification?.order?.id);
    if (!current || current.status !== 'PAID') return notification;
    if (current.fulfillment?.status === 'FULFILLED') {
      return { ...notification, order: current, fulfillment: current.fulfillment };
    }
    const attempts = Number(current.fulfillment?.attempts || 0) + 1;
    if (typeof fulfillPaidOrder !== 'function') {
      const unavailable = store.updateOrder(current.id, (order) => ({
        ...order,
        fulfillment: {
          status: 'RETRY_REQUIRED',
          attempts,
          lastError: '会员权益发放服务未接入',
          updatedAt: isoNow(now),
        },
      }));
      throw new PaymentError(503, 'PAYMENT_FULFILLMENT_UNAVAILABLE', '支付已确认，但会员权益发放服务暂不可用；支付通知需要重试', {
        order: publicPaymentOrder(unavailable),
        retryRequired: true,
      });
    }
    let result;
    try {
      result = await fulfillPaidOrder(structuredClone(current));
      if (!result || typeof result !== 'object' || !String(result.fulfillmentId || '').trim()) {
        throw new Error('权益发放结果缺少 fulfillmentId');
      }
    } catch (error) {
      const retryRequired = store.updateOrder(current.id, (order) => ({
        ...order,
        fulfillment: {
          status: 'RETRY_REQUIRED',
          attempts,
          lastError: cleanGatewayMessage(error?.message || '会员权益发放失败'),
          updatedAt: isoNow(now),
        },
      }));
      throw new PaymentError(503, 'PAYMENT_FULFILLMENT_RETRY_REQUIRED', '支付已确认，但会员权益尚未发放；支付通知需要重试', {
        order: publicPaymentOrder(retryRequired),
        retryRequired: true,
      });
    }
    const fulfilledAt = isoNow(now);
    const fulfilled = store.updateOrder(current.id, (order) => ({
      ...order,
      fulfillment: {
        status: 'FULFILLED',
        attempts,
        fulfillmentId: cleanGatewayMessage(result.fulfillmentId),
        duplicateGrant: Boolean(result.duplicate),
        creditsGranted: Number.isSafeInteger(result.creditsGranted) ? result.creditsGranted : 0,
        membershipStartsAt: result.membershipStartsAt || null,
        membershipExpiresAt: result.membershipExpiresAt || null,
        fulfilledAt,
        updatedAt: fulfilledAt,
      },
    }));
    return { ...notification, order: fulfilled, fulfillment: fulfilled.fulfillment };
  }

  return {
    createOrder,
    getOrder,
    handleAlipayNotification,
    handleWechatNotification,
    listConfigs,
    listOrders,
    saveConfig,
    setEnabled,
    testConfig,
  };

  function requireConfiguredConfig(provider) {
    const storedConfig = store.getConfigWithSecrets(provider);
    if (!storedConfig) throw new PaymentError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', `${providerName(provider)}尚未配置`);
    const config = withAutomaticCallbackUrls(provider, storedConfig, publicBaseUrl);
    const result = testPaymentConfig(provider, config);
    if (!result.ok) throw new PaymentError(503, 'PAYMENT_PROVIDER_CONFIG_INVALID', `${providerName(provider)}配置未通过本地校验`, { errors: result.errors });
    return config;
  }

  function requireEnabledConfig(provider) {
    const config = requireConfiguredConfig(provider);
    if (!config.enabled) throw new PaymentError(503, 'PAYMENT_PROVIDER_DISABLED', `${providerName(provider)}当前未启用`);
    return config;
  }

  async function resolveAuthoritativeProduct(selection, user) {
    if (typeof resolveProduct !== 'function') {
      throw new PaymentError(503, 'PAYMENT_PRODUCT_CATALOG_UNAVAILABLE', '服务端套餐目录尚未接入，当前不能创建真实支付订单');
    }
    let product;
    try {
      product = await resolveProduct({
        planId: selection.planId,
        provider: selection.provider,
        userId: user.id,
        clientMetadata: selection.clientMetadata,
      });
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError(503, 'PAYMENT_PRODUCT_CATALOG_UNAVAILABLE', '服务端套餐目录暂时不可用');
    }
    if (!product) throw new PaymentError(404, 'PAYMENT_PRODUCT_NOT_FOUND', '所选会员套餐不存在或已停止销售');
    return applyAuthoritativeProductQuote(selection, product);
  }
}

function withAutomaticCallbackUrls(provider, config, publicBaseUrl) {
  const baseUrl = String(publicBaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return config;
  return {
    ...config,
    notifyUrl: `${baseUrl}/api/payments/notify/${provider}`,
    ...(provider === 'alipay' ? { returnUrl: `${baseUrl}/app/membership?payment=completed` } : {}),
  };
}

function safeJson(value, status = 502, code = 'PAYMENT_GATEWAY_RESPONSE_INVALID', message = '支付网关返回了无效数据') {
  try { return JSON.parse(value); } catch { throw new PaymentError(status, code, message); }
}

function cleanGatewayMessage(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 240);
}

function cleanGatewayCode(value) {
  const code = String(value || '').slice(0, 80);
  return /^[A-Za-z0-9_.-]+$/.test(code) ? code : '';
}

function providerName(provider) {
  return provider === 'wechat' ? '微信支付' : '支付宝';
}

function isoNow(now) {
  const value = typeof now === 'function' ? now() : now;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

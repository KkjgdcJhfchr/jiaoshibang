import { PaymentError, PAYMENT_PROVIDERS, PAYMENT_STATES } from './payment-core.mjs';
import { createPaymentService } from './payment-service.mjs';

/**
 * `resolveProduct` is deliberately injected by the host application. It must
 * resolve a saleable plan to a server-owned quote shaped as
 * { planId, amountCents, currency: 'CNY', subject }. Client prices are only
 * treated as display quotes and are never authoritative.
 */
export function createPaymentRouter({
  dataDir,
  encryptionSecret,
  requireAdminSession,
  requireUserSession,
  fetchImpl = globalThis.fetch,
  now,
  gatewayTimeoutMs,
  resolveProduct,
  listProducts,
  listAdminProducts,
  saveProduct,
  publicBaseUrl = '',
  fulfillPaidOrder,
  confirmCheckout,
  checkoutVerificationRequired = false,
  logger = console,
}) {
  if (typeof requireAdminSession !== 'function' || typeof requireUserSession !== 'function') {
    throw new TypeError('payment router requires admin and user session guards');
  }
  const service = createPaymentService({
    dataDir,
    encryptionSecret,
    fetchImpl,
    now,
    gatewayTimeoutMs,
    resolveProduct,
    publicBaseUrl,
    fulfillPaidOrder,
    confirmCheckout,
  });

  async function handle(request, response, url) {
    if (!url.pathname.startsWith('/api/payments/') && !url.pathname.startsWith('/api/admin/payments/')) return false;
    try {
      if (request.method === 'GET' && url.pathname === '/api/payments/plans') {
        const plans = typeof listProducts === 'function' ? await listProducts() : [];
        const providers = service.listConfigs().map((config) => ({
          provider: config.provider,
          displayName: config.displayName,
          configured: Boolean(config.configured),
          enabled: Boolean(config.enabled && config.validation?.ok),
        }));
        sendJson(response, 200, {
          ok: true,
          data: { plans, providers, checkoutVerificationRequired: Boolean(checkoutVerificationRequired) },
        });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/payments/plans') {
        requireAdminSession(request);
        const plans = typeof listAdminProducts === 'function' ? await listAdminProducts() : [];
        sendJson(response, 200, { ok: true, data: { plans } });
        return true;
      }

      const planMatch = url.pathname.match(/^\/api\/admin\/payments\/plans\/([A-Za-z0-9_.:-]{2,80})$/);
      if (request.method === 'PUT' && planMatch) {
        assertSameOriginMutation(request);
        const session = requireAdminSession(request);
        if (typeof saveProduct !== 'function') throw new PaymentError(503, 'MEMBERSHIP_CATALOG_UNAVAILABLE', '会员套餐目录暂不可维护');
        const body = await readJsonBody(request, 64 * 1024);
        const plan = await saveProduct(planMatch[1], body, session.admin?.username || 'admin');
        sendJson(response, 200, { ok: true, data: { plan } });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/payments/configs') {
        requireAdminSession(request);
        const configs = service.listConfigs().map((config) => applyAutomaticCallbackUrls(config.provider, config, publicBaseUrl));
        sendJson(response, 200, { ok: true, data: { configs } });
        return true;
      }

      const configMatch = url.pathname.match(/^\/api\/admin\/payments\/configs\/(wechat|alipay)$/);
      if (request.method === 'PUT' && configMatch) {
        assertSameOriginMutation(request);
        const session = requireAdminSession(request);
        const body = await readJsonBody(request, 256 * 1024);
        const provider = configMatch[1];
        const config = service.saveConfig(
          provider,
          applyAutomaticCallbackUrls(provider, body, publicBaseUrl),
          session.admin?.username || 'admin',
        );
        sendJson(response, 200, { ok: true, data: { config } });
        return true;
      }

      const testMatch = url.pathname.match(/^\/api\/admin\/payments\/configs\/(wechat|alipay)\/test$/);
      if (request.method === 'POST' && testMatch) {
        assertSameOriginMutation(request);
        requireAdminSession(request);
        const result = service.testConfig(testMatch[1]);
        sendJson(response, result.result.ok ? 200 : 422, { ok: result.result.ok, data: result });
        return true;
      }

      const enabledMatch = url.pathname.match(/^\/api\/admin\/payments\/configs\/(wechat|alipay)\/enabled$/);
      if (request.method === 'PATCH' && enabledMatch) {
        assertSameOriginMutation(request);
        const session = requireAdminSession(request);
        const body = await readJsonBody(request, 16 * 1024);
        if (typeof body.enabled !== 'boolean') throw new PaymentError(400, 'PAYMENT_ENABLED_INVALID', 'enabled 必须是布尔值');
        const config = service.setEnabled(enabledMatch[1], body.enabled, session.admin?.username || 'admin');
        sendJson(response, 200, { ok: true, data: { config } });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/payments/orders') {
        requireAdminSession(request);
        const provider = url.searchParams.get('provider') || '';
        const status = url.searchParams.get('status') || '';
        if (provider && !PAYMENT_PROVIDERS.includes(provider)) throw new PaymentError(400, 'PAYMENT_PROVIDER_INVALID', '支付渠道筛选无效');
        if (status && !PAYMENT_STATES.includes(status)) throw new PaymentError(400, 'PAYMENT_STATUS_INVALID', '订单状态筛选无效');
        const data = service.listOrders({
          offset: boundedInteger(url.searchParams.get('offset'), 0, 0, 1_000_000),
          limit: boundedInteger(url.searchParams.get('limit'), 50, 1, 200),
          provider,
          status,
        });
        sendJson(response, 200, { ok: true, data });
        return true;
      }

      if (request.method === 'POST' && url.pathname === '/api/payments/orders') {
        assertSameOriginMutation(request);
        const session = requireUserSession(request);
        const body = await readJsonBody(request, 64 * 1024);
        const idempotencyKey = String(request.headers['idempotency-key'] || body.idempotencyKey || '').trim();
        const result = await service.createOrder(session.user, body, { idempotencyKey });
        sendJson(response, result.created ? 201 : 200, { ok: true, data: result });
        return true;
      }

      const orderMatch = url.pathname.match(/^\/api\/payments\/orders\/(pay_[0-9a-f-]{36})$/i);
      if (request.method === 'GET' && orderMatch) {
        const session = requireUserSession(request);
        sendJson(response, 200, { ok: true, data: { order: service.getOrder(orderMatch[1], session.user.id) } });
        return true;
      }

      if (request.method === 'POST' && url.pathname === '/api/payments/notify/wechat') {
        const rawBody = await readRawBody(request, 2 * 1024 * 1024, 'application/json');
        await service.handleWechatNotification({ headers: request.headers, rawBody });
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return true;
      }

      if (request.method === 'POST' && url.pathname === '/api/payments/notify/alipay') {
        const rawBody = await readRawBody(request, 512 * 1024, 'application/x-www-form-urlencoded');
        await service.handleAlipayNotification({ rawBody });
        sendText(response, 200, 'success');
        return true;
      }

      throw new PaymentError(404, 'PAYMENT_ROUTE_NOT_FOUND', '支付接口不存在');
    } catch (error) {
      const known = Number.isInteger(error?.status) && typeof error?.code === 'string';
      if (!known) logger.error?.('[teacher-helper:payment]', error);
      if (url.pathname === '/api/payments/notify/alipay') {
        sendText(response, known ? error.status : 500, 'fail');
      } else if (url.pathname === '/api/payments/notify/wechat') {
        sendJson(response, known ? error.status : 500, {
          code: 'FAIL',
          message: known ? error.message : '支付服务内部错误',
        });
      } else {
        sendJson(response, known ? error.status : 500, {
          ok: false,
          error: {
            code: known ? error.code : 'PAYMENT_INTERNAL_ERROR',
            message: known ? error.message : '支付服务内部错误',
            ...(known && error.details ? { details: error.details } : {}),
          },
        });
      }
      return true;
    }
  }

  return { handle, service };
}

function applyAutomaticCallbackUrls(provider, input, publicBaseUrl) {
  const baseUrl = String(publicBaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return input;
  return {
    ...input,
    notifyUrl: `${baseUrl}/api/payments/notify/${provider}`,
    ...(provider === 'alipay' ? { returnUrl: `${baseUrl}/app/membership?payment=completed` } : {}),
  };
}

async function readJsonBody(request, maximumBytes) {
  const raw = await readRawBody(request, maximumBytes, 'application/json');
  try { return JSON.parse(raw); } catch { throw new PaymentError(400, 'PAYMENT_JSON_INVALID', '请求体不是有效 JSON'); }
}

async function readRawBody(request, maximumBytes, expectedContentType) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes(expectedContentType)) {
    throw new PaymentError(415, 'PAYMENT_CONTENT_TYPE_INVALID', `Content-Type 必须包含 ${expectedContentType}`);
  }
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > maximumBytes) throw new PaymentError(413, 'PAYMENT_BODY_TOO_LARGE', '支付请求体过大');
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes) throw new PaymentError(413, 'PAYMENT_BODY_TOO_LARGE', '支付请求体过大');
    chunks.push(chunk);
  }
  if (!received) throw new PaymentError(400, 'PAYMENT_BODY_EMPTY', '支付请求体不能为空');
  return Buffer.concat(chunks).toString('utf8');
}

function assertSameOriginMutation(request) {
  const fetchSite = String(request.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') throw new PaymentError(403, 'PAYMENT_CROSS_SITE_BLOCKED', '拒绝跨站支付配置或下单请求');
  const origin = String(request.headers.origin || '');
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== String(request.headers.host || '')) throw new Error('mismatch');
  } catch {
    throw new PaymentError(403, 'PAYMENT_ORIGIN_INVALID', '支付请求来源校验失败');
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function sendJson(response, status, payload) {
  if (response.headersSent) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendText(response, status, text) {
  if (response.headersSent) return;
  const body = String(text);
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createPromotionsStore } from './promotions-store.mjs';
import { createPaymentRouter } from './payment-routes.mjs';

const ACTIVE_AT = new Date('2026-09-10T00:00:00.000Z');
const ENCRYPTION_SECRET = 'promotion-tests-session-secret-0123456789abcdef';

test('独立优惠活动支持百分比、庆祝模板、内容、目标套餐、持久化 CRUD 和有效价解析', (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-promotions-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = createPromotionsStore({ dataDir, now: () => ACTIVE_AT });
  const created = store.createPromotion({
    id: 'opening-celebration',
    name: '开站庆祝活动',
    template: 'celebration',
    content: '庆祝平台正式上线，专业版限时优惠。',
    discountPercent: 20,
    targetPlanIds: ['pro-monthly', 'pro-yearly'],
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-09-30T00:00:00.000Z',
    enabled: true,
  }, 'promotion-admin');
  assert.equal(created.promotionId, created.id);
  assert.equal(created.title, '开站庆祝活动');
  assert.equal(created.name, created.title);
  assert.equal(created.label, created.title);
  assert.equal(created.content, '庆祝平台正式上线，专业版限时优惠。');
  assert.equal(created.template, 'celebration');
  assert.equal(created.active, true);
  assert.equal(store.resolveEffectivePrice({ planId: 'pro-monthly', amountCents: 3_900 }).amountCents, 3_120);
  assert.equal(store.resolveEffectivePrice({ planId: 'research-monthly', amountCents: 9_900 }).amountCents, 9_900);

  const reloaded = createPromotionsStore({ dataDir, now: () => ACTIVE_AT });
  assert.equal(reloaded.getPromotion(created.id).content, created.content);
  const updated = reloaded.updatePromotion(created.id, {
    expectedUpdatedAt: created.updatedAt,
    label: '周年庆祝活动',
    discountPercent: 25,
  }, 'promotion-admin');
  assert.equal(updated.title, '周年庆祝活动');
  assert.equal(updated.content, created.content);
  assert.equal(reloaded.resolveEffectivePrice({ planId: 'pro-monthly', amountCents: 3_900 }).amountCents, 2_925);
  assert.equal(reloaded.deletePromotion(created.id).id, created.id);
  assert.equal(reloaded.listPromotions().length, 0);
});

test('支付路由公开免费版并提供优惠活动 GET/POST/PUT/DELETE 接口', async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-promotion-routes-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const plans = [
    { planId: 'free', name: '免费版', kind: 'free', purchasable: false, amountCents: 0, regularAmountCents: 0, credits: 3, saleable: true },
    { planId: 'pro-monthly', name: '专业版月卡', kind: 'paid', purchasable: true, amountCents: 3_900, regularAmountCents: 3_900, credits: 20, saleable: true },
  ];
  const router = createPaymentRouter({
    dataDir,
    encryptionSecret: ENCRYPTION_SECRET,
    requireAdminSession: () => ({ admin: { username: 'route-admin' } }),
    requireUserSession: () => ({ user: { id: 'usr_route' } }),
    listProducts: () => plans,
    listAdminProducts: () => plans,
    resolveProduct: ({ planId }) => plans.find((plan) => plan.planId === planId && plan.purchasable) || null,
    saveProduct: () => null,
    now: () => ACTIVE_AT,
  });

  const publicPlans = await callRoute(router, 'GET', '/api/payments/plans');
  assert.equal(publicPlans.status, 200);
  assert.equal(publicPlans.payload.data.plans.some((plan) => plan.planId === 'free' && plan.purchasable === false), true);

  const create = await callRoute(router, 'POST', '/api/admin/promotions', {
    title: '开学庆祝',
    template: 'celebration',
    content: '新学期优惠',
    discountPercent: 10,
    targetPlanIds: ['pro-monthly'],
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-09-30T00:00:00.000Z',
    enabled: true,
  });
  assert.equal(create.status, 201);
  const promotionId = create.payload.data.promotion.id;
  const list = await callRoute(router, 'GET', '/api/admin/promotions');
  assert.equal(list.payload.data.promotions.length, 1);
  const update = await callRoute(router, 'PUT', `/api/admin/promotions/${promotionId}`, { discountPercent: 15 });
  assert.equal(update.payload.data.promotion.discountPercent, 15);
  const effective = await callRoute(router, 'GET', '/api/promotions/effective?planId=pro-monthly');
  assert.equal(effective.payload.data.plan.amountCents, 3_315);
  const remove = await callRoute(router, 'DELETE', `/api/admin/promotions/${promotionId}`);
  assert.equal(remove.status, 200);
  assert.equal((await callRoute(router, 'GET', '/api/admin/promotions')).payload.data.promotions.length, 0);
});

async function callRoute(router, method, path, body) {
  const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const request = Readable.from(raw ? [raw] : []);
  request.method = method;
  request.headers = {
    host: 'example.test',
    origin: 'https://example.test',
    'sec-fetch-site': 'same-origin',
    ...(raw ? { 'content-type': 'application/json', 'content-length': String(raw.length) } : {}),
  };
  const result = { status: 0, headers: {}, body: '' };
  const response = {
    headersSent: false,
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
      this.headersSent = true;
    },
    end(chunk = '') { result.body += String(chunk); },
  };
  const handled = await router.handle(request, response, new URL(path, 'https://example.test'));
  assert.equal(handled, true);
  return { ...result, payload: result.body ? JSON.parse(result.body) : null };
}

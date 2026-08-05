import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CATALOG_DATE = '2026-08-01T00:00:00.000Z';
const MAX_PRODUCTS = 50;

const DEFAULT_PRODUCTS = Object.freeze([
  defaultFreeProduct('free', '免费版', 3,
    ['基础教案生成', 'AI 教案修改', 'DOCX / PDF 导出', '点数余额查询']),
  defaultProduct('pro-monthly', '专业版月卡', 'pro', 10, 'month', 3_900, 30, 20,
    ['20 次教案生成点数', 'AI 教案修改', 'DOCX / PDF 导出', '历史版本长期保存']),
  defaultProduct('pro-quarterly', '专业版季卡', 'pro', 10, 'quarter', 10_500, 90, 60,
    ['60 次教案生成点数', 'AI 教案修改', 'DOCX / PDF 导出', '历史版本长期保存']),
  defaultProduct('pro-half-yearly', '专业版半年卡', 'pro', 10, 'half_year', 19_800, 180, 120,
    ['120 次教案生成点数', 'AI 教案修改', 'DOCX / PDF 导出', '历史版本长期保存']),
  defaultProduct('pro-yearly', '专业版年卡', 'pro', 10, 'year', 32_400, 365, 240,
    ['240 次教案生成点数', 'AI 教案修改', 'DOCX / PDF 导出', '历史版本长期保存']),
  defaultProduct('research-monthly', '教研版月卡', 'research', 20, 'month', 9_900, 30, 80,
    ['80 次教案生成点数', '共享教案模板库', '模型质量报告', '优先客服支持']),
  defaultProduct('research-quarterly', '教研版季卡', 'research', 20, 'quarter', 26_700, 90, 240,
    ['240 次教案生成点数', '共享教案模板库', '模型质量报告', '优先客服支持']),
  defaultProduct('research-half-yearly', '教研版半年卡', 'research', 20, 'half_year', 49_800, 180, 480,
    ['480 次教案生成点数', '共享教案模板库', '模型质量报告', '优先客服支持']),
  defaultProduct('research-yearly', '教研版年卡', 'research', 20, 'year', 82_800, 365, 960,
    ['960 次教案生成点数', '共享教案模板库', '模型质量报告', '优先客服支持']),
]);

export function createMembershipCatalog({ dataDir, now = () => new Date(), getSiteName = () => '在线教育平台' }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'membership-products.json');
  const state = readCatalog(filename);

  function listProducts({ includeInactive = false, includeArchived = false, includeFree = true } = {}) {
    return state.products
      .filter((product) => includeArchived || !product.archivedAt)
      .filter((product) => includeFree || product.kind !== 'free')
      .filter((product) => includeInactive || product.saleable)
      .sort((left, right) => left.tierRank - right.tierRank || left.amountCents - right.amountCents)
      .map((product) => publicMembershipProduct(product, { at: now(), getSiteName }));
  }

  function getFreeProduct() {
    const product = state.products.find((item) => item.kind === 'free' && !item.archivedAt);
    return product ? publicMembershipProduct(product, { at: now(), getSiteName }) : null;
  }

  function resolveProduct({ planId }) {
    const product = state.products.find((item) => (
      item.planId === String(planId || '')
      && item.saleable
      && item.purchasable
      && !item.archivedAt
    ));
    return product ? buildPaymentProduct(product, now(), getSiteName) : null;
  }

  function saveProduct(planId, input, actor = 'admin') {
    const normalizedPlanId = normalizePlanId(planId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw catalogError(400, 'MEMBERSHIP_PRODUCT_INVALID', '套餐配置必须是对象');
    const index = state.products.findIndex((product) => product.planId === normalizedPlanId);
    const existing = index >= 0 ? state.products[index] : null;
    if (existing?.archivedAt) throw catalogError(409, 'MEMBERSHIP_PRODUCT_ARCHIVED', '套餐已经归档，不能继续修改');
    if (!existing && state.products.length >= MAX_PRODUCTS) throw catalogError(409, 'MEMBERSHIP_PRODUCT_LIMIT', `套餐数量不能超过 ${MAX_PRODUCTS} 个`);
    if (existing && input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
      throw catalogError(409, 'MEMBERSHIP_PRODUCT_CONFLICT', '套餐已被其他管理员修改，请刷新后重试');
    }
    const timestamp = toIso(now());
    const product = normalizeProduct(normalizedPlanId, input, existing, timestamp, actor);
    if (index >= 0) state.products[index] = product;
    else state.products.push(product);
    state.updatedAt = timestamp;
    writeCatalog(filename, state);
    return publicMembershipProduct(product, { at: now(), getSiteName });
  }

  function archiveProduct(planId, actor = 'admin') {
    const normalizedPlanId = normalizePlanId(planId);
    const index = state.products.findIndex((product) => product.planId === normalizedPlanId);
    if (index < 0) throw catalogError(404, 'MEMBERSHIP_PRODUCT_NOT_FOUND', '套餐不存在');
    const existing = state.products[index];
    if (existing.kind === 'free') throw catalogError(409, 'MEMBERSHIP_FREE_PRODUCT_REQUIRED', '免费版是基础账户权益，不能删除');
    if (existing.archivedAt) return publicMembershipProduct(existing, { at: now(), getSiteName });
    const timestamp = toIso(now());
    const archived = {
      ...existing,
      saleable: false,
      archivedAt: timestamp,
      updatedAt: timestamp,
      updatedBy: String(actor || 'admin').trim().slice(0, 100) || 'admin',
    };
    state.products[index] = archived;
    state.updatedAt = timestamp;
    writeCatalog(filename, state);
    return publicMembershipProduct(archived, { at: now(), getSiteName });
  }

  // `saveProduct` is already injected into the payment router by the host.
  // Exposing the archive operation on that function keeps older host wiring
  // compatible while allowing DELETE support without a second injection.
  saveProduct.archiveProduct = archiveProduct;

  return { listProducts, getFreeProduct, resolveProduct, saveProduct, archiveProduct };
}

// Stateless exports keep unit tests and isolated payment-service consumers simple.
export function listMembershipProducts({ includeFree = true, getSiteName } = {}) {
  return DEFAULT_PRODUCTS
    .filter((product) => includeFree || product.kind !== 'free')
    .map((product) => publicMembershipProduct(product, { getSiteName }));
}

export function resolveMembershipProduct({ planId, getSiteName }) {
  const product = DEFAULT_PRODUCTS.find((item) => (
    item.planId === String(planId || '')
    && item.saleable
    && item.purchasable
    && !item.archivedAt
  ));
  return product ? buildPaymentProduct(product, new Date(), getSiteName) : null;
}

export function publicMembershipProduct(product, { at = new Date(), getSiteName } = {}) {
  const promotion = activePromotion(product, at);
  const effectiveAmountCents = promotion?.amountCents ?? product.amountCents;
  const siteName = resolveSiteName(getSiteName);
  return {
    planId: product.planId,
    name: product.name,
    subject: `${siteName} · ${product.name}`,
    amountCents: effectiveAmountCents,
    regularAmountCents: product.amountCents,
    currency: 'CNY',
    billingPeriod: product.billingPeriod,
    durationDays: product.durationDays,
    credits: product.credits,
    tier: product.tier,
    tierRank: product.tierRank,
    kind: product.kind,
    purchasable: Boolean(product.purchasable),
    features: migrateMembershipFeatures(product.features),
    saleable: Boolean(product.saleable),
    autoRenew: false,
    promotion: product.promotion ? {
      label: product.promotion.label,
      amountCents: product.promotion.amountCents,
      startsAt: product.promotion.startsAt,
      endsAt: product.promotion.endsAt,
      active: Boolean(promotion),
    } : null,
    updatedAt: product.updatedAt,
    updatedBy: product.updatedBy,
    archivedAt: product.archivedAt || null,
  };
}

function buildPaymentProduct(product, at = new Date(), getSiteName) {
  const promotion = activePromotion(product, at);
  const amountCents = promotion?.amountCents ?? product.amountCents;
  const catalogVersion = productFingerprint(product, amountCents);
  const quoteId = `${catalogVersion}:${product.planId}:${amountCents}`;
  const siteName = resolveSiteName(getSiteName);
  return {
    planId: product.planId,
    name: product.name,
    subject: `${siteName} · ${product.name}`,
    amountCents,
    regularAmountCents: product.amountCents,
    currency: 'CNY',
    quoteId,
    saleable: product.saleable,
    kind: product.kind,
    purchasable: Boolean(product.purchasable),
    promotion: promotion ? { ...promotion } : null,
    features: migrateMembershipFeatures(product.features),
    entitlement: {
      type: 'membership',
      tier: product.tier,
      tierRank: product.tierRank,
      billingPeriod: product.billingPeriod,
      durationDays: product.durationDays,
      credits: product.credits,
      catalogVersion,
      quoteId,
    },
  };
}

function defaultProduct(planId, name, tier, tierRank, billingPeriod, amountCents, durationDays, credits, features) {
  return Object.freeze({
    planId,
    name,
    kind: 'paid',
    purchasable: true,
    tier,
    tierRank,
    billingPeriod,
    amountCents,
    durationDays,
    credits,
    features: Object.freeze(features),
    promotion: null,
    saleable: true,
    createdAt: DEFAULT_CATALOG_DATE,
    updatedAt: DEFAULT_CATALOG_DATE,
    updatedBy: 'system-default',
    archivedAt: null,
  });
}

function defaultFreeProduct(planId, name, credits, features) {
  return Object.freeze({
    planId,
    name,
    kind: 'free',
    purchasable: false,
    tier: 'free',
    tierRank: 0,
    billingPeriod: 'free',
    amountCents: 0,
    durationDays: 0,
    credits,
    features: Object.freeze(features),
    promotion: null,
    saleable: true,
    createdAt: DEFAULT_CATALOG_DATE,
    updatedAt: DEFAULT_CATALOG_DATE,
    updatedBy: 'system-default',
    archivedAt: null,
  });
}

function normalizeProduct(planId, input, existing, timestamp, actor) {
  const value = (field, fallback = '') => input[field] === undefined ? (existing?.[field] ?? fallback) : input[field];
  const kind = String(value('kind', planId === 'free' ? 'free' : 'paid')).trim().toLowerCase();
  if (existing && kind !== existing.kind) throw catalogError(409, 'MEMBERSHIP_PRODUCT_KIND_IMMUTABLE', '套餐类型创建后不能修改');
  if (!['free', 'paid'].includes(kind)) throw catalogError(422, 'MEMBERSHIP_PRODUCT_KIND_INVALID', '套餐类型只能是免费版或付费版');
  const name = String(value('name')).trim().slice(0, 60);
  const tier = String(value('tier')).trim().toLowerCase();
  const tierRank = Number(value('tierRank'));
  const billingPeriod = kind === 'free' ? 'free' : String(value('billingPeriod')).trim().toLowerCase();
  const amountCents = kind === 'free' ? 0 : Number(value('amountCents'));
  const durationDays = kind === 'free' ? 0 : Number(value('durationDays'));
  const credits = Number(value('credits'));
  const rawFeatures = value('features', []);
  const promotion = kind === 'free' ? null : normalizePromotion(value('promotion', null), amountCents);
  if (name.length < 2) throw catalogError(422, 'MEMBERSHIP_PRODUCT_NAME_INVALID', '套餐名称至少需要 2 个字符');
  if (!/^[a-z0-9_.:-]{2,40}$/.test(tier)) throw catalogError(422, 'MEMBERSHIP_PRODUCT_TIER_INVALID', '会员等级标识格式无效');
  if (!Number.isSafeInteger(tierRank) || tierRank < (kind === 'free' ? 0 : 1) || tierRank > 10_000) throw catalogError(422, 'MEMBERSHIP_PRODUCT_TIER_RANK_INVALID', `会员等级权重需为 ${kind === 'free' ? '0' : '1'}-10000 的整数`);
  if (kind === 'paid' && !['month', 'quarter', 'half_year', 'year'].includes(billingPeriod)) {
    throw catalogError(422, 'MEMBERSHIP_PRODUCT_PERIOD_INVALID', '计费周期只能是月付、季付、半年付或年付');
  }
  if (kind === 'paid' && (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000)) throw catalogError(422, 'MEMBERSHIP_PRODUCT_PRICE_INVALID', '套餐价格需为 1-100000000 分的整数');
  if (kind === 'paid' && (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3_660)) throw catalogError(422, 'MEMBERSHIP_PRODUCT_DURATION_INVALID', '套餐有效期需为 1-3660 天');
  if (!Number.isSafeInteger(credits) || credits < 0 || credits > 1_000_000) throw catalogError(422, 'MEMBERSHIP_PRODUCT_CREDITS_INVALID', '套餐点数需为 0-1000000 的整数');
  if (!Array.isArray(rawFeatures) || rawFeatures.length > 12) throw catalogError(422, 'MEMBERSHIP_PRODUCT_FEATURES_INVALID', '套餐权益说明最多 12 项');
  const features = migrateMembershipFeatures(rawFeatures);
  if (!features.length) throw catalogError(422, 'MEMBERSHIP_PRODUCT_FEATURES_INVALID', '请至少填写一项套餐权益说明');
  return {
    planId,
    name,
    kind,
    purchasable: kind === 'paid',
    tier,
    tierRank,
    billingPeriod,
    amountCents,
    durationDays,
    credits,
    features,
    promotion,
    saleable: Boolean(value('saleable', true)),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: String(actor || 'admin').trim().slice(0, 100) || 'admin',
    archivedAt: value('archivedAt', null) ? toIso(value('archivedAt')) : null,
  };
}

function readCatalog(filename) {
  if (!existsSync(filename)) return { version: 1, updatedAt: DEFAULT_CATALOG_DATE, products: DEFAULT_PRODUCTS.map((item) => structuredClone(item)) };
  let parsed;
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')); } catch (error) { throw new Error(`会员套餐目录无法读取：${error.message}`); }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.products)) throw new Error('membership-products.json 数据结构无效');
  if (parsed.products.length > MAX_PRODUCTS) throw new Error(`membership-products.json 套餐数量超过 ${MAX_PRODUCTS}`);
  const seen = new Set();
  parsed.products = parsed.products.map((product) => {
    const planId = normalizePlanId(product.planId);
    if (seen.has(planId)) throw new Error(`membership-products.json 包含重复套餐 ${planId}`);
    seen.add(planId);
    return normalizeProduct(planId, product, null, product.updatedAt || DEFAULT_CATALOG_DATE, product.updatedBy || 'admin');
  });
  for (const product of DEFAULT_PRODUCTS) {
    if (seen.has(product.planId)) continue;
    parsed.products.push(structuredClone(product));
    seen.add(product.planId);
  }
  return parsed;
}

function writeCatalog(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

// 套餐权益属于用户可见承诺。旧部署可能已把已下线的导出能力写入持久化目录，
// 因此在加载、保存和公开报价时都做同一份窄范围迁移，同时保留其他权益原文。
function migrateMembershipFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features
    .map((item) => String(item || '').trim().slice(0, 100))
    .filter(Boolean)
    .map((feature) => feature
      .replace(/DOC\s*\/\s*打印-?PDF(?:\s*\/\s*JSON)?\s*导出/gi, 'DOCX / PDF 导出')
      .replace(/AI\s*修改与结构化(?:教案)?导出/gi, 'AI 修改与 DOCX / PDF 导出')
      .replace(/结构化(?:教案)?导出/gi, 'DOCX / PDF 导出')
      .replace(/JSON\s*导出/gi, 'DOCX / PDF 导出')
      .replace(/\s*\/\s*JSON\b/gi, '')
      .replace(/\s{2,}/g, ' '));
}

function normalizePlanId(value) {
  const planId = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:-]{2,80}$/.test(planId)) throw catalogError(400, 'MEMBERSHIP_PLAN_ID_INVALID', '套餐标识格式无效');
  return planId;
}

function productFingerprint(product, effectiveAmountCents = product.amountCents) {
  return `catalog-${createHash('sha256').update(JSON.stringify({
    planId: product.planId,
    name: product.name,
    tier: product.tier,
    tierRank: product.tierRank,
    billingPeriod: product.billingPeriod,
    amountCents: product.amountCents,
    effectiveAmountCents,
    promotion: product.promotion,
    durationDays: product.durationDays,
    credits: product.credits,
    updatedAt: product.updatedAt,
  })).digest('hex').slice(0, 20)}`;
}

function normalizePromotion(value, regularAmountCents) {
  if (value === null || value === '' || value === false) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw catalogError(422, 'MEMBERSHIP_PROMOTION_INVALID', '套餐限时优惠配置无效');
  const label = String(value.label || '').trim().slice(0, 30);
  const amountCents = Number(value.amountCents);
  const startsAt = toIso(value.startsAt);
  const endsAt = toIso(value.endsAt);
  if (!label) throw catalogError(422, 'MEMBERSHIP_PROMOTION_LABEL_INVALID', '限时优惠必须填写展示标签');
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents >= regularAmountCents) {
    throw catalogError(422, 'MEMBERSHIP_PROMOTION_PRICE_INVALID', '优惠价必须是低于原价的正整数分');
  }
  if (new Date(endsAt) <= new Date(startsAt)) throw catalogError(422, 'MEMBERSHIP_PROMOTION_PERIOD_INVALID', '限时优惠结束时间必须晚于开始时间');
  return { label, amountCents, startsAt, endsAt };
}

function activePromotion(product, at) {
  if (!product.promotion) return null;
  const timestamp = (at instanceof Date ? at : new Date(at)).getTime();
  const startsAt = new Date(product.promotion.startsAt).getTime();
  const endsAt = new Date(product.promotion.endsAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp < startsAt || timestamp >= endsAt) return null;
  return product.promotion;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('系统时间无效');
  return date.toISOString();
}

function resolveSiteName(getSiteName) {
  let value = '';
  try { value = typeof getSiteName === 'function' ? getSiteName() : getSiteName; } catch { value = ''; }
  return String(value || '').trim().slice(0, 60) || '在线教育平台';
}

function catalogError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

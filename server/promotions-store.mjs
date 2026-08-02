import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_PROMOTIONS = 200;

export function createPromotionsStore({ dataDir, now = () => new Date() }) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'promotions.json');
  const state = readState(filename);

  function listPromotions({ includeDisabled = true } = {}) {
    return state.promotions
      .filter((promotion) => includeDisabled || promotion.enabled)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((promotion) => publicPromotion(promotion, now()));
  }

  function getPromotion(promotionId) {
    const id = normalizePromotionId(promotionId);
    const promotion = state.promotions.find((item) => item.id === id);
    return promotion ? publicPromotion(promotion, now()) : null;
  }

  function createPromotion(input, actor = 'admin') {
    if (state.promotions.length >= MAX_PROMOTIONS) {
      throw promotionError(409, 'PROMOTION_LIMIT_REACHED', `优惠活动数量不能超过 ${MAX_PROMOTIONS} 个`);
    }
    const requestedId = String(input?.id || input?.promotionId || '').trim();
    const id = normalizePromotionId(requestedId || `promo_${randomUUID()}`);
    if (state.promotions.some((item) => item.id === id)) {
      throw promotionError(409, 'PROMOTION_ALREADY_EXISTS', '优惠活动标识已经存在');
    }
    const timestamp = toIso(now());
    const promotion = normalizePromotion(id, input, null, timestamp, actor);
    state.promotions.push(promotion);
    state.updatedAt = timestamp;
    writeState(filename, state);
    return publicPromotion(promotion, now());
  }

  function updatePromotion(promotionId, input, actor = 'admin') {
    const id = normalizePromotionId(promotionId);
    const index = state.promotions.findIndex((item) => item.id === id);
    if (index < 0) throw promotionError(404, 'PROMOTION_NOT_FOUND', '优惠活动不存在');
    const existing = state.promotions[index];
    if (input?.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
      throw promotionError(409, 'PROMOTION_CONFLICT', '优惠活动已被其他管理员修改，请刷新后重试');
    }
    const timestamp = toIso(now());
    const promotion = normalizePromotion(id, input, existing, timestamp, actor);
    state.promotions[index] = promotion;
    state.updatedAt = timestamp;
    writeState(filename, state);
    return publicPromotion(promotion, now());
  }

  function deletePromotion(promotionId) {
    const id = normalizePromotionId(promotionId);
    const index = state.promotions.findIndex((item) => item.id === id);
    if (index < 0) throw promotionError(404, 'PROMOTION_NOT_FOUND', '优惠活动不存在');
    const [deleted] = state.promotions.splice(index, 1);
    state.updatedAt = toIso(now());
    writeState(filename, state);
    return publicPromotion(deleted, now());
  }

  function resolveEffectivePrice({ planId, amountCents }, { at = now() } = {}) {
    const normalizedPlanId = String(planId || '').trim();
    const regularAmountCents = Number(amountCents);
    if (!normalizedPlanId || !Number.isSafeInteger(regularAmountCents) || regularAmountCents < 0) {
      throw promotionError(400, 'PROMOTION_PRICE_INPUT_INVALID', '有效价解析需要合法的套餐标识和整数分价格');
    }
    if (regularAmountCents === 0) {
      return { planId: normalizedPlanId, regularAmountCents, amountCents: 0, discountAmountCents: 0, promotion: null };
    }
    const instant = validDate(at);
    if (!instant) throw promotionError(400, 'PROMOTION_TIME_INVALID', '有效价解析时间无效');
    const candidates = state.promotions
      .filter((promotion) => isPromotionActive(promotion, instant) && promotion.targetPlanIds.includes(normalizedPlanId))
      .map((promotion) => ({
        promotion,
        amountCents: Math.max(1, Math.floor(regularAmountCents * (100 - promotion.discountPercent) / 100)),
      }))
      .sort((left, right) => (
        left.amountCents - right.amountCents
        || right.promotion.discountPercent - left.promotion.discountPercent
        || right.promotion.updatedAt.localeCompare(left.promotion.updatedAt)
        || left.promotion.id.localeCompare(right.promotion.id)
      ));
    const winner = candidates[0] || null;
    return {
      planId: normalizedPlanId,
      regularAmountCents,
      amountCents: winner?.amountCents ?? regularAmountCents,
      discountAmountCents: winner ? regularAmountCents - winner.amountCents : 0,
      promotion: winner ? { ...publicPromotion(winner.promotion, instant), active: true } : null,
    };
  }

  function resolveEffectiveProduct(product, options = {}) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) return product;
    if (product.purchasable === false || product.kind === 'free') return { ...product };
    const regularAmountCents = Number(product.regularAmountCents ?? product.amountCents);
    const currentAmountCents = Number(product.amountCents);
    const resolved = resolveEffectivePrice({ planId: product.planId, amountCents: regularAmountCents }, options);
    if (!resolved.promotion || resolved.amountCents >= currentAmountCents) return { ...product };
    const promotionVersion = createHash('sha256').update(JSON.stringify({
      baseQuoteId: product.quoteId || '',
      promotionId: resolved.promotion.id,
      promotionUpdatedAt: resolved.promotion.updatedAt,
      amountCents: resolved.amountCents,
    })).digest('hex').slice(0, 20);
    const quoteId = `promotion-${promotionVersion}:${product.planId}:${resolved.amountCents}`;
    return {
      ...product,
      amountCents: resolved.amountCents,
      regularAmountCents,
      ...(product.quoteId ? { quoteId } : {}),
      ...(product.entitlement ? {
        entitlement: {
          ...product.entitlement,
          catalogVersion: `${String(product.entitlement.catalogVersion || 'catalog').slice(0, 50)}:${promotionVersion}`,
          quoteId,
        },
      } : {}),
      promotion: {
        id: resolved.promotion.id,
        label: resolved.promotion.title,
        title: resolved.promotion.title,
        template: resolved.promotion.template,
        discountPercent: resolved.promotion.discountPercent,
        startsAt: resolved.promotion.startsAt,
        endsAt: resolved.promotion.endsAt,
        active: true,
      },
    };
  }

  return {
    createPromotion,
    deletePromotion,
    getPromotion,
    listPromotions,
    resolveEffectivePrice,
    resolveEffectiveProduct,
    updatePromotion,
  };
}

function normalizePromotion(id, input, existing, timestamp, actor) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw promotionError(400, 'PROMOTION_INVALID', '优惠活动配置必须是对象');
  }
  const value = (field, fallback = '') => input[field] === undefined ? (existing?.[field] ?? fallback) : input[field];
  const title = String(input.title ?? input.name ?? input.label ?? existing?.title ?? '').trim().slice(0, 60);
  const content = String(value('content', '')).trim().slice(0, 2_000);
  const template = String(value('template', 'celebration')).trim().toLowerCase();
  const discountPercent = Number(value('discountPercent'));
  const targetPlanIds = normalizeTargetPlanIds(value('targetPlanIds', []));
  const startsAt = toIso(value('startsAt'));
  const endsAt = toIso(value('endsAt'));
  if (title.length < 2) throw promotionError(422, 'PROMOTION_TITLE_INVALID', '优惠活动名称至少需要 2 个字符');
  if (!/^[a-z0-9_-]{2,40}$/.test(template)) throw promotionError(422, 'PROMOTION_TEMPLATE_INVALID', '庆祝模板标识格式无效');
  if (!Number.isSafeInteger(discountPercent) || discountPercent < 1 || discountPercent > 99) {
    throw promotionError(422, 'PROMOTION_DISCOUNT_INVALID', '优惠百分比需为 1-99 的整数');
  }
  if (!targetPlanIds.length) throw promotionError(422, 'PROMOTION_TARGETS_REQUIRED', '请至少选择一个目标套餐');
  if (new Date(endsAt) <= new Date(startsAt)) throw promotionError(422, 'PROMOTION_PERIOD_INVALID', '优惠活动结束时间必须晚于开始时间');
  return {
    id,
    title,
    content,
    template,
    discountType: 'percentage',
    discountPercent,
    targetPlanIds,
    startsAt,
    endsAt,
    enabled: Boolean(value('enabled', true)),
    createdAt: existing?.createdAt || (input.createdAt ? toIso(input.createdAt) : timestamp),
    updatedAt: timestamp,
    updatedBy: String(actor || 'admin').trim().slice(0, 100) || 'admin',
  };
}

function normalizeTargetPlanIds(value) {
  if (!Array.isArray(value) || value.length > 50) throw promotionError(422, 'PROMOTION_TARGETS_INVALID', '目标套餐必须是最多 50 项的数组');
  const unique = new Set();
  for (const item of value) {
    const planId = String(item || '').trim();
    if (!/^[A-Za-z0-9_.:-]{2,80}$/.test(planId)) throw promotionError(422, 'PROMOTION_TARGET_INVALID', '目标套餐标识格式无效');
    unique.add(planId);
  }
  return [...unique];
}

function publicPromotion(promotion, at) {
  const instant = validDate(at) || new Date();
  const active = isPromotionActive(promotion, instant);
  const status = !promotion.enabled ? 'disabled'
    : instant < new Date(promotion.startsAt) ? 'scheduled'
      : instant >= new Date(promotion.endsAt) ? 'expired'
        : 'active';
  return {
    ...promotion,
    promotionId: promotion.id,
    name: promotion.title,
    label: promotion.title,
    content: promotion.content || '',
    active,
    status,
    targetPlanIds: [...promotion.targetPlanIds],
  };
}

function isPromotionActive(promotion, at) {
  const timestamp = at.getTime();
  return Boolean(
    promotion.enabled
    && timestamp >= new Date(promotion.startsAt).getTime()
    && timestamp < new Date(promotion.endsAt).getTime()
  );
}

function readState(filename) {
  if (!existsSync(filename)) return { version: 1, updatedAt: null, promotions: [] };
  let parsed;
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')); } catch (error) {
    throw new Error(`优惠活动数据无法读取：${error.message}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.promotions)) throw new Error('promotions.json 数据结构无效');
  if (parsed.promotions.length > MAX_PROMOTIONS) throw new Error(`promotions.json 活动数量超过 ${MAX_PROMOTIONS}`);
  const seen = new Set();
  parsed.promotions = parsed.promotions.map((promotion) => {
    const id = normalizePromotionId(promotion.id);
    if (seen.has(id)) throw new Error(`promotions.json 包含重复活动 ${id}`);
    seen.add(id);
    return normalizePromotion(id, promotion, null, promotion.updatedAt || promotion.createdAt, promotion.updatedBy || 'admin');
  });
  return parsed;
}

function writeState(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function normalizePromotionId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:-]{2,80}$/.test(id)) throw promotionError(400, 'PROMOTION_ID_INVALID', '优惠活动标识格式无效');
  return id;
}

function toIso(value) {
  const date = validDate(value);
  if (!date) throw promotionError(422, 'PROMOTION_TIME_INVALID', '优惠活动时间无效');
  return date.toISOString();
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function promotionError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

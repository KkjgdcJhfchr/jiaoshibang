import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const MAX_ADS = 100;
const MAX_AD_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);
const DEFAULT_REFERRAL_SETTINGS = Object.freeze({
  enabled: false,
  rewardMode: 'both',
  inviterRewardCredits: 1,
  inviteeRewardCredits: 1,
  maxRewardsPerUser: 20,
  headline: '邀请同事，一起高效备课',
  description: '分享你的专属邀请链接，好友完成验证注册后即可按活动规则获得教案生成额度。',
  updatedAt: null,
  updatedBy: null,
});

export class MarketingStoreError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'MarketingStoreError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createMarketingStore({ dataDir, now = () => new Date() } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const assetsDir = join(dataDir, 'marketing-assets');
  mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'marketing.json');
  const state = readState(filename);

  function listPublicAds() {
    return orderedAds().filter((ad) => ad.enabled).map(publicAd);
  }

  function listAdminAds() {
    return orderedAds().map(adminAd);
  }

  function getPublicReferralSettings() {
    return publicReferralSettings(state.referralSettings);
  }

  function getAdminReferralSettings() {
    return structuredClone(state.referralSettings);
  }

  function createAd(input, actor = 'admin') {
    assertObject(input, 'ADVERTISEMENT_INVALID', '广告配置必须是 JSON 对象');
    if (state.ads.length >= MAX_ADS) {
      throw new MarketingStoreError(409, 'ADVERTISEMENT_LIMIT_REACHED', `广告数量不能超过 ${MAX_ADS} 个`);
    }
    const image = parseImageDataUrl(input.imageDataUrl);
    const timestamp = isoNow(now);
    const id = `ad_${randomUUID()}`;
    const previousState = structuredClone(state);
    let asset = null;
    try {
      asset = writeAsset(image);
      const ad = normalizeAd(input, null, {
        id,
        asset,
        position: state.ads.length,
        timestamp,
        actor,
      });
      state.ads.push(ad);
      state.updatedAt = timestamp;
      writeState(filename, state);
      return adminAd(ad);
    } catch (error) {
      replaceObject(state, previousState);
      if (asset) safeUnlink(asset.path);
      throw error;
    }
  }

  function updateAd(adId, input, actor = 'admin') {
    assertObject(input, 'ADVERTISEMENT_INVALID', '广告配置必须是 JSON 对象');
    const id = normalizeAdId(adId);
    const index = state.ads.findIndex((ad) => ad.id === id);
    if (index < 0) throw new MarketingStoreError(404, 'ADVERTISEMENT_NOT_FOUND', '广告不存在');
    const existing = state.ads[index];
    const timestamp = isoNow(now);
    const replacement = input.imageDataUrl === undefined || input.imageDataUrl === null || input.imageDataUrl === ''
      ? null
      : writeAsset(parseImageDataUrl(input.imageDataUrl));
    const previousState = structuredClone(state);
    try {
      state.ads[index] = normalizeAd(input, existing, {
        id,
        asset: replacement || {
          name: existing.assetName,
          mimeType: existing.mimeType,
          size: existing.size,
        },
        position: existing.position,
        timestamp,
        actor,
      });
      state.updatedAt = timestamp;
      writeState(filename, state);
    } catch (error) {
      replaceObject(state, previousState);
      if (replacement) safeUnlink(replacement.path);
      throw error;
    }
    if (replacement) safeUnlink(join(assetsDir, existing.assetName));
    return adminAd(state.ads[index]);
  }

  function deleteAd(adId) {
    const id = normalizeAdId(adId);
    const index = state.ads.findIndex((ad) => ad.id === id);
    if (index < 0) throw new MarketingStoreError(404, 'ADVERTISEMENT_NOT_FOUND', '广告不存在');
    const previousState = structuredClone(state);
    const [deleted] = state.ads.splice(index, 1);
    state.ads.forEach((ad, position) => { ad.position = position; });
    state.updatedAt = isoNow(now);
    try {
      writeState(filename, state);
    } catch (error) {
      replaceObject(state, previousState);
      throw error;
    }
    safeUnlink(join(assetsDir, deleted.assetName));
    return adminAd(deleted);
  }

  function reorderAds(ids, actor = 'admin') {
    if (!Array.isArray(ids) || ids.length !== state.ads.length) {
      throw new MarketingStoreError(422, 'ADVERTISEMENT_ORDER_INVALID', '排序必须包含当前全部广告');
    }
    const normalized = ids.map(normalizeAdId);
    if (new Set(normalized).size !== normalized.length) {
      throw new MarketingStoreError(422, 'ADVERTISEMENT_ORDER_INVALID', '排序中不能包含重复广告');
    }
    const byId = new Map(state.ads.map((ad) => [ad.id, ad]));
    if (normalized.some((id) => !byId.has(id))) {
      throw new MarketingStoreError(422, 'ADVERTISEMENT_ORDER_INVALID', '排序包含不存在的广告');
    }
    const timestamp = isoNow(now);
    const previousState = structuredClone(state);
    state.ads = normalized.map((id, position) => ({
      ...byId.get(id),
      position,
      updatedAt: timestamp,
      updatedBy: cleanText(actor, 100) || 'admin',
    }));
    state.updatedAt = timestamp;
    try {
      writeState(filename, state);
    } catch (error) {
      replaceObject(state, previousState);
      throw error;
    }
    return listAdminAds();
  }

  function saveReferralSettings(input, actor = 'admin') {
    assertObject(input, 'REFERRAL_SETTINGS_INVALID', '推广奖励设置必须是 JSON 对象');
    const timestamp = isoNow(now);
    const next = normalizeReferralSettings(input, state.referralSettings, timestamp, actor);
    const previous = state.referralSettings;
    state.referralSettings = next;
    state.updatedAt = timestamp;
    try {
      writeState(filename, state);
    } catch (error) {
      state.referralSettings = previous;
      throw error;
    }
    return getAdminReferralSettings();
  }

  function openAsset(assetName) {
    const name = basename(String(assetName || ''));
    if (name !== assetName || !/^[0-9a-f-]{36}\.(?:png|jpg|webp|gif)$/.test(name)) {
      throw new MarketingStoreError(404, 'MARKETING_ASSET_NOT_FOUND', '宣传图片不存在');
    }
    const ad = state.ads.find((item) => item.assetName === name);
    if (!ad) throw new MarketingStoreError(404, 'MARKETING_ASSET_NOT_FOUND', '宣传图片不存在');
    const path = join(assetsDir, name);
    let stats;
    try { stats = statSync(path); } catch { throw new MarketingStoreError(404, 'MARKETING_ASSET_NOT_FOUND', '宣传图片不存在'); }
    if (!stats.isFile()) throw new MarketingStoreError(404, 'MARKETING_ASSET_NOT_FOUND', '宣传图片不存在');
    return { path, name, mimeType: ad.mimeType, size: stats.size };
  }

  function orderedAds() {
    return [...state.ads].sort((left, right) => (
      Number(left.position) - Number(right.position)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ));
  }

  function writeAsset(image) {
    const name = `${randomUUID()}.${image.extension}`;
    const path = join(assetsDir, name);
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      writeFileSync(temporary, image.buffer, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    } catch (error) {
      safeUnlink(temporary);
      throw error;
    }
    return { name, path, mimeType: image.mimeType, size: image.buffer.byteLength };
  }

  return {
    createAd,
    deleteAd,
    getAdminReferralSettings,
    getPublicReferralSettings,
    listAdminAds,
    listPublicAds,
    openAsset,
    reorderAds,
    saveReferralSettings,
    updateAd,
  };
}

function normalizeAd(input, existing, { id, asset, position, timestamp, actor }) {
  const title = cleanText(input.title ?? existing?.title, 120);
  const altText = cleanText(input.altText ?? existing?.altText ?? title, 240);
  const linkUrl = normalizeLink(input.linkUrl === undefined ? existing?.linkUrl : input.linkUrl);
  if (!title) throw new MarketingStoreError(422, 'ADVERTISEMENT_TITLE_REQUIRED', '请填写广告标题');
  if (!altText) throw new MarketingStoreError(422, 'ADVERTISEMENT_ALT_REQUIRED', '请填写图片替代文字');
  return {
    id,
    title,
    altText,
    linkUrl,
    assetName: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    enabled: input.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : strictBoolean(input.enabled, 'ADVERTISEMENT_ENABLED_INVALID'),
    position,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: cleanText(actor, 100) || 'admin',
  };
}

function normalizeReferralSettings(input, existing, timestamp, actor) {
  const value = (key, fallback) => input[key] === undefined ? (existing?.[key] ?? fallback) : input[key];
  const rewardMode = cleanText(value('rewardMode', 'both'), 40);
  if (!['both', 'inviter_only', 'invitee_only'].includes(rewardMode)) {
    throw new MarketingStoreError(422, 'REFERRAL_REWARD_MODE_INVALID', '奖励方式必须是双方、仅邀请人或仅新用户');
  }
  const inviterRewardCredits = boundedInteger(value('inviterRewardCredits', 1), 0, 100_000, 'REFERRAL_INVITER_REWARD_INVALID');
  const inviteeRewardCredits = boundedInteger(value('inviteeRewardCredits', 1), 0, 100_000, 'REFERRAL_INVITEE_REWARD_INVALID');
  const maxRewardsPerUser = boundedInteger(value('maxRewardsPerUser', 20), 1, 1_000_000, 'REFERRAL_REWARD_LIMIT_INVALID');
  const headline = cleanText(value('headline', DEFAULT_REFERRAL_SETTINGS.headline), 120);
  const description = cleanText(value('description', DEFAULT_REFERRAL_SETTINGS.description), 1_000);
  if (!headline) throw new MarketingStoreError(422, 'REFERRAL_HEADLINE_REQUIRED', '请填写推广标题');
  if (!description) throw new MarketingStoreError(422, 'REFERRAL_DESCRIPTION_REQUIRED', '请填写推广说明');
  return {
    enabled: strictBoolean(value('enabled', false), 'REFERRAL_ENABLED_INVALID'),
    rewardMode,
    inviterRewardCredits,
    inviteeRewardCredits,
    maxRewardsPerUser,
    headline,
    description,
    updatedAt: timestamp,
    updatedBy: cleanText(actor, 100) || 'admin',
  };
}

function normalizeLink(value) {
  const link = cleanText(value, 2_000);
  if (!link) return '';
  if (link.startsWith('/') && !link.startsWith('//') && !/[\r\n\\]/.test(link)) return link;
  let parsed;
  try { parsed = new URL(link); } catch { throw new MarketingStoreError(422, 'ADVERTISEMENT_LINK_INVALID', '跳转链接格式无效'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new MarketingStoreError(422, 'ADVERTISEMENT_LINK_INVALID', '跳转链接仅支持站内路径或 HTTPS 地址');
  }
  return parsed.toString();
}

function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw new MarketingStoreError(422, 'ADVERTISEMENT_IMAGE_INVALID', '请上传有效的宣传图片');
  const mimeType = match[1].toLowerCase();
  const extension = ALLOWED_IMAGE_TYPES.get(mimeType);
  if (!extension) {
    throw new MarketingStoreError(415, 'ADVERTISEMENT_IMAGE_TYPE_UNSUPPORTED', '宣传图片仅支持 PNG、JPEG、WebP 或 GIF');
  }
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (estimatedBytes > MAX_AD_IMAGE_BYTES) {
    throw new MarketingStoreError(413, 'ADVERTISEMENT_IMAGE_TOO_LARGE', '宣传图片不能超过 5MB');
  }
  let buffer;
  try { buffer = Buffer.from(match[2], 'base64'); } catch { throw new MarketingStoreError(422, 'ADVERTISEMENT_IMAGE_INVALID', '宣传图片编码无效'); }
  if (!buffer.length || buffer.length > MAX_AD_IMAGE_BYTES || !matchesMagic(buffer, mimeType)) {
    throw new MarketingStoreError(422, 'ADVERTISEMENT_IMAGE_CONTENT_INVALID', '宣传图片内容与文件类型不匹配');
  }
  return { buffer, mimeType, extension };
}

function matchesMagic(buffer, mimeType) {
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function publicAd(ad) {
  return {
    id: ad.id,
    title: ad.title,
    altText: ad.altText,
    linkUrl: ad.linkUrl,
    imageUrl: `/api/marketing/assets/${encodeURIComponent(ad.assetName)}`,
  };
}

function adminAd(ad) {
  return {
    ...publicAd(ad),
    enabled: Boolean(ad.enabled),
    order: Number(ad.position),
    size: Number(ad.size),
    mimeType: ad.mimeType,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
    updatedBy: ad.updatedBy,
  };
}

function publicReferralSettings(settings) {
  return {
    enabled: Boolean(settings.enabled),
    rewardMode: settings.rewardMode,
    inviterRewardCredits: Number(settings.inviterRewardCredits),
    inviteeRewardCredits: Number(settings.inviteeRewardCredits),
    maxRewardsPerUser: Number(settings.maxRewardsPerUser),
    headline: settings.headline,
    description: settings.description,
  };
}

function readState(filename) {
  if (!existsSync(filename)) {
    return { version: 1, updatedAt: null, ads: [], referralSettings: structuredClone(DEFAULT_REFERRAL_SETTINGS) };
  }
  let parsed;
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')); }
  catch (error) { throw new Error(`营销配置无法读取：${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.ads)) {
    throw new Error('marketing.json 数据结构无效');
  }
  return {
    version: 1,
    updatedAt: parsed.updatedAt || null,
    ads: parsed.ads,
    referralSettings: { ...structuredClone(DEFAULT_REFERRAL_SETTINGS), ...(parsed.referralSettings || {}) },
  };
}

function writeState(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function normalizeAdId(value) {
  const id = String(value || '').trim();
  if (!/^ad_[0-9a-f-]{36}$/i.test(id)) throw new MarketingStoreError(400, 'ADVERTISEMENT_ID_INVALID', '广告编号无效');
  return id;
}

function strictBoolean(value, code) {
  if (typeof value !== 'boolean') throw new MarketingStoreError(422, code, '开关值必须是布尔值');
  return value;
}

function boundedInteger(value, minimum, maximum, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new MarketingStoreError(422, code, `数值必须是 ${minimum}-${maximum} 之间的整数`);
  }
  return number;
}

function assertObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarketingStoreError(400, code, message);
}

function cleanText(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum);
}

function isoNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('系统时间无效');
  return date.toISOString();
}

function safeUnlink(path) {
  try { unlinkSync(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

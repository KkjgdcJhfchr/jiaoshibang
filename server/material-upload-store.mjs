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

const IMAGE_LIMIT = 8 * 1024 * 1024;
const PDF_LIMIT = 16 * 1024 * 1024;
const TYPE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['application/pdf', 'pdf'],
]);

export class MaterialUploadError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'MaterialUploadError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createMaterialUploadStore({
  dataDir,
  ttlMs = 24 * 60 * 60 * 1000,
  maxActiveBytesPerUser = 256 * 1024 * 1024,
  maxGenerationBytes = 64 * 1024 * 1024,
  now = () => new Date(),
} = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000) throw new TypeError('ttlMs is invalid');
  if (!Number.isSafeInteger(maxActiveBytesPerUser) || maxActiveBytesPerUser < PDF_LIMIT) throw new TypeError('maxActiveBytesPerUser is invalid');
  if (!Number.isSafeInteger(maxGenerationBytes) || maxGenerationBytes < PDF_LIMIT) throw new TypeError('maxGenerationBytes is invalid');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const assetsDir = join(dataDir, 'material-uploads');
  mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'material-uploads.json');
  const state = readState(filename);
  pruneExpired();

  function createAttachment({ userId, name, type, dataUrl }) {
    const ownerId = normalizeUserId(userId);
    pruneExpired();
    const parsed = parseDataUrl(dataUrl, type);
    const usedBytes = state.attachments
      .filter((attachment) => attachment.userId === ownerId)
      .reduce((sum, attachment) => sum + Number(attachment.size || 0), 0);
    if (usedBytes + parsed.buffer.byteLength > maxActiveBytesPerUser) {
      throw new MaterialUploadError(413, 'MATERIAL_UPLOAD_QUOTA_EXCEEDED', '当前账号暂存的教材文件总量过大，请删除不再使用的文件后重试', {
        maximumBytes: maxActiveBytesPerUser,
        activeBytes: usedBytes,
      });
    }
    const timestamp = isoNow(now);
    const id = `att_${randomUUID()}`;
    const assetName = `${randomUUID()}.${parsed.extension}`;
    const path = join(assetsDir, assetName);
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      writeFileSync(temporary, parsed.buffer, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path);
    } catch (error) {
      safeUnlink(temporary);
      throw error;
    }
    const attachment = {
      id,
      userId: ownerId,
      name: normalizeFilename(name, parsed.extension),
      type: parsed.mimeType,
      size: parsed.buffer.byteLength,
      assetName,
      createdAt: timestamp,
      expiresAt: new Date(new Date(timestamp).getTime() + ttlMs).toISOString(),
    };
    const previous = structuredClone(state);
    try {
      state.attachments.push(attachment);
      state.updatedAt = timestamp;
      writeState(filename, state);
    } catch (error) {
      replaceObject(state, previous);
      safeUnlink(path);
      throw error;
    }
    return publicAttachment(attachment);
  }

  function deleteAttachment(userId, attachmentId) {
    const ownerId = normalizeUserId(userId);
    const id = normalizeAttachmentId(attachmentId);
    pruneExpired();
    const attachment = state.attachments.find((item) => item.id === id && item.userId === ownerId);
    if (!attachment) throw new MaterialUploadError(404, 'MATERIAL_ATTACHMENT_NOT_FOUND', '教材附件不存在或已过期');
    deleteAttachmentRecords(ownerId, [id]);
    return publicAttachment(attachment);
  }

  function deleteAttachments(userId, attachmentIds) {
    const ownerId = normalizeUserId(userId);
    const ids = normalizeAttachmentIds(attachmentIds);
    if (!ids.length) return { deletedIds: [] };
    pruneExpired();
    const idSet = new Set(ids);
    const owned = new Map(state.attachments
      .filter((item) => item.userId === ownerId && idSet.has(item.id))
      .map((item) => [item.id, item]));
    const missing = ids.filter((id) => !owned.has(id));
    if (missing.length) {
      throw new MaterialUploadError(404, 'MATERIAL_ATTACHMENT_NOT_FOUND', '部分教材附件不存在或已过期', { attachmentIds: missing });
    }
    deleteAttachmentRecords(ownerId, ids);
    return { deletedIds: ids };
  }

  function deleteUserAttachments(userIds) {
    if (!Array.isArray(userIds)) throw new MaterialUploadError(400, 'MATERIAL_OWNER_IDS_INVALID', '用户编号必须是数组');
    const ownerIds = new Set(userIds.map(normalizeUserId));
    if (!ownerIds.size) return 0;
    pruneExpired();
    const removed = state.attachments.filter((attachment) => ownerIds.has(attachment.userId));
    if (!removed.length) return 0;
    const previous = structuredClone(state);
    state.attachments = state.attachments.filter((attachment) => !ownerIds.has(attachment.userId));
    state.updatedAt = isoNow(now);
    try { writeState(filename, state); }
    catch (error) {
      replaceObject(state, previous);
      throw error;
    }
    for (const attachment of removed) safeUnlink(join(assetsDir, attachment.assetName));
    return removed.length;
  }

  function resolveAttachments(userId, attachmentIds) {
    const ownerId = normalizeUserId(userId);
    const ids = normalizeAttachmentIds(attachmentIds);
    if (!ids.length) return [];
    pruneExpired();
    const byId = new Map(state.attachments
      .filter((attachment) => attachment.userId === ownerId)
      .map((attachment) => [attachment.id, attachment]));
    const selected = ids.map((id) => {
      const attachment = byId.get(id);
      if (!attachment) throw new MaterialUploadError(404, 'MATERIAL_ATTACHMENT_NOT_FOUND', '教材附件不存在或已过期', { attachmentId: id });
      return attachment;
    });
    const totalBytes = selected.reduce((sum, attachment) => sum + attachment.size, 0);
    if (totalBytes > maxGenerationBytes) {
      throw new MaterialUploadError(413, 'MATERIAL_GENERATION_TOTAL_TOO_LARGE', '本次生成使用的教材总量过大，请分章节生成', {
        maximumBytes: maxGenerationBytes,
        totalBytes,
      });
    }
    return selected.map((attachment) => {
      const path = join(assetsDir, attachment.assetName);
      let buffer;
      try { buffer = readFileSync(path); }
      catch { throw new MaterialUploadError(410, 'MATERIAL_ATTACHMENT_MISSING', '教材附件存储已失效，请重新上传', { attachmentId: attachment.id }); }
      if (buffer.byteLength !== attachment.size || !matchesMagic(buffer, attachment.type)) {
        throw new MaterialUploadError(410, 'MATERIAL_ATTACHMENT_CORRUPTED', '教材附件校验失败，请重新上传', { attachmentId: attachment.id });
      }
      return {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        dataUrl: `data:${attachment.type};base64,${buffer.toString('base64')}`,
      };
    });
  }

  function openAttachment(userId, attachmentId) {
    const ownerId = normalizeUserId(userId);
    const id = normalizeAttachmentId(attachmentId);
    pruneExpired();
    const attachment = state.attachments.find((item) => item.id === id && item.userId === ownerId);
    if (!attachment) throw new MaterialUploadError(404, 'MATERIAL_ATTACHMENT_NOT_FOUND', '教材附件不存在或已过期');
    const path = join(assetsDir, attachment.assetName);
    let stats;
    try { stats = statSync(path); } catch { throw new MaterialUploadError(410, 'MATERIAL_ATTACHMENT_MISSING', '教材附件存储已失效，请重新上传'); }
    if (!stats.isFile()) throw new MaterialUploadError(410, 'MATERIAL_ATTACHMENT_MISSING', '教材附件存储已失效，请重新上传');
    return { ...publicAttachment(attachment), path, size: stats.size };
  }

  function deleteAttachmentRecords(ownerId, ids) {
    const idSet = new Set(ids);
    const removed = state.attachments.filter((item) => item.userId === ownerId && idSet.has(item.id));
    const previous = structuredClone(state);
    state.attachments = state.attachments.filter((item) => !(item.userId === ownerId && idSet.has(item.id)));
    state.updatedAt = isoNow(now);
    try {
      writeState(filename, state);
    } catch (error) {
      replaceObject(state, previous);
      throw error;
    }
    for (const attachment of removed) safeUnlink(join(assetsDir, attachment.assetName));
  }

  function pruneExpired() {
    const timestamp = dateNow(now).getTime();
    const expired = state.attachments.filter((attachment) => new Date(attachment.expiresAt).getTime() <= timestamp);
    if (!expired.length) return 0;
    const expiredIds = new Set(expired.map((attachment) => attachment.id));
    const previous = structuredClone(state);
    state.attachments = state.attachments.filter((attachment) => !expiredIds.has(attachment.id));
    state.updatedAt = new Date(timestamp).toISOString();
    try {
      writeState(filename, state);
    } catch (error) {
      replaceObject(state, previous);
      throw error;
    }
    for (const attachment of expired) safeUnlink(join(assetsDir, attachment.assetName));
    return expired.length;
  }

  return {
    createAttachment,
    deleteAttachment,
    deleteAttachments,
    deleteUserAttachments,
    openAttachment,
    pruneExpired,
    resolveAttachments,
  };
}

function parseDataUrl(value, requestedType) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw new MaterialUploadError(422, 'MATERIAL_DATA_URL_INVALID', '教材文件编码无效');
  const mimeType = canonicalMimeType(match[1]);
  const declaredType = canonicalMimeType(requestedType || mimeType);
  if (declaredType !== mimeType) throw new MaterialUploadError(422, 'MATERIAL_TYPE_MISMATCH', '教材文件类型与内容声明不一致');
  const extension = TYPE_EXTENSIONS.get(mimeType);
  if (!extension) throw new MaterialUploadError(415, 'MATERIAL_TYPE_UNSUPPORTED', '教材仅支持 PNG、JPEG、WebP、GIF 或 PDF');
  const limit = mimeType === 'application/pdf' ? PDF_LIMIT : IMAGE_LIMIT;
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (estimatedBytes > limit) throw new MaterialUploadError(413, 'MATERIAL_FILE_TOO_LARGE', `单个${mimeType === 'application/pdf' ? ' PDF' : '图片'}不能超过 ${Math.floor(limit / 1024 / 1024)}MB`);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.byteLength > limit || !matchesMagic(buffer, mimeType)) {
    throw new MaterialUploadError(422, 'MATERIAL_CONTENT_INVALID', '教材文件内容与文件类型不匹配');
  }
  return { buffer, mimeType, extension };
}

function matchesMagic(buffer, mimeType) {
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'application/pdf') return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}

function publicAttachment(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: Number(attachment.size),
    url: `/api/app/material-uploads/${encodeURIComponent(attachment.id)}`,
    createdAt: attachment.createdAt,
    expiresAt: attachment.expiresAt,
  };
}

function normalizeFilename(value, extension) {
  const source = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
  return source || `教材-${Date.now()}.${extension}`;
}

function canonicalMimeType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function normalizeUserId(value) {
  const id = String(value || '').trim();
  if (!/^usr_[0-9a-f-]{36}$/i.test(id)) throw new MaterialUploadError(400, 'MATERIAL_OWNER_INVALID', '用户编号无效');
  return id;
}

function normalizeAttachmentId(value) {
  const id = String(value || '').trim();
  if (!/^att_[0-9a-f-]{36}$/i.test(id)) throw new MaterialUploadError(400, 'MATERIAL_ATTACHMENT_ID_INVALID', '教材附件编号无效');
  return id;
}

function normalizeAttachmentIds(value) {
  if (!Array.isArray(value)) throw new MaterialUploadError(400, 'MATERIAL_ATTACHMENT_IDS_INVALID', '教材附件编号必须是数组');
  const ids = value.map(normalizeAttachmentId);
  if (new Set(ids).size !== ids.length) throw new MaterialUploadError(422, 'MATERIAL_ATTACHMENT_IDS_DUPLICATED', '教材附件不能重复');
  return ids;
}

function readState(filename) {
  if (!existsSync(filename)) return { version: 1, updatedAt: null, attachments: [] };
  let parsed;
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')); }
  catch (error) { throw new Error(`教材附件索引无法读取：${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.attachments)) {
    throw new Error('material-uploads.json 数据结构无效');
  }
  return { version: 1, updatedAt: parsed.updatedAt || null, attachments: parsed.attachments };
}

function writeState(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function dateNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('系统时间无效');
  return date;
}

function isoNow(now) {
  return dateNow(now).toISOString();
}

function safeUnlink(path) {
  const name = basename(path);
  if (!name) return;
  try { unlinkSync(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

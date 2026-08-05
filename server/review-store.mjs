import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const MAX_REVIEWS_PER_USER = 1_000;
const MAX_REVIEWERS = 50;
const MAX_ACTIVITIES = 500;
const MAX_QUESTIONS = 100;
const MAX_QUESTIONS_BYTES = 350 * 1024;
const REVIEW_STATUSES = new Set(['草稿', '待评审', '修改中', '已通过']);
const MUTABLE_FIELDS = new Set([
  'title',
  'subject',
  'reviewers',
  'comments',
  'status',
  'source',
  'questions',
  'activities',
]);
const ACCEPTED_FIELDS = new Set([
  ...MUTABLE_FIELDS,
  // A complete object returned by the API may be sent back on update. These
  // fields are deliberately ignored so identity and timestamps stay server-owned.
  'id',
  'owner',
  'userId',
  'createdAt',
  'updatedAt',
  'updated',
]);

export class ReviewStoreError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ReviewStoreError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createReviewStore({
  dataDir,
  now = () => new Date(),
  createId = () => `review-${randomUUID()}`,
} = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createId !== 'function') throw new TypeError('createId must be a function');

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'reviews.json');
  const state = readState(filename);

  function listReviews(userId) {
    const normalizedUserId = normalizeUserId(userId);
    return state.reviews
      .filter((review) => review.userId === normalizedUserId)
      .sort((left, right) => (
        String(right.updatedAt).localeCompare(String(left.updatedAt))
        || String(right.createdAt).localeCompare(String(left.createdAt))
      ))
      .map(publicReview);
  }

  function findReview(userId, reviewId) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedReviewId = normalizeReviewId(reviewId);
    const review = state.reviews.find((item) => (
      item.userId === normalizedUserId && item.id === normalizedReviewId
    ));
    return review ? publicReview(review) : null;
  }

  function createReview(user, input) {
    const userId = normalizeUserId(user?.id);
    if (state.reviews.filter((review) => review.userId === userId).length >= MAX_REVIEWS_PER_USER) {
      throw new ReviewStoreError(409, 'REVIEW_LIMIT_REACHED', `每个账号最多保存 ${MAX_REVIEWS_PER_USER} 项评审任务`);
    }
    const normalized = normalizeReviewInput(input, { creating: true });
    const id = normalizeReviewId(createId());
    if (state.reviews.some((review) => review.id === id)) {
      throw new ReviewStoreError(409, 'REVIEW_ID_CONFLICT', '评审任务编号重复，请重试');
    }
    const timestamp = isoNow(now);
    const review = {
      id,
      userId,
      title: normalized.title,
      owner: '当前教师',
      subject: normalized.subject,
      reviewers: normalized.reviewers,
      comments: normalized.comments,
      status: normalized.status,
      source: normalized.source,
      questions: normalized.questions,
      activities: normalized.activities,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const previous = structuredClone(state);
    try {
      state.reviews.push(review);
      state.updatedAt = timestamp;
      writeState(filename, state);
      return publicReview(review);
    } catch (error) {
      replaceObject(state, previous);
      throw error;
    }
  }

  function updateReview(userId, reviewId, input) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedReviewId = normalizeReviewId(reviewId);
    const normalized = normalizeReviewInput(input, { creating: false });
    const index = state.reviews.findIndex((review) => (
      review.userId === normalizedUserId && review.id === normalizedReviewId
    ));
    if (index < 0) return null;

    const previous = structuredClone(state);
    const timestamp = isoNow(now);
    try {
      const review = state.reviews[index];
      for (const field of MUTABLE_FIELDS) {
        if (Object.hasOwn(normalized, field)) review[field] = structuredClone(normalized[field]);
      }
      review.updatedAt = timestamp;
      state.updatedAt = timestamp;
      writeState(filename, state);
      return publicReview(review);
    } catch (error) {
      replaceObject(state, previous);
      throw error;
    }
  }

  function deleteReview(userId, reviewId) {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedReviewId = normalizeReviewId(reviewId);
    const index = state.reviews.findIndex((review) => (
      review.userId === normalizedUserId && review.id === normalizedReviewId
    ));
    if (index < 0) return null;
    const previous = structuredClone(state);
    const timestamp = isoNow(now);
    try {
      const [deleted] = state.reviews.splice(index, 1);
      state.updatedAt = timestamp;
      writeState(filename, state);
      return publicReview(deleted);
    } catch (error) {
      replaceObject(state, previous);
      throw error;
    }
  }

  function deleteUserReviews(userIds) {
    const ids = new Set((Array.isArray(userIds) ? userIds : []).map(normalizeUserId));
    if (!ids.size) return 0;
    const previous = structuredClone(state);
    const before = state.reviews.length;
    state.reviews = state.reviews.filter((review) => !ids.has(review.userId));
    const removed = before - state.reviews.length;
    if (!removed) return 0;
    try {
      state.updatedAt = isoNow(now);
      writeState(filename, state);
      return removed;
    } catch (error) {
      replaceObject(state, previous);
      throw error;
    }
  }

  return {
    createReview,
    deleteReview,
    deleteUserReviews,
    findReview,
    listReviews,
    updateReview,
  };
}

function normalizeReviewInput(input, { creating }) {
  assertPlainObject(input, 'REVIEW_INVALID', '评审任务必须是 JSON 对象');
  const unknownFields = Object.keys(input).filter((field) => !ACCEPTED_FIELDS.has(field));
  if (unknownFields.length) {
    throw new ReviewStoreError(400, 'REVIEW_FIELD_UNKNOWN', `评审任务包含不支持的字段：${unknownFields.join('、')}`);
  }
  const output = {};

  if (creating || Object.hasOwn(input, 'title')) {
    output.title = cleanSingleLine(input.title, 300);
    if (!output.title) throw new ReviewStoreError(422, 'REVIEW_TITLE_REQUIRED', '请填写评审任务标题');
  }
  if (creating || Object.hasOwn(input, 'subject')) {
    output.subject = cleanSingleLine(input.subject, 200);
  }
  if (creating || Object.hasOwn(input, 'reviewers')) {
    output.reviewers = normalizeReviewers(input.reviewers);
  }
  if (creating || Object.hasOwn(input, 'comments')) {
    output.comments = boundedInteger(input.comments ?? 0, 0, 100_000, 'REVIEW_COMMENTS_INVALID', '评审批注数量必须是 0-100000 的整数');
  }
  if (creating || Object.hasOwn(input, 'status')) {
    output.status = cleanSingleLine(input.status || '草稿', 20);
    if (!REVIEW_STATUSES.has(output.status)) {
      throw new ReviewStoreError(422, 'REVIEW_STATUS_INVALID', '评审状态无效');
    }
  }
  if (creating || Object.hasOwn(input, 'source')) {
    output.source = cleanSingleLine(input.source || '教案', 100) || '教案';
  }
  if (creating || Object.hasOwn(input, 'questions')) {
    output.questions = normalizeQuestions(input.questions ?? []);
  }
  if (creating || Object.hasOwn(input, 'activities')) {
    output.activities = normalizeActivities(input.activities ?? []);
  }

  if (!creating && ![...MUTABLE_FIELDS].some((field) => Object.hasOwn(output, field))) {
    throw new ReviewStoreError(400, 'REVIEW_UPDATE_EMPTY', '没有需要保存的评审修改');
  }
  return output;
}

function normalizeReviewers(value) {
  if (!Array.isArray(value) || value.length > MAX_REVIEWERS) {
    throw new ReviewStoreError(422, 'REVIEW_REVIEWERS_INVALID', `评审人必须是最多 ${MAX_REVIEWERS} 项的数组`);
  }
  const reviewers = value.map((item) => cleanSingleLine(item, 100));
  if (reviewers.some((item) => !item)) {
    throw new ReviewStoreError(422, 'REVIEW_REVIEWERS_INVALID', '评审人名称不能为空');
  }
  if (new Set(reviewers).size !== reviewers.length) {
    throw new ReviewStoreError(422, 'REVIEW_REVIEWERS_DUPLICATED', '评审人不能重复');
  }
  return reviewers;
}

function normalizeActivities(value) {
  if (!Array.isArray(value) || value.length > MAX_ACTIVITIES) {
    throw new ReviewStoreError(422, 'REVIEW_ACTIVITIES_INVALID', `评审动态必须是最多 ${MAX_ACTIVITIES} 项的数组`);
  }
  return value.map((activity, index) => {
    assertPlainObject(activity, 'REVIEW_ACTIVITY_INVALID', `第 ${index + 1} 条评审动态格式无效`);
    const allowed = new Set(['id', 'author', 'text', 'time', 'createdAt']);
    const unknown = Object.keys(activity).filter((field) => !allowed.has(field));
    if (unknown.length) {
      throw new ReviewStoreError(400, 'REVIEW_ACTIVITY_FIELD_UNKNOWN', `第 ${index + 1} 条评审动态包含不支持的字段`);
    }
    const text = cleanMultiline(activity.text, 5_000);
    if (!text) throw new ReviewStoreError(422, 'REVIEW_ACTIVITY_TEXT_REQUIRED', `第 ${index + 1} 条评审动态内容不能为空`);
    const id = cleanSingleLine(activity.id, 160) || `review-activity-${randomUUID()}`;
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id)) {
      throw new ReviewStoreError(422, 'REVIEW_ACTIVITY_ID_INVALID', `第 ${index + 1} 条评审动态编号无效`);
    }
    return {
      id,
      author: cleanSingleLine(activity.author, 100) || '当前教师',
      text,
      time: cleanSingleLine(activity.time, 100) || '刚刚',
      createdAt: optionalIso(activity.createdAt),
    };
  });
}

function normalizeQuestions(value) {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) {
    throw new ReviewStoreError(422, 'REVIEW_QUESTIONS_INVALID', `题目快照必须是最多 ${MAX_QUESTIONS} 项的数组`);
  }
  const questions = value.map((question, index) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', `第 ${index + 1} 道题格式无效`);
    }
    return normalizeJsonValue(question, 0);
  });
  if (Buffer.byteLength(JSON.stringify(questions), 'utf8') > MAX_QUESTIONS_BYTES) {
    throw new ReviewStoreError(413, 'REVIEW_QUESTIONS_TOO_LARGE', '评审题目快照不能超过 350KB');
  }
  return questions;
}

function normalizeJsonValue(value, depth) {
  if (depth > 8) throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', '题目快照嵌套层级过深');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', '题目快照包含无效数字');
    return value;
  }
  if (typeof value === 'string') return value.replace(/\0/g, '').slice(0, 50_000);
  if (Array.isArray(value)) {
    if (value.length > 200) throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', '题目快照数组过长');
    return value.map((item) => normalizeJsonValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', '题目快照包含不支持的数据类型');
  }
  const entries = Object.entries(value);
  if (entries.length > 100) throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', '题目快照字段过多');
  const output = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 100 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new ReviewStoreError(422, 'REVIEW_QUESTION_INVALID', '题目快照包含无效字段名');
    }
    output[key] = normalizeJsonValue(item, depth + 1);
  }
  return output;
}

function publicReview(review) {
  return structuredClone({
    id: review.id,
    title: review.title,
    owner: '当前教师',
    subject: review.subject,
    reviewers: review.reviewers,
    comments: review.comments,
    status: review.status,
    updated: review.updatedAt,
    source: review.source,
    questions: review.questions,
    activities: review.activities,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  });
}

function readState(filename) {
  if (!existsSync(filename)) return { version: 1, reviews: [], updatedAt: null };
  let state;
  try {
    state = JSON.parse(readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`评审数据无法读取：${error.message}`);
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 || !Array.isArray(state.reviews)) {
    throw new Error('评审数据结构无效');
  }
  for (const review of state.reviews) assertStoredReview(review);
  return state;
}

function assertStoredReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('评审记录结构无效');
  normalizeReviewId(review.id);
  normalizeUserId(review.userId);
  if (!review.title || !Array.isArray(review.reviewers) || !Array.isArray(review.activities) || !Array.isArray(review.questions)) {
    throw new Error('评审记录字段不完整');
  }
  if (!REVIEW_STATUSES.has(review.status)) throw new Error('评审记录状态无效');
  strictIso(review.createdAt, '评审记录创建时间无效');
  strictIso(review.updatedAt, '评审记录更新时间无效');
}

function writeState(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function normalizeReviewId(value) {
  const id = String(value || '').trim();
  if (!/^review-[0-9a-f-]{36}$/i.test(id)) {
    throw new ReviewStoreError(400, 'REVIEW_ID_INVALID', '评审任务编号无效');
  }
  return id;
}

function normalizeUserId(value) {
  const id = String(value || '').trim();
  if (!/^usr_[0-9a-f-]{36}$/i.test(id)) {
    throw new ReviewStoreError(400, 'REVIEW_USER_ID_INVALID', '用户编号无效');
  }
  return id;
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewStoreError(400, code, message);
  }
}

function cleanSingleLine(value, maximum) {
  return String(value ?? '').replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function cleanMultiline(value, maximum) {
  return String(value ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function boundedInteger(value, minimum, maximum, code, message) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ReviewStoreError(422, code, message);
  }
  return number;
}

function optionalIso(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ReviewStoreError(422, 'REVIEW_ACTIVITY_TIME_INVALID', '评审动态时间无效');
  return date.toISOString();
}

function strictIso(value, message) {
  const date = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(message);
}

function isoNow(now) {
  const date = now();
  const normalized = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (!Number.isFinite(normalized.getTime())) throw new Error('系统时间无效');
  return normalized.toISOString();
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

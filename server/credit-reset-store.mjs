import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_JOBS = 2_000;
const MAX_TARGET_USERS = 1_000;
const MAX_CREDITS = 1_000_000;

export class CreditResetStoreError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'CreditResetStoreError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createCreditResetStore({ dataDir, now = () => new Date() } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'credit-resets.json');
  const state = readState(filename, now());
  const executions = new Map();

  function listJobs({ status = '' } = {}) {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus && !['pending', 'processing', 'completed', 'cancelled', 'failed'].includes(normalizedStatus)) {
      throw new CreditResetStoreError(400, 'CREDIT_RESET_STATUS_INVALID', '额度重置任务状态无效');
    }
    return state.jobs
      .filter((job) => !normalizedStatus || job.status === normalizedStatus)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .map(publicJob);
  }

  function getJob(jobId) {
    const id = normalizeJobId(jobId);
    const job = state.jobs.find((item) => item.id === id);
    return job ? publicJob(job) : null;
  }

  function createJob(input, actor = 'admin') {
    assertObject(input);
    const normalized = normalizeCreateInput(input, now());
    const normalizedActor = cleanText(actor, 100) || 'admin';
    if (normalized.idempotencyKey) {
      const existing = state.jobs.find((job) => job.actor === normalizedActor && job.idempotencyKey === normalized.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== normalized.requestFingerprint) {
          throw new CreditResetStoreError(409, 'CREDIT_RESET_IDEMPOTENCY_CONFLICT', '相同幂等标识不能用于不同的额度重置任务');
        }
        return { job: publicJob(existing), created: false };
      }
    }
    if (state.jobs.length >= MAX_JOBS) pruneJobs();
    if (state.jobs.length >= MAX_JOBS) {
      throw new CreditResetStoreError(409, 'CREDIT_RESET_LIMIT_REACHED', `额度重置任务最多保留 ${MAX_JOBS} 条`);
    }
    const timestamp = toIso(now());
    const job = {
      id: `cr_${randomUUID()}`,
      status: 'pending',
      userIds: normalized.userIds,
      credits: normalized.credits,
      reason: normalized.reason,
      executeAt: normalized.executeAt,
      idempotencyKey: normalized.idempotencyKey,
      requestFingerprint: normalized.requestFingerprint,
      actor: normalizedActor,
      attemptCount: 0,
      processingStartedAt: null,
      completedAt: null,
      cancelledAt: null,
      failedAt: null,
      failureMessage: '',
      result: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.jobs.push(job);
    state.updatedAt = timestamp;
    writeState(filename, state);
    return { job: publicJob(job), created: true };
  }

  function cancelJob(jobId, actor = 'admin') {
    const job = requireJob(jobId);
    if (job.status === 'cancelled') return { job: publicJob(job), cancelled: false };
    if (job.status !== 'pending') {
      throw new CreditResetStoreError(409, 'CREDIT_RESET_NOT_CANCELLABLE', '只有尚未执行的额度重置任务可以取消');
    }
    const timestamp = toIso(now());
    job.status = 'cancelled';
    job.cancelledAt = timestamp;
    job.cancelledBy = cleanText(actor, 100) || 'admin';
    job.updatedAt = timestamp;
    state.updatedAt = timestamp;
    writeState(filename, state);
    return { job: publicJob(job), cancelled: true };
  }

  async function executeJob(jobId, executor, { force = false } = {}) {
    if (typeof executor !== 'function') throw new TypeError('executor must be a function');
    const id = normalizeJobId(jobId);
    if (executions.has(id)) return executions.get(id);
    const promise = runJob(id, executor, force).finally(() => executions.delete(id));
    executions.set(id, promise);
    return promise;
  }

  async function runJob(jobId, executor, force) {
    const job = requireJob(jobId);
    if (job.status !== 'pending') return { job: publicJob(job), executed: false };
    const instant = validDate(now());
    if (!force && new Date(job.executeAt).getTime() > instant.getTime()) return { job: publicJob(job), executed: false };

    const startedAt = instant.toISOString();
    job.status = 'processing';
    job.processingStartedAt = startedAt;
    job.attemptCount += 1;
    job.failureMessage = '';
    job.updatedAt = startedAt;
    state.updatedAt = startedAt;
    writeState(filename, state);

    try {
      const result = await executor({
        jobId: job.id,
        idempotencyKey: `credit-reset:${job.id}`,
        userIds: [...job.userIds],
        credits: job.credits,
        reason: job.reason,
        actor: job.actor,
      });
      const completedAt = toIso(now());
      job.status = 'completed';
      job.completedAt = completedAt;
      job.processingStartedAt = null;
      job.result = normalizeResult(result, job.userIds.length);
      job.updatedAt = completedAt;
      state.updatedAt = completedAt;
      writeState(filename, state);
      return { job: publicJob(job), executed: true };
    } catch (error) {
      const failedAt = toIso(now());
      job.status = 'failed';
      job.failedAt = failedAt;
      job.processingStartedAt = null;
      job.failureMessage = cleanText(error?.message || '额度重置执行失败', 500) || '额度重置执行失败';
      job.updatedAt = failedAt;
      state.updatedAt = failedAt;
      writeState(filename, state);
      return { job: publicJob(job), executed: true };
    }
  }

  async function executeDue(executor) {
    const instant = validDate(now());
    const ids = state.jobs
      .filter((job) => job.status === 'pending' && new Date(job.executeAt).getTime() <= instant.getTime())
      .sort((left, right) => left.executeAt.localeCompare(right.executeAt) || left.createdAt.localeCompare(right.createdAt))
      .map((job) => job.id);
    const results = [];
    for (const id of ids) results.push(await executeJob(id, executor));
    return results;
  }

  function pruneJobs() {
    const removable = state.jobs
      .filter((job) => ['completed', 'cancelled', 'failed'].includes(job.status))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    const count = Math.max(0, state.jobs.length - MAX_JOBS + 100);
    if (!count) return;
    const removed = new Set(removable.slice(0, count).map((job) => job.id));
    state.jobs = state.jobs.filter((job) => !removed.has(job.id));
  }

  function requireJob(jobId) {
    const id = normalizeJobId(jobId);
    const job = state.jobs.find((item) => item.id === id);
    if (!job) throw new CreditResetStoreError(404, 'CREDIT_RESET_NOT_FOUND', '额度重置任务不存在');
    return job;
  }

  return { cancelJob, createJob, executeDue, executeJob, getJob, listJobs };
}

function normalizeCreateInput(input, now) {
  const userIds = normalizeUserIds(input.userIds ?? input.targetUserIds);
  const credits = Number(input.credits ?? input.resetCredits);
  if (!Number.isSafeInteger(credits) || credits < 0 || credits > MAX_CREDITS) {
    throw new CreditResetStoreError(422, 'CREDIT_RESET_CREDITS_INVALID', `重置后的额度必须是 0-${MAX_CREDITS} 的整数`);
  }
  const reason = cleanText(input.reason ?? input.title, 200);
  if (!reason) throw new CreditResetStoreError(422, 'CREDIT_RESET_REASON_REQUIRED', '请填写额度重置说明');
  const hasRequestedTime = Boolean(input.executeAt);
  const requestedAt = hasRequestedTime ? validDate(input.executeAt) : validDate(now);
  if (!requestedAt) throw new CreditResetStoreError(422, 'CREDIT_RESET_TIME_INVALID', '额度重置执行时间无效');
  const executeAt = requestedAt.toISOString();
  const idempotencyKey = cleanText(input.idempotencyKey, 120);
  if (idempotencyKey && !/^[A-Za-z0-9_.:-]{8,120}$/.test(idempotencyKey)) {
    throw new CreditResetStoreError(422, 'CREDIT_RESET_IDEMPOTENCY_KEY_INVALID', '额度重置幂等标识格式无效');
  }
  return {
    userIds,
    credits,
    reason,
    executeAt,
    idempotencyKey,
    requestFingerprint: JSON.stringify({ userIds: [...userIds].sort(), credits, reason, executeAt: hasRequestedTime ? executeAt : 'immediate' }),
  };
}

function normalizeUserIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGET_USERS) {
    throw new CreditResetStoreError(422, 'CREDIT_RESET_USERS_INVALID', `请选择 1-${MAX_TARGET_USERS} 个会员`);
  }
  const unique = new Set();
  for (const valueItem of value) {
    const userId = String(valueItem || '').trim();
    if (!/^usr_[0-9a-z-]{6,80}$/i.test(userId)) {
      throw new CreditResetStoreError(422, 'CREDIT_RESET_USER_INVALID', '额度重置包含无效的会员标识');
    }
    unique.add(userId);
  }
  return [...unique];
}

function normalizeResult(result, requestedCount) {
  if (result === undefined || result === null) return { requestedCount, updatedCount: requestedCount, skippedCount: 0 };
  if (typeof result !== 'object' || Array.isArray(result)) return { requestedCount, updatedCount: requestedCount, skippedCount: 0 };
  const updatedCount = Math.min(boundedCount(result.updatedCount ?? result.appliedCount, requestedCount), requestedCount);
  const skippedCount = Math.min(boundedCount(result.skippedCount, Math.max(0, requestedCount - updatedCount)), Math.max(0, requestedCount - updatedCount));
  return {
    requestedCount,
    updatedCount,
    skippedCount,
    summary: skippedCount === requestedCount
      ? '所选会员均已不存在，本次任务未修改任何账号'
      : skippedCount > 0 ? `已重置 ${updatedCount} 个会员，另有 ${skippedCount} 个账号已不存在并自动跳过`
        : `已重置 ${updatedCount} 个会员`,
  };
}

function boundedCount(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, MAX_TARGET_USERS) : fallback;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    userIds: [...job.userIds],
    targetCount: job.userIds.length,
    credits: job.credits,
    reason: job.reason,
    executeAt: job.executeAt,
    actor: job.actor,
    attemptCount: job.attemptCount,
    completedAt: job.completedAt,
    cancelledAt: job.cancelledAt,
    failedAt: job.failedAt,
    failureMessage: job.failureMessage,
    result: job.result ? { ...job.result } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function readState(filename, instant) {
  if (!existsSync(filename)) return { version: 1, updatedAt: null, jobs: [] };
  let parsed;
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')); } catch (error) {
    throw new Error(`额度重置任务数据无法读取：${error.message}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.jobs)) throw new Error('credit-resets.json 数据结构无效');
  if (parsed.jobs.length > MAX_JOBS) throw new Error(`credit-resets.json 任务数量超过 ${MAX_JOBS}`);
  const ids = new Set();
  for (const job of parsed.jobs) {
    normalizeJobId(job.id);
    if (ids.has(job.id)) throw new Error(`credit-resets.json 包含重复任务 ${job.id}`);
    ids.add(job.id);
    normalizeUserIds(job.userIds);
    if (!['pending', 'processing', 'completed', 'cancelled', 'failed'].includes(job.status)) throw new Error(`额度重置任务 ${job.id} 状态无效`);
    // 该服务按单进程部署；进程重启说明上一次执行未完成，交回调度器安全重试。
    // 真正的额度写入由 data-store 的 resetId 幂等账本兜底，避免重复发放。
    if (job.status === 'processing') {
      job.status = 'pending';
      job.processingStartedAt = null;
    }
  }
  return parsed;
}

function writeState(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function normalizeJobId(value) {
  const id = String(value || '').trim();
  if (!/^cr_[0-9a-f-]{36}$/i.test(id)) throw new CreditResetStoreError(400, 'CREDIT_RESET_ID_INVALID', '额度重置任务标识无效');
  return id;
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreditResetStoreError(400, 'CREDIT_RESET_INVALID', '额度重置配置必须是 JSON 对象');
  }
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toIso(value) {
  const date = validDate(value);
  if (!date) throw new CreditResetStoreError(422, 'CREDIT_RESET_TIME_INVALID', '额度重置执行时间无效');
  return date.toISOString();
}

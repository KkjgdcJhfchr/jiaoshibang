import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCreditResetStore } from './credit-reset-store.mjs';
import { createDataStore } from './data-store.mjs';

test('额度重置任务支持立即执行、持久化和幂等重试', async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-credit-reset-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let current = new Date('2026-09-10T01:00:00.000Z');
  const store = createCreditResetStore({ dataDir, now: () => current });
  const input = {
    userIds: ['usr_00000000-0000-4000-8000-000000000001', 'usr_00000000-0000-4000-8000-000000000002'],
    credits: 30,
    reason: '教师节额度重置',
    idempotencyKey: 'teachers-day-2026',
  };
  const first = store.createJob(input, 'admin-a');
  assert.equal(first.created, true);
  assert.equal(first.job.status, 'pending');
  assert.equal(store.createJob(input, 'admin-a').created, false);

  const calls = [];
  const result = await store.executeJob(first.job.id, async (job) => {
    calls.push(job);
    return { updatedCount: 2, skippedCount: 0 };
  });
  assert.equal(result.executed, true);
  assert.equal(result.job.status, 'completed');
  assert.equal(result.job.result.updatedCount, 2);
  assert.equal((await store.executeJob(first.job.id, () => { throw new Error('不应再次执行'); })).executed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, `credit-reset:${first.job.id}`);

  const reloaded = createCreditResetStore({ dataDir, now: () => current });
  assert.equal(reloaded.getJob(first.job.id).status, 'completed');
  assert.equal(reloaded.listJobs().length, 1);
});

test('额度重置任务支持定时执行、取消和失败状态', async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-credit-reset-schedule-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let current = new Date('2026-09-09T00:00:00.000Z');
  const store = createCreditResetStore({ dataDir, now: () => current });
  const scheduled = store.createJob({
    userIds: ['usr_00000000-0000-4000-8000-000000000003'],
    credits: 10,
    reason: '教师节定时重置',
    executeAt: '2026-09-10T00:00:00.000Z',
  }).job;
  assert.equal((await store.executeDue(() => ({ updatedCount: 1 }))).length, 0);
  current = new Date('2026-09-10T00:00:00.000Z');
  assert.equal((await store.executeDue(() => ({ updatedCount: 1 })))[0].job.status, 'completed');

  const cancelled = store.createJob({
    userIds: ['usr_00000000-0000-4000-8000-000000000004'], credits: 20, reason: '取消任务', executeAt: '2026-09-11T00:00:00.000Z',
  }).job;
  assert.equal(store.cancelJob(cancelled.id, 'admin-b').job.status, 'cancelled');

  const failed = store.createJob({
    userIds: ['usr_00000000-0000-4000-8000-000000000005'], credits: 20, reason: '失败任务',
  }).job;
  const failure = await store.executeJob(failed.id, () => { throw new Error('用户数据写入失败'); });
  assert.equal(failure.job.status, 'failed');
  assert.equal(failure.job.failureMessage, '用户数据写入失败');
});

test('服务重启会把残留执行中任务恢复为待执行并依赖 resetId 安全重试', async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-credit-reset-recover-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const current = new Date('2026-09-10T00:00:00.000Z');
  const store = createCreditResetStore({ dataDir, now: () => current });
  const created = store.createJob({
    userIds: ['usr_00000000-0000-4000-8000-000000000006'], credits: 50, reason: '进程重启恢复任务',
  }).job;
  const filename = join(dataDir, 'credit-resets.json');
  const state = JSON.parse(readFileSync(filename, 'utf8'));
  state.jobs[0].status = 'processing';
  state.jobs[0].processingStartedAt = current.toISOString();
  writeFileSync(filename, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const reloaded = createCreditResetStore({ dataDir, now: () => current });
  assert.equal(reloaded.getJob(created.id).status, 'pending');
  const calls = [];
  await reloaded.executeDue((job) => { calls.push(job.idempotencyKey); return { updatedCount: 1 }; });
  assert.deepEqual(calls, [`credit-reset:${created.id}`]);
});

test('定时执行时跳过已删除会员并继续重置仍存在会员', async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-credit-reset-deleted-users-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const current = new Date('2026-09-10T00:00:00.000Z');
  const users = createDataStore(dataDir, { now: () => current });
  const first = users.registerUser(userInput('first@example.com', 3));
  const second = users.registerUser(userInput('second@example.com', 4));
  const jobs = createCreditResetStore({ dataDir, now: () => current });
  const scheduled = jobs.createJob({ userIds: [first.id, second.id], credits: 50, reason: '定时任务部分用户被删除' }).job;
  users.deleteUsers([second.id]);

  const executed = await jobs.executeJob(scheduled.id, ({ jobId, userIds, credits, reason }) => users.resetUserCredits({
    userIds, credits, reason, resetId: jobId, executedAt: current,
  }));
  assert.equal(executed.job.status, 'completed');
  assert.equal(executed.job.result.updatedCount, 1);
  assert.equal(executed.job.result.skippedCount, 1);
  assert.match(executed.job.result.summary, /已重置 1 个会员/);
  assert.equal(users.findUserById(first.id).credits, 50);
});

test('定时执行时所有会员均已删除仍以可解释的完成结果收口', async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-credit-reset-all-deleted-'));
  context.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const current = new Date('2026-09-10T00:00:00.000Z');
  const users = createDataStore(dataDir, { now: () => current });
  const user = users.registerUser(userInput('deleted@example.com', 3));
  const jobs = createCreditResetStore({ dataDir, now: () => current });
  const scheduled = jobs.createJob({ userIds: [user.id], credits: 50, reason: '全部用户被删除' }).job;
  users.deleteUsers([user.id]);

  const executed = await jobs.executeJob(scheduled.id, ({ jobId, userIds, credits, reason }) => users.resetUserCredits({
    userIds, credits, reason, resetId: jobId, executedAt: current,
  }));
  assert.equal(executed.job.status, 'completed');
  assert.deepEqual(executed.job.result, {
    requestedCount: 1,
    updatedCount: 0,
    skippedCount: 1,
    summary: '所选会员均已不存在，本次任务未修改任何账号',
  });
});

function userInput(account, credits) {
  return {
    account,
    accountKey: account,
    displayName: account.split('@')[0],
    subject: '语文',
    password: { algorithm: 'test', salt: 'x', hash: account, keyLength: 1 },
    credits,
    trainingConsent: true,
  };
}

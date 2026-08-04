import assert from 'node:assert/strict';
import { pollRevisionJob, revisionJobResult } from './revisionJob.js';

async function completedJobTest() {
  const jobs = [
    { status: 'queued', phase: 'queued' },
    { status: 'running', phase: 'calling_model' },
    { status: 'running', phase: 'validating_result' },
    { status: 'completed', phase: 'completed' },
  ];
  const seen = [];
  let clock = 0;
  const job = await pollRevisionJob({
    jobId: 'rev-1',
    getJob: async () => ({ data: { job: { id: 'rev-1', ...jobs.shift(), pollAfterMs: 1 } } }),
    onStatus: (stage) => seen.push(stage),
    now: () => clock,
    sleep: async (delay) => { clock += delay; },
  });
  assert.equal(job.status, 'completed');
  assert.deepEqual(seen, ['queued', 'processing', 'applying', 'completed']);
}

async function failedJobTest() {
  await assert.rejects(
    pollRevisionJob({
      jobId: 'rev-2',
      getJob: async () => ({ job: { id: 'rev-2', status: 'failed', error: { code: 'UPSTREAM_FAILED', message: '模型服务未返回结果' } } }),
    }),
    (error) => error.code === 'UPSTREAM_FAILED' && error.terminal === true,
  );
}

async function unknownStatusTest() {
  await assert.rejects(
    pollRevisionJob({
      jobId: 'rev-3',
      getJob: async () => ({ job: { id: 'rev-3', status: 'mystery' } }),
    }),
    (error) => error.code === 'REVISION_JOB_STATUS_UNKNOWN',
  );
}

async function timeoutTest() {
  let clock = 0;
  await assert.rejects(
    pollRevisionJob({
      jobId: 'rev-4',
      getJob: async () => ({ job: { id: 'rev-4', status: 'running', pollAfterMs: 1_000 } }),
      maxWaitMs: 2_000,
      now: () => clock,
      sleep: async (delay) => { clock += delay; },
    }),
    (error) => error.code === 'REVISION_JOB_TIMEOUT',
  );
}

await completedJobTest();
await failedJobTest();
await unknownStatusTest();
await timeoutTest();

assert.deepEqual(
  revisionJobResult({ result: { lessonPlan: { metadata: {} }, customSections: [{ id: 'one' }] } }),
  { lessonPlan: { metadata: {} }, customSections: [{ id: 'one' }] },
);

console.log('revision job checks passed');

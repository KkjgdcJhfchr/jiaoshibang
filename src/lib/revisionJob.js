export const REVISION_JOB_MAX_WAIT_MS = 210_000;

export class RevisionJobError extends Error {
  constructor(message, { code = 'REVISION_JOB_ERROR', terminal = false, details = null } = {}) {
    super(message);
    this.name = 'RevisionJobError';
    this.code = code;
    this.terminal = terminal;
    this.details = details;
  }
}

export function unwrapRevisionJob(response) {
  const job = response?.data?.job || response?.job;
  if (!job || typeof job !== 'object' || !job.id) {
    throw new RevisionJobError('服务器没有返回有效的修改任务，请稍后重试。', {
      code: 'REVISION_JOB_MISSING',
    });
  }
  return job;
}

export function revisionStageForStatus(status) {
  if (status === 'queued' || status === 'pending') return 'queued';
  if (status === 'running' || status === 'processing' || status === 'routing' || status === 'calling_model') return 'processing';
  if (status === 'validating_result' || status === 'applying') return 'applying';
  if (status === 'completed' || status === 'succeeded') return 'completed';
  if (status === 'failed') return 'failed';
  return 'unknown';
}

function abortError() {
  return new RevisionJobError('已停止在本页面等待，后台任务可能仍在运行。', {
    code: 'REVISION_WAIT_CANCELLED',
  });
}

export function waitForRevisionPoll(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      reject(abortError());
    }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

export async function pollRevisionJob({
  jobId,
  getJob,
  onStatus = () => {},
  signal,
  maxWaitMs = REVISION_JOB_MAX_WAIT_MS,
  now = () => Date.now(),
  sleep = waitForRevisionPoll,
}) {
  const startedAt = now();
  for (;;) {
    if (signal?.aborted) throw abortError();
    if (now() - startedAt >= maxWaitMs) {
      throw new RevisionJobError('本次修改等待超过 210 秒，已停止等待。后台任务可能仍在运行，可点击重试继续查询。', {
        code: 'REVISION_JOB_TIMEOUT',
      });
    }

    let response;
    try {
      response = await getJob(jobId);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw new RevisionJobError(error?.message || '查询修改进度失败，请检查网络后重试。', {
        code: error?.code || 'REVISION_JOB_NETWORK_ERROR',
        details: error?.details || null,
      });
    }
    const job = unwrapRevisionJob(response);
    const stage = revisionStageForStatus(job.phase || job.status);
    const terminalStage = revisionStageForStatus(job.status);
    onStatus(stage, job);

    if (terminalStage === 'completed') return job;
    if (terminalStage === 'failed') {
      throw new RevisionJobError(job.error?.message || '本次修改没有完成，请调整要求后重试。', {
        code: job.error?.code || 'REVISION_JOB_FAILED',
        terminal: true,
        details: job.error?.details || null,
      });
    }
    if (stage === 'unknown') {
      throw new RevisionJobError('服务器返回了无法识别的修改任务状态，请稍后重试。', {
        code: 'REVISION_JOB_STATUS_UNKNOWN',
      });
    }

    const remainingMs = maxWaitMs - (now() - startedAt);
    if (remainingMs <= 0) continue;
    const delayMs = Math.min(5_000, Math.max(750, Number(job.pollAfterMs) || 1_500), remainingMs);
    await sleep(delayMs, signal);
  }
}

export function revisionJobResult(job) {
  const result = job?.result || job?.data?.result || job?.data || job?.output || job;
  return {
    lessonPlan: result?.lessonPlan || result?.plan || null,
    customSections: result?.customSections || result?.sections || [],
  };
}

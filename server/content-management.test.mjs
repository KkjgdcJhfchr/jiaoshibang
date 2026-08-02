import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentManagementStore } from './content-management.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'teacher-content-management-'));
let currentTime = new Date('2026-08-02T08:00:00.000Z');
let nextId = 0;
const now = () => new Date(currentTime);
const createId = (prefix) => `${prefix}_${++nextId}`;

try {
  const store = createContentManagementStore({ dataDir, now, createId });

  assert.deepEqual(store.listAnnouncements(), []);
  assert.deepEqual(store.getBootstrap('usr_one'), { announcements: [], tutorial: null });
  assert.equal(store.getTutorial().enabled, false);
  assert.equal(store.getTutorial().version, 0);

  const draft = store.createAnnouncement({
    title: '暑期功能更新',
    content: '新增教材上传与详细教案生成功能。',
    enabled: false,
    priority: 10,
    displayPolicy: 'once_per_revision',
  }, 'owner');
  assert.equal(draft.revision, 1);
  assert.equal(store.getBootstrap('usr_one').announcements.length, 0, '未启用公告不得公开');

  currentTime = new Date('2026-08-02T08:01:00.000Z');
  const published = store.updateAnnouncement(draft.id, {
    expectedUpdatedAt: draft.updatedAt,
    enabled: true,
    startsAt: '2026-08-02T08:00:00.000Z',
    endsAt: '2026-08-03T08:00:00.000Z',
  }, 'owner');
  assert.equal(published.revision, 2);
  assert.equal(store.getBootstrap('usr_one').announcements[0].id, draft.id);
  assert.equal('updatedBy' in store.getBootstrap('usr_one').announcements[0], false, '公开公告不得暴露管理员字段');

  const receipt = store.acknowledgeAnnouncement('usr_one', draft.id, { revision: published.revision });
  assert.equal(receipt.revision, 2);
  assert.equal(store.getBootstrap('usr_one').announcements.length, 0);
  assert.deepEqual(
    store.acknowledgeAnnouncement('usr_one', draft.id, { revision: published.revision }),
    receipt,
    '重复确认必须幂等',
  );

  currentTime = new Date('2026-08-02T08:02:00.000Z');
  const revised = store.updateAnnouncement(draft.id, {
    expectedUpdatedAt: published.updatedAt,
    content: '新增教材上传、详细教案生成与教案修改功能。',
  });
  assert.equal(revised.revision, 3);
  assert.equal(store.getBootstrap('usr_one').announcements.length, 1, '按版本确认的公告更新后应重新展示');

  const oncePerUser = store.createAnnouncement({
    title: '平台使用须知',
    content: '请勿上传与备课无关的个人敏感信息。',
    enabled: true,
    priority: 20,
    displayPolicy: 'once_per_user',
  });
  store.acknowledgeAnnouncement('usr_one', oncePerUser.id);
  currentTime = new Date('2026-08-02T08:03:00.000Z');
  store.updateAnnouncement(oncePerUser.id, { content: '请仅上传有权用于备课的教材内容。' });
  assert.equal(
    store.getBootstrap('usr_one').announcements.some((item) => item.id === oncePerUser.id),
    false,
    '按用户确认的公告更新后也不应重复展示',
  );

  const everyLogin = store.createAnnouncement({
    title: '重要提醒',
    content: '系统将在今晚进行维护。',
    enabled: true,
    priority: 100,
    displayPolicy: 'every_login',
  });
  store.acknowledgeAnnouncement('usr_one', everyLogin.id);
  assert.equal(store.getBootstrap('usr_one').announcements[0].id, everyLogin.id, '每次登录公告应忽略历史确认并保持优先级排序');

  assert.throws(
    () => store.createAnnouncement({ title: '无效', content: '无效周期', startsAt: '2026-08-03T00:00:00.000Z', endsAt: '2026-08-02T00:00:00.000Z' }),
    (error) => error.code === 'ANNOUNCEMENT_PERIOD_INVALID' && error.status === 422,
  );
  assert.throws(
    () => store.createAnnouncement({ title: '无效', content: '未知字段', unknown: true }),
    (error) => error.code === 'ANNOUNCEMENT_FIELD_UNKNOWN' && error.status === 400,
  );
  assert.throws(
    () => store.updateAnnouncement(revised.id, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z', title: '冲突' }),
    (error) => error.code === 'ANNOUNCEMENT_CONFLICT' && error.status === 409,
  );

  currentTime = new Date('2026-08-02T08:04:00.000Z');
  const deleted = store.deleteAnnouncement(everyLogin.id, { expectedUpdatedAt: everyLogin.updatedAt }, 'owner');
  assert.ok(deleted.deletedAt);
  assert.equal(store.getAnnouncement(everyLogin.id), null);
  assert.equal(store.listAnnouncements().some((item) => item.id === everyLogin.id), false);
  assert.equal(store.listAnnouncements({ includeDeleted: true }).some((item) => item.id === everyLogin.id), true);
  assert.equal(store.getBootstrap('usr_two').announcements.some((item) => item.id === everyLogin.id), false, '删除公告不得公开');

  assert.throws(
    () => store.saveTutorial({ enabled: true, steps: [] }),
    (error) => error.code === 'TUTORIAL_STEPS_REQUIRED' && error.status === 422,
  );

  currentTime = new Date('2026-08-02T08:05:00.000Z');
  const tutorialV1 = store.saveTutorial({
    title: '第一次使用备课星',
    enabled: true,
    steps: [
      { title: '上传教材', content: '点击新建教案，然后上传教材图片或 PDF。', order: 2 },
      { title: '填写课程信息', content: '先选择学科、年级并填写章节标题。', order: 1 },
    ],
  }, 'owner');
  assert.equal(tutorialV1.version, 1);
  assert.deepEqual(tutorialV1.steps.map((step) => step.order), [1, 2]);
  assert.deepEqual(tutorialV1.steps.map((step) => step.title), ['填写课程信息', '上传教材']);

  const initialTutorial = store.getBootstrap('usr_tutorial').tutorial;
  assert.equal(initialTutorial.version, 1);
  assert.equal(initialTutorial.progress.status, 'not_started');
  assert.equal(initialTutorial.progress.currentStepId, tutorialV1.steps[0].id);

  const activeProgress = store.saveTutorialProgress('usr_tutorial', {
    tutorialId: tutorialV1.id,
    version: tutorialV1.version,
    status: 'active',
    currentStepId: tutorialV1.steps[1].id,
  });
  assert.equal(activeProgress.currentStepId, tutorialV1.steps[1].id);
  assert.equal(store.getBootstrap('usr_tutorial').tutorial.progress.currentStepId, tutorialV1.steps[1].id);

  currentTime = new Date('2026-08-02T08:06:00.000Z');
  const completed = store.saveTutorialProgress('usr_tutorial', {
    version: tutorialV1.version,
    status: 'completed',
  });
  assert.equal(completed.status, 'completed');
  assert.equal(store.getBootstrap('usr_tutorial').tutorial, null, '完成当前版本后不得重复弹出');

  currentTime = new Date('2026-08-02T08:07:00.000Z');
  const withThirdStep = store.addTutorialStep({
    expectedUpdatedAt: tutorialV1.updatedAt,
    title: '生成并修改',
    content: '确认生成后，可以继续用自然语言提出修改要求。',
    position: 2,
  }, 'owner');
  assert.equal(withThirdStep.version, 2);
  assert.equal(withThirdStep.steps.length, 3);
  assert.equal(store.getBootstrap('usr_tutorial').tutorial.version, 2, '教程升级后应向已完成旧版本的用户重新展示');

  currentTime = new Date('2026-08-02T08:08:00.000Z');
  const reordered = store.reorderTutorialSteps(
    [...withThirdStep.steps].reverse().map((step) => step.id),
    { expectedUpdatedAt: withThirdStep.updatedAt },
    'owner',
  );
  assert.equal(reordered.version, 3);
  assert.deepEqual(reordered.steps.map((step) => step.order), [1, 2, 3]);
  assert.equal(reordered.steps[0].id, withThirdStep.steps.at(-1).id);

  currentTime = new Date('2026-08-02T08:09:00.000Z');
  const editedStep = store.updateTutorialStep(reordered.steps[0].id, {
    expectedUpdatedAt: reordered.updatedAt,
    title: '生成、修改与定稿',
  }, 'owner');
  assert.equal(editedStep.version, 4);
  assert.equal(editedStep.steps[0].title, '生成、修改与定稿');

  currentTime = new Date('2026-08-02T08:10:00.000Z');
  const afterDeleteStep = store.deleteTutorialStep(
    editedStep.steps[1].id,
    { expectedUpdatedAt: editedStep.updatedAt },
    'owner',
  );
  assert.equal(afterDeleteStep.version, 5);
  assert.equal(afterDeleteStep.steps.length, 2);
  assert.deepEqual(afterDeleteStep.steps.map((step) => step.order), [1, 2]);

  assert.throws(
    () => store.saveTutorialProgress('usr_invalid', { version: 4, status: 'active', currentStepId: afterDeleteStep.steps[0].id }),
    (error) => error.code === 'TUTORIAL_VERSION_CONFLICT' && error.status === 409,
  );
  assert.throws(
    () => store.saveTutorialProgress('usr_invalid', { version: 5, status: 'active', currentStepId: 'step_missing' }),
    (error) => error.code === 'TUTORIAL_CURRENT_STEP_INVALID' && error.status === 422,
  );

  const restarted = createContentManagementStore({ dataDir, now, createId });
  assert.equal(restarted.getTutorial().version, 5, '教程配置必须持久化');
  assert.equal(restarted.getBootstrap('usr_tutorial').tutorial.version, 5, '教程进度与版本必须持久化');
  assert.equal(
    restarted.getBootstrap('usr_one').announcements.some((item) => item.id === oncePerUser.id),
    false,
    '公告确认记录必须持久化',
  );

  for (const filename of ['announcements.json', 'onboarding-tutorial.json', 'content-progress.json']) {
    assert.equal(existsSync(join(dataDir, filename)), true, `${filename} 应已写入`);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(dataDir, filename), 'utf8')));
  }
  assert.equal(readdirSync(dataDir).some((filename) => filename.includes('.tmp-')), false, '原子写入不应遗留临时文件');

  console.log(JSON.stringify({
    ok: true,
    checks: {
      announcementCrudAndScheduling: true,
      displayPoliciesAndAcknowledgements: true,
      softDeleteNotPublic: true,
      tutorialStepCrudAndOrdering: true,
      tutorialVersioningAndProgress: true,
      atomicPersistenceAndStrictValidation: true,
      publicBootstrapIsolation: true,
    },
  }));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;
const MAX_ANNOUNCEMENTS = 500;
const MAX_TUTORIAL_STEPS = 50;
const DISPLAY_POLICIES = new Set(['once_per_user', 'once_per_revision', 'every_login']);
const TUTORIAL_STATUSES = new Set(['active', 'completed', 'skipped']);
const ANNOUNCEMENT_FIELDS = new Set([
  'expectedUpdatedAt',
  'title',
  'content',
  'enabled',
  'startsAt',
  'endsAt',
  'priority',
  'displayPolicy',
]);
const TUTORIAL_FIELDS = new Set(['expectedUpdatedAt', 'title', 'enabled', 'steps']);
const TUTORIAL_STEP_FIELDS = new Set(['id', 'title', 'content', 'order']);

export function createContentManagementStore({
  dataDir,
  now = () => new Date(),
  createId = (prefix) => `${prefix}_${randomUUID()}`,
} = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createId !== 'function') throw new TypeError('createId must be a function');

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const announcementsFile = join(dataDir, 'announcements.json');
  const tutorialFile = join(dataDir, 'onboarding-tutorial.json');
  const progressFile = join(dataDir, 'content-progress.json');
  const announcementsState = readAnnouncementsState(announcementsFile);
  let tutorialState = readTutorialState(tutorialFile);
  const progressState = readProgressState(progressFile);

  function listAnnouncements({ includeDeleted = false } = {}) {
    if (typeof includeDeleted !== 'boolean') {
      throw contentError(400, 'ANNOUNCEMENT_LIST_INVALID', 'includeDeleted 必须是布尔值');
    }
    return announcementsState.announcements
      .filter((announcement) => includeDeleted || !announcement.deletedAt)
      .sort(compareAnnouncementsForAdmin)
      .map(publicAdminAnnouncement);
  }

  function getAnnouncement(announcementId, { includeDeleted = false } = {}) {
    const id = normalizeId(announcementId, 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
    const announcement = announcementsState.announcements.find((item) => item.id === id) || null;
    if (!announcement || (!includeDeleted && announcement.deletedAt)) return null;
    return publicAdminAnnouncement(announcement);
  }

  function createAnnouncement(input, actor = 'admin') {
    assertObject(input, 'ANNOUNCEMENT_INVALID', '公告配置必须是对象');
    assertAllowedFields(input, ANNOUNCEMENT_FIELDS, 'ANNOUNCEMENT_FIELD_UNKNOWN', '公告配置');
    if (input.expectedUpdatedAt !== undefined) {
      throw contentError(400, 'ANNOUNCEMENT_FIELD_UNKNOWN', '新建公告不支持 expectedUpdatedAt');
    }
    if (announcementsState.announcements.filter((item) => !item.deletedAt).length >= MAX_ANNOUNCEMENTS) {
      throw contentError(409, 'ANNOUNCEMENT_LIMIT', `有效公告数量不能超过 ${MAX_ANNOUNCEMENTS} 条`);
    }
    const timestamp = isoNow(now);
    const id = normalizeId(createId('announcement'), 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
    if (announcementsState.announcements.some((item) => item.id === id)) {
      throw contentError(409, 'ANNOUNCEMENT_ID_CONFLICT', '公告编号重复');
    }
    const announcement = normalizeAnnouncementInput(input, null, {
      id,
      timestamp,
      actor,
    });
    announcementsState.announcements.push(announcement);
    announcementsState.updatedAt = timestamp;
    writeState(announcementsFile, announcementsState);
    return publicAdminAnnouncement(announcement);
  }

  function updateAnnouncement(announcementId, input, actor = 'admin') {
    const id = normalizeId(announcementId, 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
    assertObject(input, 'ANNOUNCEMENT_INVALID', '公告配置必须是对象');
    assertAllowedFields(input, ANNOUNCEMENT_FIELDS, 'ANNOUNCEMENT_FIELD_UNKNOWN', '公告配置');
    const index = announcementsState.announcements.findIndex((item) => item.id === id);
    if (index < 0 || announcementsState.announcements[index].deletedAt) {
      throw contentError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
    }
    const existing = announcementsState.announcements[index];
    assertExpectedUpdatedAt(input.expectedUpdatedAt, existing.updatedAt, 'ANNOUNCEMENT_CONFLICT', '公告');
    const timestamp = isoNow(now);
    const updated = normalizeAnnouncementInput(input, existing, { id, timestamp, actor });
    announcementsState.announcements[index] = updated;
    announcementsState.updatedAt = timestamp;
    writeState(announcementsFile, announcementsState);
    return publicAdminAnnouncement(updated);
  }

  function deleteAnnouncement(announcementId, options = {}, actor = 'admin') {
    const id = normalizeId(announcementId, 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
    assertObject(options, 'ANNOUNCEMENT_DELETE_INVALID', '公告删除参数必须是对象');
    assertAllowedFields(options, new Set(['expectedUpdatedAt']), 'ANNOUNCEMENT_FIELD_UNKNOWN', '公告删除参数');
    const index = announcementsState.announcements.findIndex((item) => item.id === id);
    if (index < 0 || announcementsState.announcements[index].deletedAt) {
      throw contentError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
    }
    const existing = announcementsState.announcements[index];
    assertExpectedUpdatedAt(options.expectedUpdatedAt, existing.updatedAt, 'ANNOUNCEMENT_CONFLICT', '公告');
    const timestamp = isoNow(now);
    const deleted = {
      ...existing,
      enabled: false,
      revision: existing.revision + 1,
      updatedAt: timestamp,
      updatedBy: normalizeActor(actor),
      deletedAt: timestamp,
      deletedBy: normalizeActor(actor),
    };
    announcementsState.announcements[index] = deleted;
    announcementsState.updatedAt = timestamp;
    writeState(announcementsFile, announcementsState);
    return publicAdminAnnouncement(deleted);
  }

  function getTutorial() {
    return publicAdminTutorial(tutorialState.tutorial);
  }

  function saveTutorial(input, actor = 'admin') {
    assertObject(input, 'TUTORIAL_INVALID', '新手教程配置必须是对象');
    assertAllowedFields(input, TUTORIAL_FIELDS, 'TUTORIAL_FIELD_UNKNOWN', '新手教程配置');
    assertExpectedUpdatedAt(input.expectedUpdatedAt, tutorialState.tutorial.updatedAt, 'TUTORIAL_CONFLICT', '新手教程');
    const timestamp = isoNow(now);
    const normalized = normalizeTutorialInput(input, tutorialState.tutorial, {
      timestamp,
      actor,
      createId,
    });
    if (sameTutorialDefinition(normalized, tutorialState.tutorial)) return publicAdminTutorial(tutorialState.tutorial);
    tutorialState = {
      ...tutorialState,
      updatedAt: timestamp,
      tutorial: {
        ...normalized,
        version: tutorialState.tutorial.version + 1,
        createdAt: tutorialState.tutorial.createdAt || timestamp,
        updatedAt: timestamp,
        updatedBy: normalizeActor(actor),
      },
    };
    writeState(tutorialFile, tutorialState);
    return publicAdminTutorial(tutorialState.tutorial);
  }

  function addTutorialStep(input, actor = 'admin') {
    assertObject(input, 'TUTORIAL_STEP_INVALID', '教程步骤必须是对象');
    const expectedUpdatedAt = input.expectedUpdatedAt;
    const position = input.position;
    const stepInput = omit(input, ['expectedUpdatedAt', 'position']);
    assertAllowedFields(stepInput, TUTORIAL_STEP_FIELDS, 'TUTORIAL_STEP_FIELD_UNKNOWN', '教程步骤');
    if (tutorialState.tutorial.steps.length >= MAX_TUTORIAL_STEPS) {
      throw contentError(409, 'TUTORIAL_STEP_LIMIT', `教程步骤不能超过 ${MAX_TUTORIAL_STEPS} 个`);
    }
    const step = normalizeTutorialStep(stepInput, {
      fallbackId: createId('step'),
      fallbackOrder: tutorialState.tutorial.steps.length + 1,
    });
    if (tutorialState.tutorial.steps.some((item) => item.id === step.id)) {
      throw contentError(409, 'TUTORIAL_STEP_ID_CONFLICT', '教程步骤编号重复');
    }
    const steps = [...tutorialState.tutorial.steps];
    const insertAt = position === undefined
      ? steps.length
      : boundedInteger(position, 0, steps.length, 'TUTORIAL_STEP_POSITION_INVALID', '步骤插入位置无效');
    steps.splice(insertAt, 0, step);
    return saveTutorial({ expectedUpdatedAt, steps: renumberSteps(steps) }, actor);
  }

  function updateTutorialStep(stepId, input, actor = 'admin') {
    const id = normalizeId(stepId, 'TUTORIAL_STEP_ID_INVALID', '教程步骤编号无效');
    assertObject(input, 'TUTORIAL_STEP_INVALID', '教程步骤必须是对象');
    const expectedUpdatedAt = input.expectedUpdatedAt;
    const updates = omit(input, ['expectedUpdatedAt']);
    assertAllowedFields(updates, new Set(['title', 'content']), 'TUTORIAL_STEP_FIELD_UNKNOWN', '教程步骤');
    const index = tutorialState.tutorial.steps.findIndex((step) => step.id === id);
    if (index < 0) throw contentError(404, 'TUTORIAL_STEP_NOT_FOUND', '教程步骤不存在');
    const steps = tutorialState.tutorial.steps.map((step, stepIndex) => (
      stepIndex === index
        ? normalizeTutorialStep({ ...step, ...updates }, { fallbackId: id, fallbackOrder: step.order })
        : step
    ));
    return saveTutorial({ expectedUpdatedAt, steps }, actor);
  }

  function deleteTutorialStep(stepId, options = {}, actor = 'admin') {
    const id = normalizeId(stepId, 'TUTORIAL_STEP_ID_INVALID', '教程步骤编号无效');
    assertObject(options, 'TUTORIAL_STEP_DELETE_INVALID', '步骤删除参数必须是对象');
    assertAllowedFields(options, new Set(['expectedUpdatedAt']), 'TUTORIAL_STEP_FIELD_UNKNOWN', '步骤删除参数');
    if (!tutorialState.tutorial.steps.some((step) => step.id === id)) {
      throw contentError(404, 'TUTORIAL_STEP_NOT_FOUND', '教程步骤不存在');
    }
    const steps = renumberSteps(tutorialState.tutorial.steps.filter((step) => step.id !== id));
    if (tutorialState.tutorial.enabled && steps.length === 0) {
      throw contentError(422, 'TUTORIAL_STEPS_REQUIRED', '启用教程时至少需要一个步骤，请先停用教程');
    }
    return saveTutorial({ expectedUpdatedAt: options.expectedUpdatedAt, steps }, actor);
  }

  function reorderTutorialSteps(stepIds, options = {}, actor = 'admin') {
    if (!Array.isArray(stepIds)) throw contentError(422, 'TUTORIAL_STEP_ORDER_INVALID', '步骤顺序必须是编号数组');
    assertObject(options, 'TUTORIAL_STEP_ORDER_INVALID', '步骤排序参数必须是对象');
    assertAllowedFields(options, new Set(['expectedUpdatedAt']), 'TUTORIAL_STEP_FIELD_UNKNOWN', '步骤排序参数');
    if (stepIds.length !== tutorialState.tutorial.steps.length) {
      throw contentError(422, 'TUTORIAL_STEP_ORDER_INVALID', '步骤顺序必须包含当前全部步骤');
    }
    const normalizedIds = stepIds.map((id) => normalizeId(id, 'TUTORIAL_STEP_ID_INVALID', '教程步骤编号无效'));
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      throw contentError(422, 'TUTORIAL_STEP_ORDER_INVALID', '步骤顺序不能包含重复编号');
    }
    const byId = new Map(tutorialState.tutorial.steps.map((step) => [step.id, step]));
    if (normalizedIds.some((id) => !byId.has(id))) {
      throw contentError(422, 'TUTORIAL_STEP_ORDER_INVALID', '步骤顺序包含不存在的编号');
    }
    const steps = normalizedIds.map((id) => byId.get(id));
    return saveTutorial({ expectedUpdatedAt: options.expectedUpdatedAt, steps: renumberSteps(steps) }, actor);
  }

  function acknowledgeAnnouncement(userId, announcementId, options = {}) {
    const normalizedUserId = normalizeUserId(userId);
    const id = normalizeId(announcementId, 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
    assertObject(options, 'ANNOUNCEMENT_ACK_INVALID', '公告确认参数必须是对象');
    assertAllowedFields(options, new Set(['revision']), 'ANNOUNCEMENT_ACK_FIELD_UNKNOWN', '公告确认参数');
    const announcement = announcementsState.announcements.find((item) => item.id === id && !item.deletedAt);
    if (!announcement) throw contentError(404, 'ANNOUNCEMENT_NOT_FOUND', '公告不存在');
    const revision = options.revision === undefined
      ? announcement.revision
      : boundedInteger(options.revision, 1, Number.MAX_SAFE_INTEGER, 'ANNOUNCEMENT_REVISION_INVALID', '公告版本无效');
    if (revision !== announcement.revision) {
      throw contentError(409, 'ANNOUNCEMENT_REVISION_CONFLICT', '公告已更新，请读取最新内容后确认');
    }
    const timestamp = isoNow(now);
    const record = getOrCreateProgressRecord(progressState, normalizedUserId, timestamp);
    const existing = record.announcementReceipts.find((receipt) => (
      receipt.announcementId === id && receipt.revision === revision
    ));
    if (existing) return structuredClone(existing);
    const receipt = { announcementId: id, revision, acknowledgedAt: timestamp };
    record.announcementReceipts.push(receipt);
    record.updatedAt = timestamp;
    progressState.updatedAt = timestamp;
    writeState(progressFile, progressState);
    return structuredClone(receipt);
  }

  function saveTutorialProgress(userId, input) {
    const normalizedUserId = normalizeUserId(userId);
    assertObject(input, 'TUTORIAL_PROGRESS_INVALID', '教程进度必须是对象');
    assertAllowedFields(
      input,
      new Set(['tutorialId', 'version', 'status', 'currentStepId']),
      'TUTORIAL_PROGRESS_FIELD_UNKNOWN',
      '教程进度',
    );
    const tutorialId = normalizeId(input.tutorialId ?? tutorialState.tutorial.id, 'TUTORIAL_ID_INVALID', '教程编号无效');
    if (tutorialId !== tutorialState.tutorial.id) throw contentError(404, 'TUTORIAL_NOT_FOUND', '教程不存在');
    const version = boundedInteger(input.version, 1, Number.MAX_SAFE_INTEGER, 'TUTORIAL_VERSION_INVALID', '教程版本无效');
    if (version !== tutorialState.tutorial.version) {
      throw contentError(409, 'TUTORIAL_VERSION_CONFLICT', '教程内容已更新，请重新读取后继续');
    }
    const status = cleanSingleLine(input.status, 30);
    if (!TUTORIAL_STATUSES.has(status)) throw contentError(422, 'TUTORIAL_STATUS_INVALID', '教程进度状态无效');
    const currentStepId = input.currentStepId === undefined || input.currentStepId === null || input.currentStepId === ''
      ? null
      : normalizeId(input.currentStepId, 'TUTORIAL_STEP_ID_INVALID', '教程步骤编号无效');
    if (status === 'active') {
      if (!currentStepId || !tutorialState.tutorial.steps.some((step) => step.id === currentStepId)) {
        throw contentError(422, 'TUTORIAL_CURRENT_STEP_INVALID', '进行中的教程必须指定有效步骤');
      }
    } else if (currentStepId && !tutorialState.tutorial.steps.some((step) => step.id === currentStepId)) {
      throw contentError(422, 'TUTORIAL_CURRENT_STEP_INVALID', '教程步骤不存在');
    }
    const timestamp = isoNow(now);
    const record = getOrCreateProgressRecord(progressState, normalizedUserId, timestamp);
    const progress = { tutorialId, version, status, currentStepId, updatedAt: timestamp };
    record.tutorialProgress = progress;
    record.updatedAt = timestamp;
    progressState.updatedAt = timestamp;
    writeState(progressFile, progressState);
    return structuredClone(progress);
  }

  function getBootstrap(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const record = progressState.records.find((item) => item.userId === normalizedUserId) || null;
    const timestamp = toDate(now(), '系统时间无效');
    const announcements = announcementsState.announcements
      .filter((announcement) => isAnnouncementActive(announcement, timestamp))
      .filter((announcement) => shouldDisplayAnnouncement(announcement, record?.announcementReceipts || []))
      .sort(compareAnnouncementsForDisplay)
      .map(publicAnnouncement);
    const tutorial = publicTutorialForUser(tutorialState.tutorial, record?.tutorialProgress || null);
    return { announcements, tutorial };
  }

  return {
    acknowledgeAnnouncement,
    addTutorialStep,
    createAnnouncement,
    deleteAnnouncement,
    deleteTutorialStep,
    getAnnouncement,
    getBootstrap,
    getTutorial,
    listAnnouncements,
    reorderTutorialSteps,
    saveTutorial,
    saveTutorialProgress,
    updateAnnouncement,
    updateTutorialStep,
  };
}

function normalizeAnnouncementInput(input, existing, { id, timestamp, actor }) {
  const title = cleanSingleLine(input.title ?? existing?.title, 100);
  const content = cleanMultiline(input.content ?? existing?.content, 20_000);
  const enabled = input.enabled === undefined ? Boolean(existing?.enabled) : strictBoolean(input.enabled, 'ANNOUNCEMENT_ENABLED_INVALID', '公告启用状态');
  const startsAt = input.startsAt === undefined ? (existing?.startsAt ?? null) : optionalIso(input.startsAt, 'ANNOUNCEMENT_START_INVALID', '公告开始时间无效');
  const endsAt = input.endsAt === undefined ? (existing?.endsAt ?? null) : optionalIso(input.endsAt, 'ANNOUNCEMENT_END_INVALID', '公告结束时间无效');
  const priority = input.priority === undefined
    ? Number(existing?.priority || 0)
    : boundedInteger(input.priority, -10_000, 10_000, 'ANNOUNCEMENT_PRIORITY_INVALID', '公告优先级需为 -10000 至 10000 的整数');
  const displayPolicy = cleanSingleLine(input.displayPolicy ?? existing?.displayPolicy ?? 'once_per_revision', 40);
  if (!title) throw contentError(422, 'ANNOUNCEMENT_TITLE_INVALID', '公告标题不能为空');
  if (!content) throw contentError(422, 'ANNOUNCEMENT_CONTENT_INVALID', '公告正文不能为空');
  if (!DISPLAY_POLICIES.has(displayPolicy)) {
    throw contentError(422, 'ANNOUNCEMENT_DISPLAY_POLICY_INVALID', '公告展示策略无效');
  }
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw contentError(422, 'ANNOUNCEMENT_PERIOD_INVALID', '公告结束时间必须晚于开始时间');
  }
  return {
    id,
    title,
    content,
    enabled,
    startsAt,
    endsAt,
    priority,
    displayPolicy,
    revision: existing ? existing.revision + 1 : 1,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    updatedBy: normalizeActor(actor),
    deletedAt: null,
    deletedBy: null,
  };
}

function normalizeTutorialInput(input, existing, { timestamp, actor, createId }) {
  const title = cleanSingleLine(input.title ?? existing.title ?? '新手使用教程', 100);
  const enabled = input.enabled === undefined ? Boolean(existing.enabled) : strictBoolean(input.enabled, 'TUTORIAL_ENABLED_INVALID', '教程启用状态');
  const rawSteps = input.steps === undefined ? existing.steps : input.steps;
  if (!title) throw contentError(422, 'TUTORIAL_TITLE_INVALID', '教程标题不能为空');
  if (!Array.isArray(rawSteps) || rawSteps.length > MAX_TUTORIAL_STEPS) {
    throw contentError(422, 'TUTORIAL_STEPS_INVALID', `教程步骤必须是数组且不能超过 ${MAX_TUTORIAL_STEPS} 个`);
  }
  const steps = normalizeTutorialSteps(rawSteps, createId);
  if (enabled && steps.length === 0) {
    throw contentError(422, 'TUTORIAL_STEPS_REQUIRED', '启用教程时至少需要一个步骤');
  }
  return {
    id: existing.id,
    title,
    enabled,
    version: existing.version,
    steps,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
    updatedBy: normalizeActor(actor),
  };
}

function normalizeTutorialSteps(rawSteps, createId) {
  const normalized = rawSteps.map((step, index) => {
    assertObject(step, 'TUTORIAL_STEP_INVALID', `第 ${index + 1} 个教程步骤必须是对象`);
    assertAllowedFields(step, TUTORIAL_STEP_FIELDS, 'TUTORIAL_STEP_FIELD_UNKNOWN', `第 ${index + 1} 个教程步骤`);
    return normalizeTutorialStep(step, {
      fallbackId: createId('step'),
      fallbackOrder: index + 1,
    });
  });
  const ids = normalized.map((step) => step.id);
  if (new Set(ids).size !== ids.length) throw contentError(422, 'TUTORIAL_STEP_ID_CONFLICT', '教程步骤编号不能重复');
  const orders = normalized.map((step) => step.order);
  if (new Set(orders).size !== orders.length) throw contentError(422, 'TUTORIAL_STEP_ORDER_INVALID', '教程步骤顺序不能重复');
  return renumberSteps(normalized.sort((left, right) => left.order - right.order));
}

function normalizeTutorialStep(input, { fallbackId, fallbackOrder }) {
  const id = normalizeId(input.id ?? fallbackId, 'TUTORIAL_STEP_ID_INVALID', '教程步骤编号无效');
  const title = cleanSingleLine(input.title, 100);
  const content = cleanMultiline(input.content, 5_000);
  const order = input.order === undefined
    ? fallbackOrder
    : boundedInteger(input.order, 1, MAX_TUTORIAL_STEPS, 'TUTORIAL_STEP_ORDER_INVALID', '教程步骤顺序无效');
  if (!title) throw contentError(422, 'TUTORIAL_STEP_TITLE_INVALID', '教程步骤标题不能为空');
  if (!content) throw contentError(422, 'TUTORIAL_STEP_CONTENT_INVALID', '教程步骤正文不能为空');
  return { id, title, content, order };
}

function readAnnouncementsState(filename) {
  if (!existsSync(filename)) return { schemaVersion: SCHEMA_VERSION, updatedAt: null, announcements: [] };
  const state = readJson(filename, '公告数据');
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !Array.isArray(state.announcements) || state.announcements.length > MAX_ANNOUNCEMENTS * 2) {
    throw new Error('announcements.json 数据结构无效');
  }
  const ids = new Set();
  for (const announcement of state.announcements) {
    validateStoredAnnouncement(announcement);
    if (ids.has(announcement.id)) throw new Error(`announcements.json 包含重复公告 ${announcement.id}`);
    ids.add(announcement.id);
  }
  return state;
}

function readTutorialState(filename) {
  const empty = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: null,
    tutorial: {
      id: 'default',
      title: '新手使用教程',
      enabled: false,
      version: 0,
      steps: [],
      createdAt: null,
      updatedAt: null,
      updatedBy: 'system-default',
    },
  };
  if (!existsSync(filename)) return empty;
  const state = readJson(filename, '新手教程数据');
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.tutorial || typeof state.tutorial !== 'object' || Array.isArray(state.tutorial)) {
    throw new Error('onboarding-tutorial.json 数据结构无效');
  }
  validateStoredTutorial(state.tutorial);
  return state;
}

function readProgressState(filename) {
  if (!existsSync(filename)) return { schemaVersion: SCHEMA_VERSION, updatedAt: null, records: [] };
  const state = readJson(filename, '内容进度数据');
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !Array.isArray(state.records)) {
    throw new Error('content-progress.json 数据结构无效');
  }
  const userIds = new Set();
  for (const record of state.records) {
    validateProgressRecord(record);
    if (userIds.has(record.userId)) throw new Error(`content-progress.json 包含重复用户 ${record.userId}`);
    userIds.add(record.userId);
  }
  return state;
}

function validateStoredAnnouncement(value) {
  const required = ['id', 'title', 'content', 'enabled', 'startsAt', 'endsAt', 'priority', 'displayPolicy', 'revision', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy'];
  assertStoredKeys(value, required, 'announcements.json 公告字段无效');
  normalizeId(value.id, 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
  if (!cleanSingleLine(value.title, 100) || cleanSingleLine(value.title, 100) !== value.title) throw new Error('announcements.json 公告标题无效');
  if (!cleanMultiline(value.content, 20_000) || cleanMultiline(value.content, 20_000) !== value.content) throw new Error('announcements.json 公告正文无效');
  if (typeof value.enabled !== 'boolean') throw new Error('announcements.json 公告启用状态无效');
  if (value.startsAt !== null) strictStoredIso(value.startsAt, 'announcements.json 公告开始时间无效');
  if (value.endsAt !== null) strictStoredIso(value.endsAt, 'announcements.json 公告结束时间无效');
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) throw new Error('announcements.json 公告有效期无效');
  if (!Number.isSafeInteger(value.priority) || value.priority < -10_000 || value.priority > 10_000) throw new Error('announcements.json 公告优先级无效');
  if (!DISPLAY_POLICIES.has(value.displayPolicy)) throw new Error('announcements.json 公告展示策略无效');
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('announcements.json 公告版本无效');
  strictStoredIso(value.createdAt, 'announcements.json 公告创建时间无效');
  strictStoredIso(value.updatedAt, 'announcements.json 公告更新时间无效');
  if (!cleanSingleLine(value.updatedBy, 100)) throw new Error('announcements.json 公告更新人无效');
  if (value.deletedAt !== null) strictStoredIso(value.deletedAt, 'announcements.json 公告删除时间无效');
  if (value.deletedAt && !cleanSingleLine(value.deletedBy, 100)) throw new Error('announcements.json 公告删除人无效');
  if (!value.deletedAt && value.deletedBy !== null) throw new Error('announcements.json 公告删除状态无效');
}

function validateStoredTutorial(value) {
  const required = ['id', 'title', 'enabled', 'version', 'steps', 'createdAt', 'updatedAt', 'updatedBy'];
  assertStoredKeys(value, required, 'onboarding-tutorial.json 教程字段无效');
  normalizeId(value.id, 'TUTORIAL_ID_INVALID', '教程编号无效');
  if (!cleanSingleLine(value.title, 100) || cleanSingleLine(value.title, 100) !== value.title) throw new Error('onboarding-tutorial.json 教程标题无效');
  if (typeof value.enabled !== 'boolean') throw new Error('onboarding-tutorial.json 教程启用状态无效');
  if (!Number.isSafeInteger(value.version) || value.version < 0) throw new Error('onboarding-tutorial.json 教程版本无效');
  if (!Array.isArray(value.steps) || value.steps.length > MAX_TUTORIAL_STEPS) throw new Error('onboarding-tutorial.json 教程步骤无效');
  value.steps.forEach((step, index) => {
    assertStoredKeys(step, ['id', 'title', 'content', 'order'], 'onboarding-tutorial.json 教程步骤字段无效');
    normalizeTutorialStep(step, { fallbackId: step.id, fallbackOrder: index + 1 });
    if (step.order !== index + 1) throw new Error('onboarding-tutorial.json 教程步骤顺序无效');
  });
  if (new Set(value.steps.map((step) => step.id)).size !== value.steps.length) throw new Error('onboarding-tutorial.json 教程步骤编号重复');
  if (value.enabled && value.steps.length === 0) throw new Error('onboarding-tutorial.json 启用教程缺少步骤');
  if ((value.createdAt === null) !== (value.updatedAt === null)) throw new Error('onboarding-tutorial.json 教程时间状态无效');
  if (value.createdAt !== null) strictStoredIso(value.createdAt, 'onboarding-tutorial.json 教程创建时间无效');
  if (value.updatedAt !== null) strictStoredIso(value.updatedAt, 'onboarding-tutorial.json 教程更新时间无效');
}

function validateProgressRecord(record) {
  assertStoredKeys(record, ['userId', 'announcementReceipts', 'tutorialProgress', 'createdAt', 'updatedAt'], 'content-progress.json 用户进度字段无效');
  normalizeUserId(record.userId);
  if (!Array.isArray(record.announcementReceipts)) throw new Error('content-progress.json 公告确认记录无效');
  const receiptKeys = new Set();
  for (const receipt of record.announcementReceipts) {
    assertStoredKeys(receipt, ['announcementId', 'revision', 'acknowledgedAt'], 'content-progress.json 公告确认字段无效');
    normalizeId(receipt.announcementId, 'ANNOUNCEMENT_ID_INVALID', '公告编号无效');
    if (!Number.isSafeInteger(receipt.revision) || receipt.revision < 1) throw new Error('content-progress.json 公告确认版本无效');
    strictStoredIso(receipt.acknowledgedAt, 'content-progress.json 公告确认时间无效');
    const key = `${receipt.announcementId}:${receipt.revision}`;
    if (receiptKeys.has(key)) throw new Error('content-progress.json 包含重复公告确认记录');
    receiptKeys.add(key);
  }
  if (record.tutorialProgress !== null) {
    const progress = record.tutorialProgress;
    assertStoredKeys(progress, ['tutorialId', 'version', 'status', 'currentStepId', 'updatedAt'], 'content-progress.json 教程进度字段无效');
    normalizeId(progress.tutorialId, 'TUTORIAL_ID_INVALID', '教程编号无效');
    if (!Number.isSafeInteger(progress.version) || progress.version < 1) throw new Error('content-progress.json 教程版本无效');
    if (!TUTORIAL_STATUSES.has(progress.status)) throw new Error('content-progress.json 教程状态无效');
    if (progress.currentStepId !== null) normalizeId(progress.currentStepId, 'TUTORIAL_STEP_ID_INVALID', '教程步骤编号无效');
    if (progress.status === 'active' && !progress.currentStepId) throw new Error('content-progress.json 进行中教程缺少步骤');
    strictStoredIso(progress.updatedAt, 'content-progress.json 教程进度时间无效');
  }
  strictStoredIso(record.createdAt, 'content-progress.json 用户进度创建时间无效');
  strictStoredIso(record.updatedAt, 'content-progress.json 用户进度更新时间无效');
}

function publicAdminAnnouncement(announcement) {
  return structuredClone(announcement);
}

function publicAnnouncement(announcement) {
  return {
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    priority: announcement.priority,
    displayPolicy: announcement.displayPolicy,
    revision: announcement.revision,
    startsAt: announcement.startsAt,
    endsAt: announcement.endsAt,
    updatedAt: announcement.updatedAt,
  };
}

function publicAdminTutorial(tutorial) {
  return structuredClone(tutorial);
}

function publicTutorialForUser(tutorial, progress) {
  if (!tutorial.enabled || tutorial.steps.length === 0 || tutorial.version < 1) return null;
  const progressIsCurrent = progress?.tutorialId === tutorial.id && progress.version === tutorial.version;
  if (progressIsCurrent && ['completed', 'skipped'].includes(progress.status)) return null;
  const currentStepId = progressIsCurrent && progress.status === 'active'
    && tutorial.steps.some((step) => step.id === progress.currentStepId)
    ? progress.currentStepId
    : tutorial.steps[0].id;
  return {
    id: tutorial.id,
    title: tutorial.title,
    enabled: true,
    version: tutorial.version,
    steps: structuredClone(tutorial.steps),
    progress: {
      status: progressIsCurrent ? progress.status : 'not_started',
      currentStepId,
    },
  };
}

function isAnnouncementActive(announcement, at) {
  if (!announcement.enabled || announcement.deletedAt) return false;
  const timestamp = at.getTime();
  if (announcement.startsAt && timestamp < new Date(announcement.startsAt).getTime()) return false;
  if (announcement.endsAt && timestamp >= new Date(announcement.endsAt).getTime()) return false;
  return true;
}

function shouldDisplayAnnouncement(announcement, receipts) {
  if (announcement.displayPolicy === 'every_login') return true;
  const matching = receipts.filter((receipt) => receipt.announcementId === announcement.id);
  if (announcement.displayPolicy === 'once_per_user') return matching.length === 0;
  return !matching.some((receipt) => receipt.revision === announcement.revision);
}

function compareAnnouncementsForAdmin(left, right) {
  return Number(Boolean(left.deletedAt)) - Number(Boolean(right.deletedAt))
    || right.priority - left.priority
    || right.updatedAt.localeCompare(left.updatedAt);
}

function compareAnnouncementsForDisplay(left, right) {
  return right.priority - left.priority || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function sameTutorialDefinition(left, right) {
  return JSON.stringify({ title: left.title, enabled: left.enabled, steps: left.steps })
    === JSON.stringify({ title: right.title, enabled: right.enabled, steps: right.steps });
}

function getOrCreateProgressRecord(state, userId, timestamp) {
  let record = state.records.find((item) => item.userId === userId);
  if (record) return record;
  record = {
    userId,
    announcementReceipts: [],
    tutorialProgress: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.records.push(record);
  return record;
}

function renumberSteps(steps) {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

function writeState(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function readJson(filename, label) {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`${label}无法读取：${error.message}`);
  }
}

function assertObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contentError(400, code, message);
}

function assertAllowedFields(value, allowed, code, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw contentError(400, code, `${label}包含不支持的字段：${unknown.join('、')}`);
}

function assertStoredKeys(value, required, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  const expected = new Set(required);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) throw new Error(message);
}

function assertExpectedUpdatedAt(expected, current, code, label) {
  if (expected !== undefined && expected !== null && expected !== current) {
    throw contentError(409, code, `${label}已被其他管理员修改，请刷新后重试`);
  }
}

function normalizeId(value, code, message) {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_.:-]{2,120}$/.test(id)) throw contentError(400, code, message);
  return id;
}

function normalizeUserId(value) {
  return normalizeId(value, 'CONTENT_USER_ID_INVALID', '用户编号无效');
}

function normalizeActor(value) {
  return cleanSingleLine(value, 100) || 'admin';
}

function cleanSingleLine(value, maximum) {
  return String(value ?? '').replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function cleanMultiline(value, maximum) {
  return String(value ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function strictBoolean(value, code, label) {
  if (typeof value !== 'boolean') throw contentError(422, code, `${label}必须是布尔值`);
  return value;
}

function boundedInteger(value, minimum, maximum, code, message) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw contentError(422, code, message);
  return number;
}

function optionalIso(value, code, message) {
  if (value === null || value === '') return null;
  const date = toDate(value, message, code);
  return date.toISOString();
}

function strictStoredIso(value, message) {
  if (typeof value !== 'string' || toDate(value, message).toISOString() !== value) throw new Error(message);
}

function isoNow(now) {
  return toDate(now(), '系统时间无效').toISOString();
}

function toDate(value, message, code = null) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    if (code) throw contentError(422, code, message);
    throw new Error(message);
  }
  return date;
}

function omit(value, fields) {
  const omitted = new Set(fields);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

function contentError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

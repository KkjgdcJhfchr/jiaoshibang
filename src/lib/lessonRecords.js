import { normalizeLesson } from './lessonAdapter.js';
import { toCanonicalLesson } from './trainingAdapter.js';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

export function lessonIdFromPath(path = '') {
  const value = String(path);
  const lessonMatch = value.match(/^\/app\/lesson\/([^/]+)(?:\/knowledge)?$/);
  const paperMatch = value.match(/^\/app\/papers\/([^/]+)$/);
  const encodedId = lessonMatch?.[1] || paperMatch?.[1] || '';
  return encodedId ? decodeURIComponent(encodedId) : '';
}

export function lessonListFromResponse(response) {
  const data = object(response?.data);
  const items = data.lessons ?? data.items ?? response?.lessons ?? response?.items;
  return array(items);
}

export function lessonRecordFromResponse(response) {
  const data = object(response?.data);
  return object(data.lesson ?? data.record ?? response?.lesson ?? response?.record);
}

export function lessonPlanFromRecord(record) {
  const item = object(record);
  return object(item.lessonPlan ?? item.lesson_plan ?? item.plan);
}

export function hydrateLessonRecord(record) {
  const item = object(record);
  const canonical = lessonPlanFromRecord(item);
  if (!Object.keys(canonical).length) return null;
  const normalized = normalizeLesson(canonical);
  return {
    ...normalized,
    id: String(item.id || normalized.id || ''),
    source_files: array(item.sourceFiles ?? item.source_files),
    custom_sections: array(item.customSections ?? item.custom_sections),
    section_order: array(item.sectionOrder ?? item.section_order),
    section_titles: object(item.sectionTitles ?? item.section_titles),
    created_at: item.createdAt ?? item.created_at ?? '',
    updated_at: item.updatedAt ?? item.updated_at ?? normalized.updated_at ?? '',
  };
}

export function serializeLessonRecord(lesson, canonicalSource = null) {
  const editor = object(lesson);
  const lessonPlan = toCanonicalLesson(editor, canonicalSource);
  return {
    lessonPlan,
    sourceFiles: array(editor.source_files),
    customSections: array(editor.custom_sections),
    sectionOrder: array(editor.section_order),
    sectionTitles: object(editor.section_titles),
    title: lessonPlan.metadata.lessonTitle,
    subject: lessonPlan.metadata.subject,
    grade: lessonPlan.metadata.grade,
  };
}

export function lessonSummary(record) {
  const item = object(record);
  const canonical = lessonPlanFromRecord(item);
  const metadata = object(canonical.metadata);
  const title = String(item.title || metadata.lessonTitle || metadata.chapterTitle || '未命名教案');
  const subject = String(item.subject || metadata.subject || '学科待确认');
  const grade = String(item.grade || metadata.grade || '年级待确认');
  return {
    id: String(item.id || ''),
    title,
    meta: `${subject} · ${grade}`,
    duration: Number(item.durationMinutes ?? item.duration_minutes ?? metadata.durationMinutes ?? 45),
    exerciseCount: Number(item.exerciseCount ?? item.exercise_count ?? array(canonical.exercises).length),
    updated: formatLessonUpdatedAt(item.updatedAt ?? item.updated_at),
    status: String(item.status || '已完成'),
  };
}

export function formatLessonUpdatedAt(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '刚刚';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const LEGACY_LESSON_KEYS = [
  'current-lesson',
  'current-lesson-canonical',
  'current-lesson-rights-confirmed',
  'teacher-helper.lesson-library.v2',
];

function clearLegacyLessonStorage(storage) {
  for (const key of LEGACY_LESSON_KEYS) storage.removeItem(key);
}

export async function migrateLegacyLessonToServer(
  apiClient,
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
  ownerRef = '',
) {
  if (!storage?.getItem || !apiClient?.createLesson) return false;
  let editorLesson;
  let canonical;
  try {
    editorLesson = JSON.parse(storage.getItem('current-lesson') || 'null');
    canonical = JSON.parse(storage.getItem('current-lesson-canonical') || 'null');
  } catch {
    clearLegacyLessonStorage(storage);
    return false;
  }
  if (!editorLesson || typeof editorLesson !== 'object') return false;
  if (String(editorLesson.id || '') === 'lesson-spring-001') {
    clearLegacyLessonStorage(storage);
    return false;
  }

  let generationState = null;
  try { generationState = JSON.parse(sessionStorage?.getItem?.('teacher-helper.generation-job.v1') || 'null'); } catch {}
  const legacyOwnerRef = String(
    editorLesson.ownerRef
      || editorLesson.owner_ref
      || (generationState?.deliveredLessonId === editorLesson.id ? generationState.ownerRef : '')
      || '',
  );
  if (!ownerRef || !legacyOwnerRef || legacyOwnerRef !== String(ownerRef)) return false;

  const payload = serializeLessonRecord(editorLesson, canonical);
  const legacyId = String(editorLesson.id || '');
  if (/^lesson-[A-Za-z0-9._~-]{1,200}$/.test(legacyId)) payload.id = legacyId;
  await apiClient.createLesson(payload);
  clearLegacyLessonStorage(storage);
  return true;
}

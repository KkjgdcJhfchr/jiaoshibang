import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydrateLessonRecord,
  lessonIdFromPath,
  lessonListFromResponse,
  lessonRecordFromResponse,
  lessonSummary,
  migrateLegacyLessonToServer,
  serializeLessonRecord,
} from './lessonRecords.js';

const canonical = {
  schemaVersion: 'lesson-plan.v1',
  metadata: {
    subject: '数学', grade: '八年级', textbookEdition: '人教版', chapterTitle: '勾股定理',
    lessonTitle: '勾股定理教学设计', durationMinutes: 45, classProfile: '', language: 'zh-CN',
  },
  sourceSummary: '教材内容', coreCompetencies: ['推理能力'],
  learningObjectives: [{ type: 'knowledge', content: '掌握定理', measurableEvidence: '完成证明', sourceRefs: [] }],
  learnerAnalysis: { currentKnowledge: '', commonMisconceptions: [], learningNeeds: [], classCharacteristics: '' },
  keyPoints: ['定理'], difficultPoints: ['证明'], preparation: { teacher: [], students: [], materials: [] },
  timeline: [{ id: 'stage-1', startMinute: 0, durationMinutes: 45, stage: '新授', engagementGoal: '参与', teacherActions: ['讲解'], teacherScript: '讲解', studentActions: ['学习'], questions: [], expectedResponses: [], misconceptions: [], fallbackStrategy: '调整', formativeAssessment: '观察', sourceRefs: [] }],
  differentiation: { support: [], standard: [], challenge: [] },
  assessmentPlan: { diagnostic: [], formative: [], summative: [], successCriteria: ['掌握'] },
  exercises: Array.from({ length: 10 }, (_, index) => ({ id: `q${index + 1}`, type: 'calculation', difficulty: 2, knowledgePoints: ['定理'], stem: `题目${index + 1}`, answer: '答案', explanation: '解析', scoringRubric: '', estimatedMinutes: 3, sourceRefs: [] })),
  homework: [], boardDesign: { layoutDescription: '', sections: [] }, safetyAndInclusion: [], reflectionPrompts: [],
  generationMeta: { generatedBy: 'mixed', promptVersion: 'v1', modelRouteId: 'route', generatedAt: '2026-08-05T00:00:00.000Z' },
};

test('lesson response helpers only use server records', () => {
  const record = { id: 'lesson-math-1', lessonPlan: canonical };
  assert.deepEqual(lessonListFromResponse({ data: { lessons: [record] } }), [record]);
  assert.equal(lessonRecordFromResponse({ data: { lesson: record } }), record);
  assert.equal(lessonIdFromPath('/app/lesson/lesson-math-1'), 'lesson-math-1');
  assert.equal(lessonIdFromPath('/app/lesson/lesson-math-1/knowledge'), 'lesson-math-1');
  assert.equal(lessonIdFromPath('/app/papers/lesson-math-1'), 'lesson-math-1');
  assert.equal(lessonIdFromPath('/app/knowledge'), '');
});

test('hydrate and serialize keep per-user record metadata without demo fallbacks', () => {
  const hydrated = hydrateLessonRecord({
    id: 'lesson-math-1',
    lessonPlan: canonical,
    customSections: [{ id: 'custom-1', title: '拓展', content: '内容' }],
    sectionOrder: ['objectives', 'custom:custom-1'],
    sectionTitles: { objectives: '本课目标' },
  });
  assert.equal(hydrated.id, 'lesson-math-1');
  assert.equal(hydrated.metadata.subject, '数学');
  assert.equal(hydrated.metadata.chapter, '勾股定理');
  assert.equal(hydrated.custom_sections[0].title, '拓展');
  assert.deepEqual(hydrated.section_order, ['objectives', 'custom:custom-1']);

  const payload = serializeLessonRecord(hydrated, canonical);
  assert.equal(payload.lessonPlan.metadata.subject, '数学');
  assert.equal(payload.lessonPlan.metadata.chapterTitle, '勾股定理');
  assert.deepEqual(payload.sourceFiles, hydrated.source_files);
  assert.deepEqual(payload.customSections, hydrated.custom_sections);
  assert.deepEqual(payload.sectionOrder, hydrated.section_order);
  assert.deepEqual(payload.sectionTitles, hydrated.section_titles);
});

test('new accounts with no records remain empty', () => {
  assert.deepEqual(lessonListFromResponse({ data: { lessons: [] } }), []);
  assert.equal(hydrateLessonRecord({}), null);
});

test('lesson summary derives from real server record', () => {
  const summary = lessonSummary({ id: 'lesson-math-1', lessonPlan: canonical, updatedAt: '2026-08-05T12:00:00.000Z' });
  assert.equal(summary.id, 'lesson-math-1');
  assert.equal(summary.title, '勾股定理教学设计');
  assert.equal(summary.meta, '数学 · 八年级');
  assert.equal(summary.exerciseCount, 10);
});

test('one-time migration uploads a real legacy lesson before deleting browser keys', async () => {
  const values = new Map([
    ['current-lesson', JSON.stringify({ ...hydrateLessonRecord({ id: 'lesson-math-1', lessonPlan: canonical }), id: 'lesson-math-1' })],
    ['current-lesson-canonical', JSON.stringify(canonical)],
    ['teacher-helper.lesson-library.v2', JSON.stringify([{ id: 'lesson-math-1' }])],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
  const session = { getItem: () => JSON.stringify({ ownerRef: 'user-1', deliveredLessonId: 'lesson-math-1' }) };
  const calls = [];
  const migrated = await migrateLegacyLessonToServer({ createLesson: async (body) => { calls.push(body); } }, storage, session, 'user-1');
  assert.equal(migrated, true);
  assert.equal(calls[0].id, 'lesson-math-1');
  assert.equal(calls[0].lessonPlan.metadata.subject, '数学');
  assert.equal(values.has('current-lesson'), false);
  assert.equal(values.has('teacher-helper.lesson-library.v2'), false);
});

test('legacy lesson is never copied into a different account', async () => {
  const values = new Map([['current-lesson', JSON.stringify({ id: 'lesson-math-1', metadata: { subject: '数学' } })]]);
  const storage = { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
  const session = { getItem: () => JSON.stringify({ ownerRef: 'user-1', deliveredLessonId: 'lesson-math-1' }) };
  let called = false;
  const migrated = await migrateLegacyLessonToServer({ createLesson: async () => { called = true; } }, storage, session, 'user-2');
  assert.equal(migrated, false);
  assert.equal(called, false);
  assert.equal(values.has('current-lesson'), true, '另一账号登录时不得删除原账号的旧教案');
});

test('bundled spring demo is deleted instead of migrated', async () => {
  const values = new Map([['current-lesson', JSON.stringify({ id: 'lesson-spring-001' })]]);
  const storage = { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
  let called = false;
  const migrated = await migrateLegacyLessonToServer({ createLesson: async () => { called = true; } }, storage);
  assert.equal(migrated, false);
  assert.equal(called, false);
  assert.equal(values.has('current-lesson'), false);
});

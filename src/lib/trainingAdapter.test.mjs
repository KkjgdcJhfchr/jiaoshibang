import assert from 'node:assert/strict';
import { buildTrainingCandidate } from '../../server/training-candidate.mjs';
import { validateLessonPlan } from '../../server/lesson-schema.mjs';
import { normalizeLesson } from './lessonAdapter.js';
import { toCanonicalLesson } from './trainingAdapter.js';

const sourceLesson = buildCanonicalLesson();
const editedLesson = normalizeLesson(sourceLesson);

editedLesson.metadata.title = '人工修改后的完整教案';
editedLesson.metadata.class_profile = '人工修改学情：学生喜欢合作探究。';
editedLesson.source_summary = '人工修改后的章节内容概述';
editedLesson.core_competencies[0] = '人工修改后的核心素养';
editedLesson.learning_objectives[0].content = '人工修改目标：能够用证据解释文本。';
editedLesson.learning_objectives[0].measurable_evidence = '人工修改后的目标达成证据';
editedLesson.learner_analysis.known = '人工修改的已有基础';
editedLesson.learner_analysis.challenge = '人工修改的常见误区';
editedLesson.learner_analysis.strategy = '人工修改的学习支架';
editedLesson.learner_analysis.class_characteristics = '人工修改的班级学习特征';
editedLesson.key_points[0] = '人工修改教学重点';
editedLesson.difficult_points[0] = '人工修改教学难点';
editedLesson.preparation.teacher[0] = '人工修改教师准备';
editedLesson.preparation.students[0] = '人工修改学生准备';
editedLesson.preparation.materials[0] = '人工修改课堂材料';
editedLesson.timeline[0] = {
  ...editedLesson.timeline[0],
  stage: '人工修改教学环节',
  engagement_goal: '人工修改参与目标',
  teacher_actions: ['人工修改教师活动'],
  teacher_script: '人工修改的完整讲解话术',
  student_actions: ['人工修改学生活动'],
  questions: ['人工修改的核心问题？'],
  question_details: [{
    prompt: '旧问题',
    purpose: '人工修改提问目的',
    expected_response: '人工修改预期回答',
    follow_up: '人工修改追问',
    source_refs: [],
  }],
  expected_responses: ['人工修改环节预期回应'],
  misconceptions: ['人工修改环节误区'],
  fallback_strategy: '人工修改备用策略',
  formative_assessment: '人工修改形成性评价',
};
editedLesson.differentiation = {
  support: ['人工修改基础支持'],
  standard: ['人工修改常规任务'],
  challenge: ['人工修改拓展挑战'],
};
editedLesson.assessment_plan = {
  diagnostic: ['人工修改诊断评价'],
  formative: ['人工修改过程评价'],
  summative: ['人工修改总结评价'],
  success_criteria: ['人工修改成功标准'],
};
editedLesson.board_design = '人工修改板书：主题—证据—结论';
editedLesson.homework[0] = {
  ...editedLesson.homework[0],
  level: '人工修改必做',
  content: '人工修改课后作业',
  estimated_minutes: 25,
  answer_guidance: '人工修改作业指导',
};
editedLesson.exercises[0] = {
  ...editedLesson.exercises[0],
  type: '简答题',
  knowledge_points: ['人工修改知识点'],
  stem: '人工修改第一题',
  answer: '人工修改答案',
  explanation: '人工修改解析',
  scoring_rubric: '人工修改评分标准',
  estimated_minutes: 8,
};
editedLesson.exercises[9].stem = '人工修改第十题';
editedLesson.safety_and_inclusion = ['人工修改课堂安全与包容提示'];
editedLesson.reflection_prompts = ['人工修改课后反思问题'];
editedLesson.custom_sections = [
  { id: 'custom-cross', title: '跨学科拓展', content: '人工新增的跨学科完整内容。' },
  { id: 'custom-local', title: '乡土素材', content: '人工新增的乡土教学任务。' },
];

const canonical = toCanonicalLesson(editedLesson, sourceLesson);
assert.equal(validateLessonPlan(canonical, 45), null, '转换后必须通过后端教案校验');
assert.equal(Object.hasOwn(canonical, 'custom_sections'), false, '不得向严格 canonical schema 注入额外字段');
assert.equal(canonical.metadata.lessonTitle, '人工修改后的完整教案');
assert.equal(canonical.metadata.classProfile, '人工修改学情：学生喜欢合作探究。');
assert.equal(canonical.sourceSummary, '人工修改后的章节内容概述');
assert.deepEqual(canonical.coreCompetencies, ['人工修改后的核心素养']);
assert.equal(canonical.learningObjectives[0].content, '人工修改目标：能够用证据解释文本。');
assert.equal(canonical.learningObjectives[0].measurableEvidence, '人工修改后的目标达成证据');
assert.deepEqual(canonical.learnerAnalysis.commonMisconceptions, ['人工修改的常见误区']);
assert.equal(canonical.learnerAnalysis.classCharacteristics, '人工修改的班级学习特征');
assert.deepEqual(canonical.keyPoints, ['人工修改教学重点']);
assert.deepEqual(canonical.difficultPoints, ['人工修改教学难点']);
assert.deepEqual(canonical.preparation.teacher, ['人工修改教师准备']);
assert.equal(canonical.timeline[0].teacherScript, '人工修改的完整讲解话术');
assert.equal(canonical.timeline[0].questions[0].prompt, '人工修改的核心问题？');
assert.equal(canonical.timeline[0].questions[0].expectedResponse, '人工修改预期回答');
assert.deepEqual(canonical.differentiation.challenge, ['人工修改拓展挑战']);
assert.deepEqual(canonical.assessmentPlan.successCriteria, ['人工修改成功标准']);
assert.equal(canonical.boardDesign.sections[0].content, '人工修改板书：主题—证据—结论');
assert.equal(canonical.homework[0].description, '人工修改课后作业');
assert.equal(canonical.homework[0].estimatedMinutes, 25);
assert.equal(canonical.homework[0].answerGuidance, '人工修改作业指导');
assert.equal(canonical.exercises[0].type, 'short_answer');
assert.equal(canonical.exercises[0].stem, '人工修改第一题');
assert.equal(canonical.exercises[0].scoringRubric, '人工修改评分标准');
assert.equal(canonical.exercises[0].estimatedMinutes, 8);
assert.equal(canonical.exercises[9].stem, '人工修改第十题');
assert.deepEqual(canonical.safetyAndInclusion, ['人工修改课堂安全与包容提示']);
assert.equal(canonical.reflectionPrompts.includes('人工修改课后反思问题'), true);
assert.equal(canonical.reflectionPrompts.some((item) => item.includes('跨学科拓展') && item.includes('人工新增的跨学科完整内容')), true);
assert.equal(canonical.reflectionPrompts.some((item) => item.includes('乡土素材') && item.includes('人工新增的乡土教学任务')), true);
assert.equal(canonical.generationMeta.generatedBy, 'mixed');

const revisionCanonical = toCanonicalLesson({ ...editedLesson, custom_sections: [] }, sourceLesson);
assert.equal(
  revisionCanonical.reflectionPrompts.some((item) => item.startsWith('【教师自定义模块】')),
  false,
  '定向修改的 canonical 上下文不得把自定义模块混入课后反思',
);
assert.deepEqual(
  editedLesson.custom_sections.map(({ id, title, content }) => ({ id, title, content })),
  [
    { id: 'custom-cross', title: '跨学科拓展', content: '人工新增的跨学科完整内容。' },
    { id: 'custom-local', title: '乡土素材', content: '人工新增的乡土教学任务。' },
  ],
  '剥离 revision 上下文标记时不得改动独立保存的自定义模块',
);

const candidate = buildTrainingCandidate({
  user: { id: 'training-adapter-test-user' },
  lessonPlan: canonical,
  consentAt: '2026-08-04T00:00:00.000Z',
  rightsConfirmed: true,
  privacySalt: 'training-adapter-test-salt'.padEnd(64, 'x'),
});
const submittedTarget = candidate.sample.payload.targetLessonPlan;
assert.equal(submittedTarget.timeline[0].teacherScript, '人工修改的完整讲解话术');
assert.equal(submittedTarget.exercises[0].stem, '人工修改第一题');
assert.equal(submittedTarget.boardDesign.sections[0].content, '人工修改板书：主题—证据—结论');
assert.equal(submittedTarget.reflectionPrompts.some((item) => item.includes('跨学科拓展')), true, '自定义模块必须进入提交样本');

const withoutSource = toCanonicalLesson(editedLesson);
assert.equal(validateLessonPlan(withoutSource, 45), null, '没有原始 canonical 快照时也必须生成可提交教案');
assert.equal(withoutSource.timeline[0].teacherScript, '人工修改的完整讲解话术');
assert.equal(withoutSource.exercises.length, 10);

console.log(JSON.stringify({
  ok: true,
  checks: {
    completeManualEditsPreserved: true,
    strictLessonValidation: true,
    customSectionsSafelyEncoded: true,
    submittedTrainingTargetContainsEdits: true,
    sourceSnapshotOptional: true,
  },
}));

function buildCanonicalLesson() {
  return {
    schemaVersion: 'lesson-plan.v1',
    metadata: {
      subject: '语文',
      grade: '七年级',
      textbookEdition: '统编版',
      chapterTitle: '测试章节',
      lessonTitle: '原始教案',
      durationMinutes: 45,
      classProfile: '原始学情',
      language: 'zh-CN',
    },
    sourceSummary: '原始章节概述',
    coreCompetencies: ['语言运用'],
    learningObjectives: [{
      type: 'knowledge',
      content: '原始教学目标',
      measurableEvidence: '原始可测量证据',
      sourceRefs: [],
    }],
    learnerAnalysis: {
      currentKnowledge: '原始基础',
      commonMisconceptions: ['原始误区'],
      learningNeeds: ['原始需求'],
      classCharacteristics: '原始班级特点',
    },
    keyPoints: ['原始重点'],
    difficultPoints: ['原始难点'],
    preparation: {
      teacher: ['原始教师准备'],
      students: ['原始学生准备'],
      materials: ['原始材料'],
    },
    timeline: [{
      id: 'stage-1',
      startMinute: 0,
      durationMinutes: 45,
      stage: '原始环节',
      engagementGoal: '原始参与目标',
      teacherActions: ['原始教师活动'],
      teacherScript: '原始教师话术',
      studentActions: ['原始学生活动'],
      questions: [{
        prompt: '原始问题？',
        purpose: '原始目的',
        expectedResponse: '原始回答',
        followUp: '原始追问',
        sourceRefs: [],
      }],
      expectedResponses: ['原始环节回应'],
      misconceptions: ['原始环节误区'],
      fallbackStrategy: '原始备用策略',
      formativeAssessment: '原始形成性评价',
      sourceRefs: [],
    }],
    differentiation: {
      support: ['原始基础支持'],
      standard: ['原始常规任务'],
      challenge: ['原始拓展挑战'],
    },
    assessmentPlan: {
      diagnostic: ['原始诊断评价'],
      formative: ['原始过程评价'],
      summative: ['原始总结评价'],
      successCriteria: ['原始成功标准'],
    },
    exercises: Array.from({ length: 10 }, (_, index) => ({
      id: `exercise-${index + 1}`,
      type: 'single_choice',
      difficulty: 2,
      knowledgePoints: ['原始知识点'],
      stem: `原始习题 ${index + 1}`,
      answer: '原始答案',
      explanation: '原始解析',
      scoringRubric: '',
      estimatedMinutes: 3,
      sourceRefs: [],
    })),
    homework: [{
      id: 'homework-1',
      description: '原始作业',
      purpose: '原始必做',
      estimatedMinutes: 15,
      answerGuidance: '原始指导',
      sourceRefs: [],
    }],
    boardDesign: {
      layoutDescription: '原始板书布局',
      sections: [{ title: '原始板书', content: '原始板书内容', position: '中央' }],
    },
    safetyAndInclusion: ['原始安全建议'],
    reflectionPrompts: ['原始反思问题'],
    generationMeta: {
      generatedBy: 'ai',
      promptVersion: 'lesson-plan.v1',
      modelRouteId: 'test-model',
      generatedAt: '2026-08-04T00:00:00.000Z',
    },
  };
}

import assert from 'node:assert/strict';
import {
  buildLessonExportModel,
  collectLessonExportTexts,
  sanitizeExportFilename,
  validateLessonExportInput,
} from './lesson-export-model.mjs';

const legacyLesson = {
  metadata: {
    title: '哨兵-教案标题',
    subject: '哨兵-学科',
    grade: '哨兵-年级',
    textbook_edition: '哨兵-教材版本',
    chapter: '哨兵-章节',
    duration_minutes: 48,
    class_profile: '哨兵-班级整体情况',
    language: 'zh-CN',
  },
  source_summary: '哨兵-章节概述',
  core_competencies: ['哨兵-核心素养'],
  learning_objectives: [{
    type: 'knowledge',
    content: '哨兵-目标内容',
    measurable_evidence: '哨兵-达成证据',
    source_refs: [{ assetId: 'technical-asset-objective', page: 2, blockIds: ['technical-block-objective'], excerpt: '哨兵-目标教材依据' }],
  }],
  learner_analysis: {
    class_characteristics: '哨兵-班级学习特征',
    known: '哨兵-已有基础',
    challenge: '哨兵-学习挑战',
    strategy: '哨兵-教学策略',
  },
  key_points: ['哨兵-教学重点'],
  difficult_points: ['哨兵-教学难点'],
  preparation: {
    teacher: ['哨兵-教师准备'],
    students: ['哨兵-学生准备'],
    materials: ['哨兵-材料准备'],
  },
  safety_and_inclusion: ['哨兵-安全包容'],
  timeline: [{
    id: 'technical-stage-id',
    start_minute: 3,
    duration_minutes: 12,
    stage: '哨兵-教学环节',
    engagement_goal: '哨兵-参与目标',
    teacher_actions: ['哨兵-教师活动'],
    teacher_script: '哨兵-讲解话术',
    student_actions: ['哨兵-学生活动'],
    question_details: [{
      prompt: '哨兵-结构化提问',
      purpose: '哨兵-提问目的',
      expected_response: '哨兵-提问预期回答',
      follow_up: '哨兵-继续追问',
      source_refs: [{ page: 3, excerpt: '哨兵-提问教材依据' }],
    }],
    questions: ['哨兵-兼容提问'],
    expected_responses: ['哨兵-环节预期回应'],
    misconceptions: ['哨兵-常见误区'],
    formative_assessment: '哨兵-形成性评价',
    fallback_strategy: '哨兵-备用策略',
    source_refs: [{ page: 4, excerpt: '哨兵-环节教材依据', file_name: '哨兵-环节教材文件' }],
  }],
  differentiation: {
    support: ['哨兵-基础支持'],
    standard: ['哨兵-常规任务'],
    challenge: ['哨兵-拓展挑战'],
  },
  assessment_plan: {
    diagnostic: ['哨兵-课前诊断'],
    formative: ['哨兵-过程评价'],
    summative: ['哨兵-总结评价'],
    success_criteria: ['哨兵-达成标准'],
  },
  board_design_structured: {
    layout_description: '哨兵-板书整体布局',
    sections: [{ title: '哨兵-板书区域标题', position: '哨兵-板书位置', content: '哨兵-板书区域内容' }],
  },
  board_design: '哨兵-板书兼容文本',
  homework: [{
    id: 'technical-homework-id',
    level: '哨兵-作业层次',
    content: '哨兵-作业内容',
    estimated_minutes: 8,
    answer_guidance: '哨兵-作业指导',
    source_refs: [{ page: 5, excerpt: '哨兵-作业教材依据' }],
  }],
  reflection_prompts: ['哨兵-反思提示'],
  exercises: [{
    id: 'technical-exercise-id',
    type: 'single_choice',
    difficulty: 4,
    knowledge_points: ['哨兵-习题知识点'],
    stem: '哨兵-题干',
    options: ['哨兵-选项甲', { label: 'B', content: '哨兵-选项乙' }],
    answer: '哨兵-答案',
    explanation: '哨兵-解析',
    scoring_rubric: '哨兵-评分标准',
    estimated_minutes: 6,
    source_refs: [{ page: 6, excerpt: '哨兵-习题教材依据', title: '哨兵-习题教材标题' }],
  }],
  custom_sections: [
    { id: 'z', title: '哨兵-自定义模块甲', content: '哨兵-自定义内容甲' },
    { id: 'y', title: '哨兵-自定义模块乙', content: '哨兵-自定义内容乙' },
  ],
  section_titles: {
    objectives: '哨兵-改名后的教学目标',
    'custom:z': '哨兵-改名后的自定义模块甲',
  },
  section_order: ['exercises', 'custom:z', 'objectives', 'custom:z', 'missing-section'],
};

const model = buildLessonExportModel(legacyLesson);
assert.equal(model.title, '哨兵-教案标题');
assert.deepEqual(
  model.sections.map((section) => section.key),
  ['exercises', 'custom:z', 'objectives', 'learner', 'keypoints', 'preparation', 'timeline', 'interaction', 'board', 'homework', 'custom:y'],
  '保存的有效顺序应优先，重复和未知模块应忽略，其余模块按稳定默认顺序补齐',
);
assert.equal(model.sections.find((section) => section.key === 'objectives').title, '哨兵-改名后的教学目标');
assert.equal(model.sections.find((section) => section.key === 'custom:z').title, '哨兵-改名后的自定义模块甲');
assert.equal(model.sections.find((section) => section.key === 'custom:y').title, '哨兵-自定义模块乙');

const timeline = model.sections.find((section) => section.kind === 'timeline').data.stages[0];
assert.equal(timeline.questionDetails[0].prompt, '哨兵-结构化提问');
assert.deepEqual(timeline.questions, ['哨兵-兼容提问'], '结构化提问和 legacy 字符串提问都必须保留');
const board = model.sections.find((section) => section.kind === 'board').data;
assert.equal(board.structured.sections[0].content, '哨兵-板书区域内容');
assert.equal(board.fallback, '哨兵-板书兼容文本');

const visibleTexts = collectLessonExportTexts(model);
const requiredSentinels = [
  '哨兵-教案标题', '哨兵-学科', '哨兵-年级', '哨兵-教材版本', '哨兵-章节', '哨兵-班级整体情况',
  '哨兵-章节概述', '哨兵-核心素养', '知识目标', '哨兵-目标内容', '哨兵-达成证据', '哨兵-目标教材依据',
  '哨兵-班级学习特征', '哨兵-已有基础', '哨兵-学习挑战', '哨兵-教学策略',
  '哨兵-教学重点', '哨兵-教学难点', '哨兵-教师准备', '哨兵-学生准备', '哨兵-材料准备', '哨兵-安全包容',
  '哨兵-教学环节', '哨兵-参与目标', '哨兵-教师活动', '哨兵-讲解话术', '哨兵-学生活动',
  '哨兵-结构化提问', '哨兵-提问目的', '哨兵-提问预期回答', '哨兵-继续追问', '哨兵-提问教材依据',
  '哨兵-兼容提问', '哨兵-环节预期回应', '哨兵-常见误区', '哨兵-形成性评价', '哨兵-备用策略',
  '哨兵-环节教材依据', '哨兵-环节教材文件', '哨兵-基础支持', '哨兵-常规任务', '哨兵-拓展挑战',
  '哨兵-课前诊断', '哨兵-过程评价', '哨兵-总结评价', '哨兵-达成标准',
  '哨兵-板书整体布局', '哨兵-板书区域标题', '哨兵-板书位置', '哨兵-板书区域内容', '哨兵-板书兼容文本',
  '哨兵-作业层次', '哨兵-作业内容', '哨兵-作业指导', '哨兵-作业教材依据', '哨兵-反思提示',
  '单项选择题', '哨兵-习题知识点', '哨兵-题干', '哨兵-选项甲', 'B 哨兵-选项乙', '哨兵-答案', '哨兵-解析',
  '哨兵-评分标准', '哨兵-习题教材依据', '哨兵-习题教材标题',
  '哨兵-改名后的教学目标', '哨兵-改名后的自定义模块甲', '哨兵-自定义内容甲',
  '哨兵-自定义模块乙', '哨兵-自定义内容乙',
];
for (const sentinel of requiredSentinels) {
  assert.ok(visibleTexts.includes(sentinel), `导出文本遗漏：${sentinel}`);
}
assert.equal(visibleTexts.includes('technical-stage-id'), false, '内部 ID 不应导出为用户可见正文');
assert.equal(visibleTexts.includes('single_choice'), false, '英文题型代码不应泄露到中文导出正文');
assert.equal(visibleTexts.some((text) => /^\s*\d+[.、]?\s*$/.test(text)), false, '模型不得生成只有序号没有内容的空编号');

const canonical = buildLessonExportModel({
  schemaVersion: 'lesson-plan.v1',
  metadata: {
    lessonTitle: 'Canonical 标题', subject: 'Canonical 学科', grade: 'Canonical 年级', textbookEdition: 'Canonical 版本',
    chapterTitle: 'Canonical 章节', durationMinutes: 40, classProfile: 'Canonical 班情', language: 'zh-CN',
  },
  sourceSummary: 'Canonical 概述',
  coreCompetencies: ['Canonical 素养'],
  learningObjectives: [{ type: 'skill', content: 'Canonical 目标', measurableEvidence: 'Canonical 证据', sourceRefs: [] }],
  learnerAnalysis: { currentKnowledge: 'Canonical 基础', commonMisconceptions: ['Canonical 误区'], learningNeeds: ['Canonical 需求'], classCharacteristics: 'Canonical 特征' },
  keyPoints: ['Canonical 重点'], difficultPoints: ['Canonical 难点'],
  preparation: { teacher: ['Canonical 教师准备'], students: [], materials: [] },
  safetyAndInclusion: ['Canonical 安全'],
  timeline: [{
    id: 'canonical-stage', startMinute: 0, durationMinutes: 40, stage: 'Canonical 环节', engagementGoal: 'Canonical 参与',
    teacherActions: ['Canonical 教师活动'], teacherScript: 'Canonical 话术', studentActions: ['Canonical 学生活动'],
    questions: [{ prompt: 'Canonical 提问', purpose: 'Canonical 目的', expectedResponse: 'Canonical 回答', followUp: 'Canonical 追问', sourceRefs: [] }],
    expectedResponses: ['Canonical 响应'], misconceptions: ['Canonical 易错'], fallbackStrategy: 'Canonical 备用', formativeAssessment: 'Canonical 评价', sourceRefs: [],
  }],
  differentiation: { support: [], standard: [], challenge: [] },
  assessmentPlan: { diagnostic: [], formative: [], summative: [], successCriteria: ['Canonical 标准'] },
  boardDesign: { layoutDescription: 'Canonical 布局', sections: [{ title: 'Canonical 区域', position: 'Canonical 位置', content: 'Canonical 板书' }] },
  homework: [{ id: 'canonical-homework', purpose: 'Canonical 层次', description: 'Canonical 作业', estimatedMinutes: 5, answerGuidance: 'Canonical 指导', sourceRefs: [] }],
  reflectionPrompts: ['Canonical 反思'],
  exercises: [{ id: 'canonical-exercise', type: 'short_answer', difficulty: 2, knowledgePoints: ['Canonical 知识点'], stem: 'Canonical 题干', answer: 'Canonical 答案', explanation: 'Canonical 解析', scoringRubric: 'Canonical 评分', estimatedMinutes: 3, sourceRefs: [] }],
  customSections: [{ id: 'canonical-custom', title: 'Canonical 自定义', content: 'Canonical 内容' }],
  sectionOrder: ['custom:canonical-custom', 'timeline'],
  sectionTitles: { timeline: 'Canonical 改名过程' },
});
assert.equal(canonical.title, 'Canonical 标题');
assert.deepEqual(canonical.sections.slice(0, 2).map((section) => section.key), ['custom:canonical-custom', 'timeline']);
assert.equal(canonical.sections.find((section) => section.key === 'timeline').title, 'Canonical 改名过程');
assert.equal(canonical.sections.find((section) => section.kind === 'timeline').data.stages[0].questionDetails[0].followUp, 'Canonical 追问');
assert.equal(canonical.sections.find((section) => section.kind === 'board').data.structured.sections[0].content, 'Canonical 板书');
assert.equal(canonical.sections.find((section) => section.kind === 'exercises').data.items[0].type, '简答题');

assert.equal(sanitizeExportFilename('  《春》/第一课时:*?  ', '.DOCX'), '《春》 第一课时.docx');
assert.equal(sanitizeExportFilename('...   ', 'pdf'), '教案.pdf');
assert.equal(sanitizeExportFilename('正常标题', ''), '正常标题');

assert.deepEqual(
  validateLessonExportInput({ metadata: { title: '只有标题' } }),
  { status: 422, code: 'LESSON_EXPORT_EMPTY', message: '当前教案没有可导出的正文内容' },
  '只有元数据、没有正文的教案必须拒绝导出',
);
assert.equal(validateLessonExportInput({ key_points: ['有效正文'] }), null, '包含正文的教案应通过输入校验');
const oversizedCustomSections = {
  custom_sections: Array.from({ length: 51 }, (_, index) => ({
    id: `custom-${index}`,
    title: `模块 ${index}`,
    content: '正文',
  })),
};
assert.equal(
  validateLessonExportInput(oversizedCustomSections)?.code,
  'LESSON_EXPORT_ARRAY_TOO_LARGE',
  '自定义模块数组必须在构建模型前限制长度',
);
const circularLesson = { key_points: ['有效正文'] };
circularLesson.self = circularLesson;
assert.equal(
  validateLessonExportInput(circularLesson)?.code,
  'LESSON_EXPORT_INVALID',
  '循环结构必须在构建模型前拒绝',
);

console.log('lesson export model tests passed');

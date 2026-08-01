import { readFileSync } from 'node:fs';

const schemaUrl = new URL('../shared/lesson-plan.schema.json', import.meta.url);
const sourceSchema = JSON.parse(readFileSync(schemaUrl, 'utf8'));

// Responses Structured Outputs only needs the validation vocabulary. Keep the
// canonical schema in shared/ so the API, UI, exporter, and future trainer cannot
// silently drift apart.
const {
  $schema: _schemaDialect,
  $id: _schemaId,
  title: _title,
  description: _description,
  ...responseSchema
} = sourceSchema;

export const LESSON_PLAN_SCHEMA = normalizeForResponses(responseSchema);

function normalizeForResponses(value) {
  if (Array.isArray(value)) return value.map(normalizeForResponses);
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    // `enum` is part of the documented Structured Outputs subset and expresses
    // the same one-value constraint as `const` for this schema.
    if (key === 'const') {
      normalized.enum = [child];
    } else {
      normalized[key] = normalizeForResponses(child);
    }
  }
  return normalized;
}

export function validateLessonPlan(value, expectedDuration) {
  if (!isRecord(value)) {
    return '模型输出不是教案对象';
  }
  if (value.schemaVersion !== 'lesson-plan.v1') {
    return '模型输出的教案版本不受支持';
  }

  if (!isRecord(value.metadata)) {
    return '模型输出缺少教案元数据';
  }

  for (const [field, label] of [
    ['subject', '学科'],
    ['grade', '年级'],
    ['chapterTitle', '章节名称'],
    ['lessonTitle', '教案标题'],
    ['language', '语言'],
  ]) {
    if (!hasText(value.metadata[field])) return `教案元数据缺少${label}`;
  }
  if (typeof value.metadata.textbookEdition !== 'string') {
    return '教案元数据中的教材版本格式无效';
  }
  if (typeof value.metadata.classProfile !== 'string') {
    return '教案元数据中的班级学情格式无效';
  }

  const lessonDuration = value.metadata.durationMinutes;
  if (!isIntegerInRange(lessonDuration, 1, 600)) {
    return '教案课时必须是 1 到 600 之间的整数分钟';
  }
  if (expectedDuration !== undefined && expectedDuration !== null) {
    const requestedDuration = Number(expectedDuration);
    if (!isIntegerInRange(requestedDuration, 1, 600)) {
      return '期望课时参数无效';
    }
    if (lessonDuration !== requestedDuration) {
      return `模型输出课时 ${lessonDuration} 分钟，与用户请求的 ${requestedDuration} 分钟不一致`;
    }
  }

  if (typeof value.sourceSummary !== 'string') return '模型输出缺少章节概述';
  if (!isTextArray(value.coreCompetencies, 1)) return '模型输出缺少核心素养';
  if (!Array.isArray(value.learningObjectives) || value.learningObjectives.length === 0) {
    return '模型输出缺少教学目标';
  }
  for (const [index, objective] of value.learningObjectives.entries()) {
    if (!isRecord(objective) || !hasText(objective.type) || !hasText(objective.content)
      || !hasText(objective.measurableEvidence) || !Array.isArray(objective.sourceRefs)) {
      return `第 ${index + 1} 个教学目标不完整`;
    }
  }
  if (!isRecord(value.learnerAnalysis)
    || typeof value.learnerAnalysis.currentKnowledge !== 'string'
    || !isTextArray(value.learnerAnalysis.commonMisconceptions)
    || !isTextArray(value.learnerAnalysis.learningNeeds)
    || typeof value.learnerAnalysis.classCharacteristics !== 'string') {
    return '模型输出的学情分析不完整';
  }
  if (!isTextArray(value.keyPoints, 1)) return '模型输出缺少教学重点';
  if (!isTextArray(value.difficultPoints, 1)) return '模型输出缺少教学难点';
  if (!hasTextArrayObject(value.preparation, ['teacher', 'students', 'materials'])) {
    return '模型输出的教学准备格式无效';
  }

  const timelineError = validateTimeline(value.timeline, lessonDuration);
  if (timelineError) return timelineError;

  if (!hasTextArrayObject(value.differentiation, ['support', 'standard', 'challenge'])) {
    return '模型输出的分层教学格式无效';
  }
  if (!isRecord(value.assessmentPlan)
    || !isTextArray(value.assessmentPlan.diagnostic)
    || !isTextArray(value.assessmentPlan.formative)
    || !isTextArray(value.assessmentPlan.summative)
    || !isTextArray(value.assessmentPlan.successCriteria, 1)) {
    return '模型输出的评价方案不完整';
  }

  const exerciseError = validateExercises(value.exercises);
  if (exerciseError) return exerciseError;

  if (!Array.isArray(value.homework)) return '模型输出的课后作业格式无效';
  for (const [index, homework] of value.homework.entries()) {
    if (!isRecord(homework) || !hasText(homework.id) || !hasText(homework.description)
      || typeof homework.purpose !== 'string'
      || !isIntegerInRange(homework.estimatedMinutes, 1, 600)
      || typeof homework.answerGuidance !== 'string'
      || !Array.isArray(homework.sourceRefs)) {
      return `第 ${index + 1} 项课后作业不完整`;
    }
  }
  if (!isRecord(value.boardDesign)
    || typeof value.boardDesign.layoutDescription !== 'string'
    || !Array.isArray(value.boardDesign.sections)) {
    return '模型输出的板书设计格式无效';
  }
  for (const [index, section] of value.boardDesign.sections.entries()) {
    if (!isRecord(section) || typeof section.title !== 'string'
      || !hasText(section.content) || typeof section.position !== 'string') {
      return `板书设计第 ${index + 1} 个区域不完整`;
    }
  }
  if (!isTextArray(value.safetyAndInclusion)) return '课堂安全与包容性建议格式无效';
  if (!isTextArray(value.reflectionPrompts)) return '课后反思问题格式无效';
  if (!isRecord(value.generationMeta)
    || !['ai', 'human', 'mixed'].includes(value.generationMeta.generatedBy)
    || typeof value.generationMeta.promptVersion !== 'string'
    || typeof value.generationMeta.modelRouteId !== 'string'
    || typeof value.generationMeta.generatedAt !== 'string') {
    return '模型输出的生成信息格式无效';
  }
  return null;
}

function validateTimeline(timeline, lessonDuration) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return '模型输出缺少课堂时间线';
  }

  let actualMinutes = 0;
  for (const [index, stage] of timeline.entries()) {
    const label = `课堂时间线第 ${index + 1} 个环节`;
    if (!isRecord(stage)) return `${label}不是有效对象`;
    if (!hasText(stage.id)) return `${label}缺少 ID`;
    if (!isIntegerInRange(stage.startMinute, 0, 600)) return `${label}的开始时间无效`;
    if (!isIntegerInRange(stage.durationMinutes, 1, 600)) return `${label}的时长无效`;
    if (!hasText(stage.stage)) return `${label}缺少环节名称`;
    if (!hasText(stage.engagementGoal)) return `${label}缺少课堂参与目标`;
    if (!isTextArray(stage.teacherActions, 1)) return `${label}缺少教师活动`;
    if (!hasText(stage.teacherScript)) return `${label}缺少教师讲解话术`;
    if (!isTextArray(stage.studentActions, 1)) return `${label}缺少学生活动`;
    if (!Array.isArray(stage.questions)) return `${label}的课堂提问格式无效`;
    for (const [questionIndex, question] of stage.questions.entries()) {
      if (!isRecord(question) || !hasText(question.prompt)
        || typeof question.purpose !== 'string'
        || typeof question.expectedResponse !== 'string'
        || typeof question.followUp !== 'string'
        || !Array.isArray(question.sourceRefs)) {
        return `${label}的第 ${questionIndex + 1} 个课堂提问不完整`;
      }
    }
    if (!isTextArray(stage.expectedResponses)) return `${label}的预期回应格式无效`;
    if (!isTextArray(stage.misconceptions)) return `${label}的常见误区格式无效`;
    if (!hasText(stage.fallbackStrategy)) return `${label}缺少备用教学策略`;
    if (!hasText(stage.formativeAssessment)) return `${label}缺少形成性评价`;
    if (!Array.isArray(stage.sourceRefs)) return `${label}的来源引用格式无效`;
    actualMinutes += stage.durationMinutes;
  }

  if (actualMinutes !== lessonDuration) {
    return `课堂时间线合计 ${actualMinutes} 分钟，与课时 ${lessonDuration} 分钟不一致`;
  }
  return null;
}

function validateExercises(exercises) {
  if (!Array.isArray(exercises) || exercises.length < 10) {
    return '模型输出的习题少于 10 道';
  }

  for (const [index, exercise] of exercises.entries()) {
    const label = `第 ${index + 1} 道习题`;
    if (!isRecord(exercise)) return `${label}不是有效对象`;
    if (!hasText(exercise.id)) return `${label}缺少 ID`;
    if (!hasText(exercise.type)) return `${label}缺少题型`;
    if (!isIntegerInRange(exercise.difficulty, 1, 5)) return `${label}的难度必须是 1 到 5 的整数`;
    if (!isTextArray(exercise.knowledgePoints, 1)) return `${label}缺少知识点`;
    if (!hasText(exercise.stem)) return `${label}缺少题干`;
    if (!hasText(exercise.answer)) return `${label}缺少答案`;
    if (!hasText(exercise.explanation)) return `${label}缺少解析`;
    if (typeof exercise.scoringRubric !== 'string') return `${label}的评分标准格式无效`;
    if (!isIntegerInRange(exercise.estimatedMinutes, 1, 180)) return `${label}的预计用时无效`;
    if (!Array.isArray(exercise.sourceRefs)) return `${label}的来源引用格式无效`;
  }
  return null;
}

function hasTextArrayObject(value, fields) {
  return isRecord(value) && fields.every((field) => isTextArray(value[field]));
}

function isTextArray(value, minimumItems = 0) {
  return Array.isArray(value)
    && value.length >= minimumItems
    && value.every((item) => hasText(item));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIntegerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

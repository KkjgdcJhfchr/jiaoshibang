const objectiveTypeMap = {
  知识: 'knowledge',
  知识目标: 'knowledge',
  能力: 'skill',
  能力目标: 'skill',
  技能: 'skill',
  思维: 'thinking',
  思维目标: 'thinking',
  素养: 'core_competency',
  核心素养: 'core_competency',
  态度: 'attitude',
  情感态度: 'attitude',
};

const exerciseTypeMap = {
  单选题: 'single_choice',
  单项选择题: 'single_choice',
  选择题: 'single_choice',
  多选题: 'multiple_choice',
  多项选择题: 'multiple_choice',
  判断题: 'true_false',
  填空题: 'fill_blank',
  计算题: 'calculation',
  简答题: 'short_answer',
  论述题: 'essay',
  探究题: 'inquiry',
  实践题: 'practice',
};

const objectiveTypes = new Set(['knowledge', 'skill', 'thinking', 'core_competency', 'attitude']);
const exerciseTypes = new Set([
  'single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'calculation',
  'short_answer', 'essay', 'inquiry', 'practice',
]);
const customSectionMarker = '【教师自定义模块】';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function requiredText(value, fallback) {
  const text = stringValue(value).trim();
  return text || fallback;
}

function integerInRange(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function textArray(value, fallback = []) {
  if (!Array.isArray(value)) return asArray(fallback).map(String).filter(Boolean);
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function sourceItem(items, item, index) {
  const list = asArray(items);
  if (item?.id) {
    const matched = list.find((candidate) => candidate?.id === item.id);
    if (matched) return matched;
  }
  return list[index] || {};
}

function sourceRefs(value, fallback = []) {
  return Array.isArray(value) ? value : asArray(fallback);
}

function normalizeObjectiveType(value, fallback = 'knowledge') {
  const type = objectiveTypeMap[value] || value;
  return objectiveTypes.has(type) ? type : objectiveTypes.has(fallback) ? fallback : 'knowledge';
}

function normalizeExerciseType(value, fallback = 'practice') {
  const type = exerciseTypeMap[value] || value;
  return exerciseTypes.has(type) ? type : exerciseTypes.has(fallback) ? fallback : 'practice';
}

function canonicalQuestion(question, detail, fallback, stage, index) {
  const questionObject = isRecord(question) ? question : {};
  const editorDetail = isRecord(detail) ? detail : {};
  const source = isRecord(fallback) ? fallback : {};
  const prompt = typeof question === 'string'
    ? question
    : questionObject.prompt ?? editorDetail.prompt ?? source.prompt;
  return {
    prompt: requiredText(prompt, `${stage}问题 ${index + 1}`),
    purpose: stringValue(questionObject.purpose ?? editorDetail.purpose, stringValue(source.purpose)),
    expectedResponse: stringValue(
      questionObject.expectedResponse ?? questionObject.expected_response
        ?? editorDetail.expectedResponse ?? editorDetail.expected_response,
      stringValue(source.expectedResponse),
    ),
    followUp: stringValue(
      questionObject.followUp ?? questionObject.follow_up ?? editorDetail.followUp ?? editorDetail.follow_up,
      stringValue(source.followUp),
    ),
    sourceRefs: sourceRefs(
      questionObject.sourceRefs ?? questionObject.source_refs
        ?? editorDetail.sourceRefs ?? editorDetail.source_refs,
      source.sourceRefs,
    ),
  };
}

function canonicalTimeline(value, sourceTimeline, fallbackDuration) {
  const editorStages = asArray(value);
  const stages = editorStages.length ? editorStages : asArray(sourceTimeline);
  if (!stages.length) {
    return [{
      id: 'stage-1',
      startMinute: 0,
      durationMinutes: fallbackDuration,
      stage: '完整教学环节',
      engagementGoal: '引导学生主动参与学习任务。',
      teacherActions: ['组织教学活动。'],
      teacherScript: '根据本课目标完成讲解、练习与总结。',
      studentActions: ['参与课堂活动。'],
      questions: [],
      expectedResponses: [],
      misconceptions: [],
      fallbackStrategy: '根据学生回应调整讲解和练习节奏。',
      formativeAssessment: '观察课堂参与和任务完成情况。',
      sourceRefs: [],
    }];
  }

  return stages.map((item, index) => {
    const editor = isRecord(item) ? item : {};
    const source = sourceItem(sourceTimeline, editor, index);
    const stage = requiredText(editor.stage, requiredText(source.stage, `教学环节 ${index + 1}`));
    const rawQuestions = asArray(editor.questions).length
      ? asArray(editor.questions)
      : asArray(editor.question_details).length
        ? asArray(editor.question_details)
        : asArray(source.questions);
    return {
      id: requiredText(editor.id, requiredText(source.id, `stage-${index + 1}`)),
      startMinute: integerInRange(editor.start_minute ?? editor.startMinute, Number(source.startMinute) || 0, 0, 600),
      durationMinutes: integerInRange(
        editor.duration_minutes ?? editor.durationMinutes,
        Number(source.durationMinutes) || 1,
        1,
        600,
      ),
      stage,
      engagementGoal: requiredText(
        editor.engagement_goal ?? editor.engagementGoal,
        requiredText(source.engagementGoal, '明确学习任务并促进学生参与。'),
      ),
      teacherActions: textArray(
        editor.teacher_actions ?? editor.teacherActions,
        asArray(source.teacherActions).length
          ? source.teacherActions
          : [editor.teacher_script || source.teacherScript || '组织教学活动'],
      ),
      teacherScript: requiredText(
        editor.teacher_script ?? editor.teacherScript,
        requiredText(source.teacherScript, '按本环节目标开展讲解与引导。'),
      ),
      studentActions: textArray(
        editor.student_actions ?? editor.studentActions,
        asArray(source.studentActions).length ? source.studentActions : ['参与课堂任务'],
      ),
      questions: rawQuestions.map((question, questionIndex) => canonicalQuestion(
        question,
        asArray(editor.question_details)[questionIndex],
        asArray(source.questions)[questionIndex],
        stage,
        questionIndex,
      )),
      expectedResponses: textArray(
        editor.expected_responses ?? editor.expectedResponses,
        source.expectedResponses,
      ),
      misconceptions: textArray(editor.misconceptions, source.misconceptions),
      fallbackStrategy: requiredText(
        editor.fallback_strategy ?? editor.fallbackStrategy,
        requiredText(source.fallbackStrategy, '根据学生回应调整支架和教学节奏。'),
      ),
      formativeAssessment: requiredText(
        editor.formative_assessment ?? editor.formativeAssessment,
        requiredText(source.formativeAssessment, '观察学生的课堂表现与任务完成情况。'),
      ),
      sourceRefs: sourceRefs(editor.source_refs ?? editor.sourceRefs, source.sourceRefs),
    };
  });
}

function canonicalExercises(value, sourceExercises) {
  const editorExercises = asArray(value);
  const primary = editorExercises.length ? editorExercises : asArray(sourceExercises);
  const result = primary.map((item, index) => {
    const editor = isRecord(item) ? item : {};
    const source = sourceItem(sourceExercises, editor, index);
    return {
      id: requiredText(editor.id, requiredText(source.id, `exercise-${index + 1}`)),
      type: normalizeExerciseType(editor.type, source.type),
      difficulty: integerInRange(editor.difficulty, Number(source.difficulty) || 1, 1, 5),
      knowledgePoints: textArray(
        editor.knowledge_points ?? editor.knowledgePoints,
        asArray(source.knowledgePoints).length ? source.knowledgePoints : ['本章核心知识'],
      ),
      stem: requiredText(editor.stem, requiredText(source.stem, `练习 ${index + 1}`)),
      answer: requiredText(editor.answer, requiredText(source.answer, '答案待补充')),
      explanation: requiredText(editor.explanation, requiredText(source.explanation, '解析待补充')),
      scoringRubric: stringValue(
        editor.scoring_rubric ?? editor.scoringRubric,
        stringValue(source.scoringRubric),
      ),
      estimatedMinutes: integerInRange(
        editor.estimated_minutes ?? editor.estimatedMinutes,
        Number(source.estimatedMinutes) || 3,
        1,
        180,
      ),
      sourceRefs: sourceRefs(editor.source_refs ?? editor.sourceRefs, source.sourceRefs),
    };
  });

  for (let index = result.length; index < 10; index += 1) {
    const source = asArray(sourceExercises)[index] || {};
    result.push({
      id: requiredText(source.id, `exercise-${index + 1}`),
      type: normalizeExerciseType(source.type),
      difficulty: integerInRange(source.difficulty, 1, 1, 5),
      knowledgePoints: textArray(source.knowledgePoints, ['本章核心知识']),
      stem: requiredText(source.stem, `练习 ${index + 1}`),
      answer: requiredText(source.answer, '答案待补充'),
      explanation: requiredText(source.explanation, '解析待补充'),
      scoringRubric: stringValue(source.scoringRubric),
      estimatedMinutes: integerInRange(source.estimatedMinutes, 3, 1, 180),
      sourceRefs: sourceRefs(source.sourceRefs),
    });
  }
  return result;
}

function canonicalHomework(value, sourceHomework) {
  const editorHomework = asArray(value);
  const items = editorHomework.length ? editorHomework : asArray(sourceHomework);
  return items.map((item, index) => {
    const editor = isRecord(item) ? item : {};
    const source = sourceItem(sourceHomework, editor, index);
    return {
      id: requiredText(editor.id, requiredText(source.id, `homework-${index + 1}`)),
      description: requiredText(
        editor.content ?? editor.description,
        requiredText(source.description, `课后任务 ${index + 1}`),
      ),
      purpose: stringValue(editor.level ?? editor.purpose, stringValue(source.purpose)),
      estimatedMinutes: integerInRange(
        editor.estimated_minutes ?? editor.estimatedMinutes,
        Number(source.estimatedMinutes) || 10,
        1,
        600,
      ),
      answerGuidance: stringValue(
        editor.answer_guidance ?? editor.answerGuidance,
        stringValue(source.answerGuidance),
      ),
      sourceRefs: sourceRefs(editor.source_refs ?? editor.sourceRefs, source.sourceRefs),
    };
  });
}

function canonicalBoardDesign(lesson, sourceBoard) {
  if (typeof lesson.board_design === 'string') {
    const content = lesson.board_design.trim();
    return {
      layoutDescription: content,
      sections: content ? [{ title: '板书设计', content, position: '整体' }] : [],
    };
  }
  const editor = isRecord(lesson.board_design_structured)
    ? lesson.board_design_structured
    : isRecord(lesson.board_design) ? lesson.board_design : {};
  const source = isRecord(sourceBoard) ? sourceBoard : {};
  const rawSections = asArray(editor.sections).length ? editor.sections : asArray(source.sections);
  return {
    layoutDescription: stringValue(
      editor.layout_description ?? editor.layoutDescription,
      stringValue(source.layoutDescription),
    ),
    sections: rawSections.map((section) => ({
      title: stringValue(section?.title),
      content: requiredText(section?.content, '板书内容'),
      position: stringValue(section?.position),
    })),
  };
}

function reflectionPromptsWithCustomSections(reflectionPrompts, customSections) {
  const preserved = textArray(reflectionPrompts).filter((item) => !item.startsWith(customSectionMarker));
  const encoded = asArray(customSections)
    .filter(isRecord)
    .map((section, index) => {
      const title = requiredText(section.title, `自定义模块 ${index + 1}`);
      const content = stringValue(section.content).trim();
      return content ? `${customSectionMarker}${title}\n${content}` : '';
    })
    .filter(Boolean);
  return [...preserved, ...encoded];
}

export function toCanonicalLesson(lesson, sourceLesson = null) {
  const editor = isRecord(lesson) ? lesson : {};
  const source = sourceLesson?.schemaVersion === 'lesson-plan.v1' ? sourceLesson : {};
  const metadata = isRecord(editor.metadata) ? editor.metadata : {};
  const sourceMetadata = isRecord(source.metadata) ? source.metadata : {};

  const learningObjectivesSource = asArray(source.learningObjectives);
  const editorObjectives = asArray(editor.learning_objectives);
  const objectiveItems = editorObjectives.length ? editorObjectives : learningObjectivesSource;
  const learningObjectives = objectiveItems.map((item, index) => {
    const value = isRecord(item) ? item : {};
    const fallback = learningObjectivesSource[index] || {};
    return {
      type: normalizeObjectiveType(value.type, fallback.type),
      content: requiredText(value.content, requiredText(fallback.content, '待完善教学目标')),
      measurableEvidence: requiredText(
        value.measurable_evidence ?? value.measurableEvidence,
        requiredText(fallback.measurableEvidence, '通过课堂任务与练习观察达成情况。'),
      ),
      sourceRefs: sourceRefs(value.source_refs ?? value.sourceRefs, fallback.sourceRefs),
    };
  });
  if (!learningObjectives.length) {
    learningObjectives.push({
      type: 'knowledge',
      content: '理解并掌握本课核心内容。',
      measurableEvidence: '通过课堂任务与练习观察达成情况。',
      sourceRefs: [],
    });
  }

  const sourceLearner = isRecord(source.learnerAnalysis) ? source.learnerAnalysis : {};
  const learner = isRecord(editor.learner_analysis) ? editor.learner_analysis : {};
  const sourcePreparation = isRecord(source.preparation) ? source.preparation : {};
  const preparation = isRecord(editor.preparation) ? editor.preparation : {};
  const sourceDifferentiation = isRecord(source.differentiation) ? source.differentiation : {};
  const differentiation = isRecord(editor.differentiation) ? editor.differentiation : {};
  const sourceAssessment = isRecord(source.assessmentPlan) ? source.assessmentPlan : {};
  const assessment = isRecord(editor.assessment_plan) ? editor.assessment_plan : {};
  const timeline = canonicalTimeline(
    editor.timeline,
    source.timeline,
    integerInRange(metadata.duration_minutes ?? metadata.durationMinutes, Number(sourceMetadata.durationMinutes) || 45, 1, 600),
  );
  const timelineMinutes = timeline.reduce((total, stage) => total + stage.durationMinutes, 0);

  return {
    schemaVersion: 'lesson-plan.v1',
    metadata: {
      subject: requiredText(metadata.subject, requiredText(sourceMetadata.subject, '未填写')),
      grade: requiredText(metadata.grade, requiredText(sourceMetadata.grade, '未填写')),
      textbookEdition: stringValue(
        metadata.textbook_edition ?? metadata.textbookEdition,
        stringValue(sourceMetadata.textbookEdition),
      ),
      chapterTitle: requiredText(
        metadata.chapter ?? metadata.chapterTitle,
        requiredText(sourceMetadata.chapterTitle, '未填写章节'),
      ),
      lessonTitle: requiredText(
        metadata.title ?? metadata.lessonTitle,
        requiredText(sourceMetadata.lessonTitle, `${metadata.chapter || sourceMetadata.chapterTitle || '新章节'}教学设计`),
      ),
      durationMinutes: timelineMinutes || integerInRange(
        metadata.duration_minutes ?? metadata.durationMinutes,
        Number(sourceMetadata.durationMinutes) || 45,
        1,
        600,
      ),
      classProfile: stringValue(
        metadata.class_profile ?? metadata.classProfile,
        stringValue(sourceMetadata.classProfile),
      ),
      language: requiredText(metadata.language, requiredText(sourceMetadata.language, 'zh-CN')),
    },
    sourceSummary: stringValue(editor.source_summary ?? editor.sourceSummary, stringValue(source.sourceSummary)),
    coreCompetencies: textArray(
      editor.core_competencies ?? editor.coreCompetencies,
      asArray(source.coreCompetencies).length ? source.coreCompetencies : ['学科核心素养'],
    ),
    learningObjectives,
    learnerAnalysis: {
      currentKnowledge: stringValue(
        learner.known ?? learner.currentKnowledge,
        stringValue(sourceLearner.currentKnowledge),
      ),
      commonMisconceptions: typeof learner.challenge === 'string'
        ? (learner.challenge.trim() ? [learner.challenge.trim()] : [])
        : textArray(learner.commonMisconceptions, sourceLearner.commonMisconceptions),
      learningNeeds: typeof learner.strategy === 'string'
        ? (learner.strategy.trim() ? [learner.strategy.trim()] : [])
        : textArray(learner.learningNeeds, sourceLearner.learningNeeds),
      classCharacteristics: stringValue(
        learner.class_characteristics ?? learner.classCharacteristics,
        stringValue(sourceLearner.classCharacteristics, stringValue(metadata.class_profile)),
      ),
    },
    keyPoints: textArray(
      editor.key_points ?? editor.keyPoints,
      asArray(source.keyPoints).length ? source.keyPoints : ['本课核心内容'],
    ),
    difficultPoints: textArray(
      editor.difficult_points ?? editor.difficultPoints,
      asArray(source.difficultPoints).length ? source.difficultPoints : ['本课难点'],
    ),
    preparation: {
      teacher: textArray(preparation.teacher, sourcePreparation.teacher),
      students: textArray(preparation.students, sourcePreparation.students),
      materials: textArray(preparation.materials, sourcePreparation.materials),
    },
    timeline,
    differentiation: {
      support: textArray(differentiation.support, sourceDifferentiation.support),
      standard: textArray(differentiation.standard, sourceDifferentiation.standard),
      challenge: textArray(differentiation.challenge, sourceDifferentiation.challenge),
    },
    assessmentPlan: {
      diagnostic: textArray(assessment.diagnostic, sourceAssessment.diagnostic),
      formative: textArray(assessment.formative, sourceAssessment.formative),
      summative: textArray(assessment.summative, sourceAssessment.summative),
      successCriteria: textArray(
        assessment.success_criteria ?? assessment.successCriteria,
        asArray(sourceAssessment.successCriteria).length
          ? sourceAssessment.successCriteria
          : ['完成本课教学目标并能迁移核心方法'],
      ),
    },
    exercises: canonicalExercises(editor.exercises, source.exercises),
    homework: canonicalHomework(editor.homework, source.homework),
    boardDesign: canonicalBoardDesign(editor, source.boardDesign),
    safetyAndInclusion: textArray(
      editor.safety_and_inclusion ?? editor.safetyAndInclusion,
      source.safetyAndInclusion,
    ),
    reflectionPrompts: reflectionPromptsWithCustomSections(
      editor.reflection_prompts ?? editor.reflectionPrompts ?? source.reflectionPrompts,
      editor.custom_sections,
    ),
    generationMeta: {
      generatedBy: 'mixed',
      promptVersion: stringValue(
        editor.generation_meta?.promptVersion ?? editor.generationMeta?.promptVersion,
        stringValue(source.generationMeta?.promptVersion, 'lesson-plan.v1'),
      ),
      modelRouteId: stringValue(
        editor.generation_meta?.modelRouteId ?? editor.generationMeta?.modelRouteId,
        stringValue(source.generationMeta?.modelRouteId, 'teacher-editor'),
      ),
      generatedAt: stringValue(
        editor.generation_meta?.generatedAt ?? editor.generationMeta?.generatedAt,
        stringValue(source.generationMeta?.generatedAt, new Date().toISOString()),
      ),
    },
  };
}

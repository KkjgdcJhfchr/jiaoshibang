const objectiveTypeMap = {
  知识: 'knowledge',
  能力: 'skill',
  技能: 'skill',
  思维: 'thinking',
  素养: 'core_competency',
  态度: 'attitude',
};

const exerciseTypeMap = {
  单选题: 'single_choice',
  多选题: 'multiple_choice',
  判断题: 'true_false',
  填空题: 'fill_blank',
  计算题: 'calculation',
  简答题: 'short_answer',
  论述题: 'essay',
  探究题: 'inquiry',
  实践题: 'practice',
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function makeQuestion(question, stage, index) {
  if (question && typeof question === 'object' && question.prompt) return question;
  return {
    prompt: String(question || `${stage}问题 ${index + 1}`),
    purpose: '',
    expectedResponse: '',
    followUp: '',
    sourceRefs: [],
  };
}

export function toCanonicalLesson(lesson, sourceLesson = null) {
  if (sourceLesson?.schemaVersion === 'lesson-plan.v1') {
    return {
      ...sourceLesson,
      metadata: {
        ...sourceLesson.metadata,
        lessonTitle: lesson.metadata?.title || sourceLesson.metadata.lessonTitle,
        classProfile: lesson.metadata?.class_profile ?? sourceLesson.metadata.classProfile,
      },
      learningObjectives: asArray(sourceLesson.learningObjectives).map((item, index) => ({
        ...item,
        content: lesson.learning_objectives?.[index]?.content || item.content,
      })),
    };
  }

  const metadata = lesson.metadata || {};
  return {
    schemaVersion: 'lesson-plan.v1',
    metadata: {
      subject: metadata.subject || '未填写',
      grade: metadata.grade || '未填写',
      textbookEdition: metadata.textbook_edition || '',
      chapterTitle: metadata.chapter || metadata.title || '未填写章节',
      lessonTitle: metadata.title || `${metadata.chapter || '新章节'}教学设计`,
      durationMinutes: Number(metadata.duration_minutes) || 45,
      classProfile: metadata.class_profile || '',
      language: metadata.language || 'zh-CN',
    },
    sourceSummary: lesson.source_summary || '',
    coreCompetencies: asArray(lesson.core_competencies).length ? lesson.core_competencies : ['学科核心素养'],
    learningObjectives: asArray(lesson.learning_objectives).map((item) => ({
      type: objectiveTypeMap[item.type] || item.type || 'knowledge',
      content: item.content || '待完善教学目标',
      measurableEvidence: item.measurable_evidence || '通过课堂任务与练习观察达成情况。',
      sourceRefs: asArray(item.source_refs),
    })),
    learnerAnalysis: {
      currentKnowledge: lesson.learner_analysis?.known || '',
      commonMisconceptions: lesson.learner_analysis?.challenge ? [lesson.learner_analysis.challenge] : [],
      learningNeeds: lesson.learner_analysis?.strategy ? [lesson.learner_analysis.strategy] : [],
      classCharacteristics: lesson.learner_analysis?.class_characteristics || metadata.class_profile || '',
    },
    keyPoints: asArray(lesson.key_points),
    difficultPoints: asArray(lesson.difficult_points),
    preparation: lesson.preparation || { teacher: [], students: [], materials: [] },
    timeline: asArray(lesson.timeline).map((item, index) => ({
      id: item.id || `stage-${index + 1}`,
      startMinute: Number(item.start_minute) || 0,
      durationMinutes: Math.max(1, Number(item.duration_minutes) || 1),
      stage: item.stage || `教学环节 ${index + 1}`,
      engagementGoal: item.engagement_goal || '',
      teacherActions: asArray(item.teacher_actions).length ? item.teacher_actions : [item.teacher_script || '组织教学活动'],
      teacherScript: item.teacher_script || '',
      studentActions: asArray(item.student_actions).length ? item.student_actions : ['参与课堂活动'],
      questions: asArray(item.questions).map((question, questionIndex) => makeQuestion(question, item.stage, questionIndex)),
      expectedResponses: asArray(item.expected_responses),
      misconceptions: asArray(item.misconceptions),
      fallbackStrategy: item.fallback_strategy || '',
      formativeAssessment: item.formative_assessment || '',
      sourceRefs: asArray(item.source_refs),
    })),
    differentiation: lesson.differentiation || { support: [], standard: [], challenge: [] },
    assessmentPlan: lesson.assessment_plan || {
      diagnostic: [],
      formative: ['观察课堂参与和任务完成情况'],
      summative: ['检查章节习题完成情况'],
      successCriteria: ['完成本课教学目标并能迁移核心方法'],
    },
    exercises: asArray(lesson.exercises).map((item, index) => ({
      id: item.id || `exercise-${index + 1}`,
      type: exerciseTypeMap[item.type] || item.type || 'practice',
      difficulty: Math.min(5, Math.max(1, Number(item.difficulty) || 1)),
      knowledgePoints: asArray(item.knowledge_points).length ? item.knowledge_points : ['本章核心知识'],
      stem: item.stem || `练习 ${index + 1}`,
      answer: item.answer || '答案待补充',
      explanation: item.explanation || '解析待补充',
      scoringRubric: item.scoring_rubric || '',
      estimatedMinutes: Math.max(1, Number(item.estimated_minutes) || 3),
      sourceRefs: asArray(item.source_refs),
    })),
    homework: asArray(lesson.homework).map((item, index) => ({
      id: item.id || `homework-${index + 1}`,
      description: item.content || item.description || `课后任务 ${index + 1}`,
      purpose: item.level || item.purpose || '',
      estimatedMinutes: Math.max(1, Number(item.estimated_minutes) || 10),
      answerGuidance: item.answer_guidance || '',
      sourceRefs: asArray(item.source_refs),
    })),
    boardDesign: typeof lesson.board_design === 'object' ? lesson.board_design : {
      layoutDescription: lesson.board_design || '',
      sections: lesson.board_design ? [{ title: '板书', content: lesson.board_design, position: '中央' }] : [],
    },
    safetyAndInclusion: asArray(lesson.safety_and_inclusion),
    reflectionPrompts: asArray(lesson.reflection_prompts),
    generationMeta: lesson.generation_meta || {
      generatedBy: 'mixed',
      promptVersion: 'lesson-plan.v1',
      modelRouteId: 'teacher-editor',
      generatedAt: new Date().toISOString(),
    },
  };
}

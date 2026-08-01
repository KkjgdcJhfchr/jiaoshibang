export function normalizeLesson(input) {
  if (!isRecord(input)) return input;

  // The bundled demo and previously saved lessons use the editor's legacy
  // snake_case view model. Leave those values intact so existing local data
  // remains readable. Canonical AI output always carries `schemaVersion`.
  if (!input.schemaVersion) return input;

  const meta = isRecord(input.metadata) ? input.metadata : {};
  const learnerAnalysis = isRecord(input.learnerAnalysis) ? input.learnerAnalysis : {};
  const questionDetailsByStage = toArray(input.timeline).map((stage) =>
    normalizeQuestionDetails(isRecord(stage) ? stage.questions : []),
  );

  return {
    id: toText(input.id) || `lesson-${Date.now()}`,
    schema_version: toText(input.schemaVersion),
    metadata: {
      title: toText(meta.lessonTitle) || `${toText(meta.chapterTitle) || '新章节'}教学设计`,
      subject: toText(meta.subject),
      grade: toText(meta.grade),
      textbook_edition: toText(meta.textbookEdition),
      chapter: toText(meta.chapterTitle),
      duration_minutes: positiveNumber(meta.durationMinutes, 45),
      class_profile: toText(meta.classProfile),
      language: toText(meta.language) || 'zh-CN',
    },
    source_summary: toText(input.sourceSummary),
    core_competencies: toTextArray(input.coreCompetencies),
    learning_objectives: toArray(input.learningObjectives)
      .filter(isRecord)
      .map((item) => ({
        type: toText(item.type),
        content: toText(item.content),
        measurable_evidence: toText(item.measurableEvidence),
        source_refs: toArray(item.sourceRefs),
      })),
    learner_analysis: {
      known: toText(learnerAnalysis.currentKnowledge),
      challenge: toTextArray(learnerAnalysis.commonMisconceptions).join('；'),
      strategy: toTextArray(learnerAnalysis.learningNeeds).join('；'),
      class_characteristics: toText(learnerAnalysis.classCharacteristics),
    },
    key_points: toTextArray(input.keyPoints),
    difficult_points: toTextArray(input.difficultPoints),
    preparation: normalizePreparation(input.preparation),
    timeline: toArray(input.timeline)
      .filter(isRecord)
      .map((item, index) => {
        const questionDetails = questionDetailsByStage[index] || [];
        const questionResponses = questionDetails
          .map((question) => question.expected_response)
          .filter(Boolean);
        return {
          id: toText(item.id) || `stage-${index + 1}`,
          start_minute: nonNegativeNumber(item.startMinute, 0),
          duration_minutes: positiveNumber(item.durationMinutes, 0),
          stage: toText(item.stage),
          engagement_goal: toText(item.engagementGoal),
          teacher_actions: toTextArray(item.teacherActions),
          teacher_script: toText(item.teacherScript),
          student_actions: toTextArray(item.studentActions),
          // The current editor renders these entries directly as React text.
          // Keep the complete object form separately for future rich editing.
          questions: questionDetails.map((question) => question.prompt).filter(Boolean),
          question_details: questionDetails,
          expected_responses: uniqueText([
            ...toTextArray(item.expectedResponses),
            ...questionResponses,
          ]),
          misconceptions: toTextArray(item.misconceptions),
          fallback_strategy: toText(item.fallbackStrategy),
          formative_assessment: toText(item.formativeAssessment),
          source_refs: toArray(item.sourceRefs),
        };
      }),
    differentiation: normalizeDifferentiation(input.differentiation),
    assessment_plan: normalizeAssessmentPlan(input.assessmentPlan),
    exercises: toArray(input.exercises)
      .filter(isRecord)
      .map((item, index) => ({
        id: toText(item.id) || `q${index + 1}`,
        type: toText(item.type),
        difficulty: positiveNumber(item.difficulty, 1),
        knowledge_points: toTextArray(item.knowledgePoints),
        stem: toText(item.stem),
        answer: toText(item.answer),
        explanation: toText(item.explanation),
        scoring_rubric: toText(item.scoringRubric),
        estimated_minutes: positiveNumber(item.estimatedMinutes, 1),
        source_refs: toArray(item.sourceRefs),
      })),
    homework: toArray(input.homework)
      .filter(isRecord)
      .map((item, index) => ({
        id: toText(item.id) || `homework-${index + 1}`,
        level: toText(item.purpose) || `任务 ${index + 1}`,
        content: toText(item.description),
        estimated_minutes: positiveNumber(item.estimatedMinutes, 1),
        answer_guidance: toText(item.answerGuidance),
        source_refs: toArray(item.sourceRefs),
      })),
    board_design: formatBoardDesign(input.boardDesign),
    board_design_structured: normalizeBoardDesign(input.boardDesign),
    safety_and_inclusion: toTextArray(input.safetyAndInclusion),
    reflection_prompts: toTextArray(input.reflectionPrompts),
    generation_meta: isRecord(input.generationMeta) ? { ...input.generationMeta } : {},
    updated_at: toText(input.updated_at) || '刚刚',
  };
}

function normalizeQuestionDetails(value) {
  return toArray(value)
    .map((question) => {
      if (typeof question === 'string') {
        return {
          prompt: question,
          purpose: '',
          expected_response: '',
          follow_up: '',
          source_refs: [],
        };
      }
      if (!isRecord(question)) return null;
      return {
        prompt: toText(question.prompt),
        purpose: toText(question.purpose),
        expected_response: toText(question.expectedResponse),
        follow_up: toText(question.followUp),
        source_refs: toArray(question.sourceRefs),
      };
    })
    .filter(Boolean);
}

function normalizePreparation(value) {
  const preparation = isRecord(value) ? value : {};
  return {
    teacher: toTextArray(preparation.teacher),
    students: toTextArray(preparation.students),
    materials: toTextArray(preparation.materials),
  };
}

function normalizeDifferentiation(value) {
  const differentiation = isRecord(value) ? value : {};
  return {
    support: toTextArray(differentiation.support),
    standard: toTextArray(differentiation.standard),
    challenge: toTextArray(differentiation.challenge),
  };
}

function normalizeAssessmentPlan(value) {
  const assessment = isRecord(value) ? value : {};
  return {
    diagnostic: toTextArray(assessment.diagnostic),
    formative: toTextArray(assessment.formative),
    summative: toTextArray(assessment.summative),
    success_criteria: toTextArray(assessment.successCriteria),
  };
}

function normalizeBoardDesign(value) {
  if (typeof value === 'string') {
    return { layout_description: '', sections: value ? [{ title: '', content: value, position: '' }] : [] };
  }
  const board = isRecord(value) ? value : {};
  return {
    layout_description: toText(board.layoutDescription),
    sections: toArray(board.sections)
      .filter(isRecord)
      .map((section) => ({
        title: toText(section.title),
        content: toText(section.content),
        position: toText(section.position),
      })),
  };
}

function formatBoardDesign(value) {
  if (typeof value === 'string') return value;
  const board = normalizeBoardDesign(value);
  const lines = [];
  if (board.layout_description) lines.push(`布局：${board.layout_description}`);
  for (const section of board.sections) {
    const heading = [section.position ? `[${section.position}]` : '', section.title]
      .filter(Boolean)
      .join(' ');
    if (heading) lines.push(heading);
    if (section.content) lines.push(section.content);
  }
  return lines.join('\n');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function toTextArray(value) {
  return toArray(value).map(toText).filter(Boolean);
}

function uniqueText(value) {
  return [...new Set(value.filter(Boolean))];
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

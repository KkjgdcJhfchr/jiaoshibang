const STANDARD_SECTIONS = [
  ['objectives', '教学目标', 'objectives'],
  ['learner', '学情分析', 'learner'],
  ['keypoints', '重点难点', 'keypoints'],
  ['preparation', '教学准备', 'preparation'],
  ['timeline', '教学过程', 'timeline'],
  ['interaction', '课堂互动与分层评价', 'interaction'],
  ['board', '板书设计', 'board'],
  ['homework', '课后作业', 'homework'],
  ['exercises', '习题与答案', 'exercises'],
];

const OBJECTIVE_TYPE_LABELS = {
  knowledge: '知识目标', 知识: '知识目标', 知识目标: '知识目标',
  thinking: '思维目标', 思维: '思维目标', 思维目标: '思维目标',
  skill: '能力目标', ability: '能力目标', 能力: '能力目标', 能力目标: '能力目标', 技能: '能力目标',
  attitude: '情感态度', 态度: '情感态度', 情感: '情感态度', 情感态度: '情感态度',
  core_competency: '核心素养', coreCompetency: '核心素养', 核心素养: '核心素养',
};

const EXERCISE_TYPE_LABELS = {
  single_choice: '单项选择题', choice: '选择题', select: '选择题', 选择: '选择题', 选择题: '选择题', 单选题: '单项选择题', 单项选择题: '单项选择题',
  multiple_choice: '多项选择题', 多选题: '多项选择题', 多项选择题: '多项选择题',
  true_false: '判断题', judgment: '判断题', 判断: '判断题', 判断题: '判断题',
  fill_blank: '填空题', 填空: '填空题', 填空题: '填空题',
  short_answer: '简答题', shortAnswer: '简答题', 简答: '简答题', 简答题: '简答题',
  essay: '论述题', 论述: '论述题', 论述题: '论述题',
  calculation: '计算题', 计算: '计算题', 计算题: '计算题',
  inquiry: '探究题', 探究: '探究题', 探究题: '探究题',
  practice: '实践题', 实践: '实践题', 实践题: '实践题',
  writing: '写作题', 写作: '写作题', 微写作: '微写作题', 仿写: '仿写题', 赏析: '赏析题',
};

const TECHNICAL_TEXT_KEYS = new Set([
  'id', 'key', 'kind', 'typeCode', 'assetId', 'sourceAssetId', 'blockIds', 'language',
]);

const MAX_INPUT_TOTAL_NODES = 30_000;
const MAX_INPUT_TOTAL_CHARACTERS = 3_000_000;
const MAX_INPUT_OBJECT_PROPERTIES = 500;
const MAX_INPUT_DEPTH = 24;
const DEFAULT_MAX_ARRAY_ITEMS = 500;
const MAX_ARRAY_ITEMS_BY_KEY = new Map([
  ['custom_sections', 50],
  ['customSections', 50],
  ['section_order', 100],
  ['sectionOrder', 100],
  ['learning_objectives', 100],
  ['learningObjectives', 100],
  ['timeline', 200],
  ['homework', 200],
  ['exercises', 500],
  ['question_details', 100],
  ['questionDetails', 100],
  ['options', 50],
  ['source_refs', 200],
  ['sourceRefs', 200],
]);
const EXPORTABLE_CONTENT_KEYS = [
  'source_summary', 'sourceSummary',
  'core_competencies', 'coreCompetencies',
  'learning_objectives', 'learningObjectives',
  'learner_analysis', 'learnerAnalysis',
  'key_points', 'keyPoints',
  'difficult_points', 'difficultPoints',
  'preparation',
  'safety_and_inclusion', 'safetyAndInclusion',
  'timeline',
  'differentiation',
  'assessment_plan', 'assessmentPlan',
  'board_design', 'boardDesign',
  'board_design_structured', 'boardDesignStructured',
  'homework',
  'reflection_prompts', 'reflectionPrompts',
  'exercises',
  'custom_sections', 'customSections',
];
const NON_BODY_CONTENT_KEYS = new Set([
  'id', 'key', 'kind', 'type', 'typeCode', 'title', 'level', 'position', 'stage',
  'asset_id', 'assetId', 'source_id', 'sourceId', 'block_ids', 'blockIds',
]);

export function validateLessonExportInput(input) {
  if (!isRecord(input)) {
    return { status: 422, code: 'LESSON_EXPORT_INVALID', message: '教案内容必须是对象' };
  }

  const stack = [{ value: input, key: '', depth: 0 }];
  const seen = new WeakSet();
  let totalNodes = 0;
  let totalCharacters = 0;

  while (stack.length) {
    const { value, key, depth } = stack.pop();
    totalNodes += 1;
    if (totalNodes > MAX_INPUT_TOTAL_NODES) {
      return { status: 413, code: 'LESSON_EXPORT_TOO_COMPLEX', message: '教案结构过于复杂，无法一次导出' };
    }
    if (depth > MAX_INPUT_DEPTH) {
      return { status: 413, code: 'LESSON_EXPORT_TOO_COMPLEX', message: '教案结构层级过深，无法导出' };
    }
    if (typeof value === 'string') {
      totalCharacters += value.length;
      if (totalCharacters > MAX_INPUT_TOTAL_CHARACTERS) {
        return { status: 413, code: 'LESSON_EXPORT_TOO_LARGE', message: '教案文字内容过多，无法一次导出' };
      }
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) {
      return { status: 422, code: 'LESSON_EXPORT_INVALID', message: '教案结构包含循环引用，无法导出' };
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const maximum = MAX_ARRAY_ITEMS_BY_KEY.get(key) ?? DEFAULT_MAX_ARRAY_ITEMS;
      if (value.length > maximum) {
        return {
          status: 413,
          code: 'LESSON_EXPORT_ARRAY_TOO_LARGE',
          message: `教案字段“${key || '列表'}”包含的项目过多，无法一次导出`,
        };
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], key, depth: depth + 1 });
      }
      continue;
    }

    const entries = Object.entries(value);
    if (entries.length > MAX_INPUT_OBJECT_PROPERTIES) {
      return { status: 413, code: 'LESSON_EXPORT_TOO_COMPLEX', message: '教案对象字段过多，无法一次导出' };
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [childKey, child] = entries[index];
      stack.push({ value: child, key: childKey, depth: depth + 1 });
    }
  }

  const hasContent = EXPORTABLE_CONTENT_KEYS.some((key) => hasMeaningfulValue(input[key]));
  if (!hasContent) {
    return { status: 422, code: 'LESSON_EXPORT_EMPTY', message: '当前教案没有可导出的正文内容' };
  }
  return null;
}

export function buildLessonExportModel(input) {
  const lesson = isRecord(input) ? input : {};
  const metadata = normalizeMetadata(record(lesson.metadata));
  const title = metadata.lessonTitle || `${metadata.chapter || '教案'}教学设计`;
  delete metadata.lessonTitle;

  const customSections = normalizeCustomSections(
    lesson.custom_sections ?? lesson.customSections,
  );
  const sectionTitles = record(lesson.section_titles ?? lesson.sectionTitles);
  const sectionByKey = new Map();

  for (const [key, fallbackTitle, kind] of STANDARD_SECTIONS) {
    sectionByKey.set(key, {
      key,
      title: cleanText(sectionTitles[key]) || fallbackTitle,
      kind,
      data: buildStandardSectionData(key, lesson, metadata),
    });
  }
  for (const custom of customSections) {
    const key = `custom:${custom.id}`;
    sectionByKey.set(key, {
      key,
      title: cleanText(sectionTitles[key]) || custom.title,
      kind: 'custom',
      data: { id: custom.id, content: custom.content },
    });
  }

  const requestedOrder = array(lesson.section_order ?? lesson.sectionOrder)
    .map(cleanText)
    .filter(Boolean);
  const orderedKeys = [];
  const orderedKeySet = new Set();
  for (const key of requestedOrder) {
    if (!sectionByKey.has(key) || orderedKeySet.has(key)) continue;
    orderedKeys.push(key);
    orderedKeySet.add(key);
  }
  for (const key of sectionByKey.keys()) {
    if (orderedKeySet.has(key)) continue;
    orderedKeys.push(key);
    orderedKeySet.add(key);
  }

  return {
    title,
    metadata,
    sections: orderedKeys.map((key) => sectionByKey.get(key)),
  };
}

export function collectLessonExportTexts(model) {
  const texts = [];
  collectVisibleTexts(model, '', texts);
  return texts;
}

export function sanitizeExportFilename(title, extension = '') {
  const safeExtension = String(extension || '')
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  const normalized = String(title || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
    .trim()
    .replace(/[. ]+$/g, '');
  const basenameCandidate = normalized || '教案';
  const basename = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(basenameCandidate)
    ? `_${basenameCandidate}`
    : basenameCandidate;
  return safeExtension ? `${basename}.${safeExtension}` : basename;
}

function buildStandardSectionData(key, lesson, metadata) {
  if (key === 'objectives') {
    return {
      sourceSummary: valueText(lesson, 'source_summary', 'sourceSummary'),
      coreCompetencies: textArray(lesson.core_competencies ?? lesson.coreCompetencies),
      objectives: array(lesson.learning_objectives ?? lesson.learningObjectives).map((raw) => {
        const item = record(raw);
        const typeCode = valueText(item, 'type');
        return {
          type: OBJECTIVE_TYPE_LABELS[typeCode] || (hasChinese(typeCode) ? typeCode : '其他目标'),
          typeCode,
          content: valueText(item, 'content'),
          measurableEvidence: valueText(item, 'measurable_evidence', 'measurableEvidence'),
          sourceRefs: normalizeSourceRefs(item.source_refs ?? item.sourceRefs),
        };
      }),
    };
  }
  if (key === 'learner') {
    const analysis = record(lesson.learner_analysis ?? lesson.learnerAnalysis);
    return {
      classProfile: metadata.classProfile,
      classCharacteristics: valueText(analysis, 'class_characteristics', 'classCharacteristics'),
      currentKnowledge: valueText(analysis, 'known', 'currentKnowledge'),
      challenges: textList(analysis.challenge ?? analysis.common_misconceptions ?? analysis.commonMisconceptions),
      strategies: textList(analysis.strategy ?? analysis.learning_needs ?? analysis.learningNeeds),
    };
  }
  if (key === 'keypoints') {
    return {
      keyPoints: textArray(lesson.key_points ?? lesson.keyPoints),
      difficultPoints: textArray(lesson.difficult_points ?? lesson.difficultPoints),
    };
  }
  if (key === 'preparation') {
    const preparation = record(lesson.preparation);
    return {
      teacher: textArray(preparation.teacher),
      students: textArray(preparation.students),
      materials: textArray(preparation.materials),
      safetyAndInclusion: textArray(lesson.safety_and_inclusion ?? lesson.safetyAndInclusion),
    };
  }
  if (key === 'timeline') {
    return { stages: normalizeTimeline(lesson.timeline) };
  }
  if (key === 'interaction') {
    const differentiation = record(lesson.differentiation);
    const assessment = record(lesson.assessment_plan ?? lesson.assessmentPlan);
    return {
      differentiation: {
        support: textArray(differentiation.support),
        standard: textArray(differentiation.standard),
        challenge: textArray(differentiation.challenge),
      },
      assessmentPlan: {
        diagnostic: textArray(assessment.diagnostic),
        formative: textArray(assessment.formative),
        summative: textArray(assessment.summative),
        successCriteria: textArray(assessment.success_criteria ?? assessment.successCriteria),
      },
    };
  }
  if (key === 'board') return normalizeBoard(lesson);
  if (key === 'homework') {
    return {
      items: array(lesson.homework).map((raw) => {
        const item = record(raw);
        return {
          id: valueText(item, 'id'),
          level: valueText(item, 'level', 'purpose'),
          content: valueText(item, 'content', 'description'),
          estimatedMinutes: numberValue(item.estimated_minutes ?? item.estimatedMinutes),
          answerGuidance: valueText(item, 'answer_guidance', 'answerGuidance'),
          sourceRefs: normalizeSourceRefs(item.source_refs ?? item.sourceRefs),
        };
      }),
      reflectionPrompts: textArray(lesson.reflection_prompts ?? lesson.reflectionPrompts),
    };
  }
  if (key === 'exercises') return { items: normalizeExercises(lesson.exercises) };
  return {};
}

function normalizeMetadata(meta) {
  return {
    lessonTitle: valueText(meta, 'title', 'lessonTitle'),
    subject: valueText(meta, 'subject'),
    grade: valueText(meta, 'grade'),
    textbookEdition: valueText(meta, 'textbook_edition', 'textbookEdition'),
    chapter: valueText(meta, 'chapter', 'chapterTitle'),
    durationMinutes: numberValue(meta.duration_minutes ?? meta.durationMinutes),
    classProfile: valueText(meta, 'class_profile', 'classProfile'),
    language: valueText(meta, 'language') || 'zh-CN',
  };
}

function normalizeTimeline(value) {
  return array(value).map((raw) => {
    const stage = record(raw);
    const explicitDetails = array(stage.question_details ?? stage.questionDetails);
    const rawQuestions = array(stage.questions);
    const objectQuestions = rawQuestions.filter(isRecord);
    return {
      id: valueText(stage, 'id'),
      startMinute: numberValue(stage.start_minute ?? stage.startMinute),
      durationMinutes: numberValue(stage.duration_minutes ?? stage.durationMinutes),
      stage: valueText(stage, 'stage'),
      engagementGoal: valueText(stage, 'engagement_goal', 'engagementGoal'),
      teacherActions: textArray(stage.teacher_actions ?? stage.teacherActions),
      teacherScript: valueText(stage, 'teacher_script', 'teacherScript'),
      studentActions: textArray(stage.student_actions ?? stage.studentActions),
      questionDetails: (explicitDetails.length ? explicitDetails : objectQuestions).map(normalizeQuestionDetail),
      questions: rawQuestions.filter((item) => !isRecord(item)).map(cleanText).filter(Boolean),
      expectedResponses: textArray(stage.expected_responses ?? stage.expectedResponses),
      misconceptions: textArray(stage.misconceptions),
      formativeAssessment: valueText(stage, 'formative_assessment', 'formativeAssessment'),
      fallbackStrategy: valueText(stage, 'fallback_strategy', 'fallbackStrategy'),
      sourceRefs: normalizeSourceRefs(stage.source_refs ?? stage.sourceRefs),
    };
  });
}

function normalizeQuestionDetail(raw) {
  const question = record(raw);
  return {
    prompt: valueText(question, 'prompt'),
    purpose: valueText(question, 'purpose'),
    expectedResponse: valueText(question, 'expected_response', 'expectedResponse'),
    followUp: valueText(question, 'follow_up', 'followUp'),
    sourceRefs: normalizeSourceRefs(question.source_refs ?? question.sourceRefs),
  };
}

function normalizeBoard(lesson) {
  const structured = record(
    lesson.board_design_structured
      ?? lesson.boardDesignStructured
      ?? (isRecord(lesson.board_design) ? lesson.board_design : null)
      ?? lesson.boardDesign,
  );
  return {
    structured: {
      layoutDescription: valueText(structured, 'layout_description', 'layoutDescription'),
      sections: array(structured.sections).map((raw) => {
        const section = record(raw);
        return {
          title: valueText(section, 'title'),
          position: valueText(section, 'position'),
          content: valueText(section, 'content'),
        };
      }),
    },
    fallback: typeof lesson.board_design === 'string'
      ? cleanText(lesson.board_design)
      : typeof lesson.boardDesign === 'string' ? cleanText(lesson.boardDesign) : '',
  };
}

function normalizeExercises(value) {
  return array(value).map((raw) => {
    const item = record(raw);
    const typeCode = valueText(item, 'type');
    return {
      id: valueText(item, 'id'),
      type: EXERCISE_TYPE_LABELS[typeCode] || (hasChinese(typeCode) ? typeCode : '其他题型'),
      typeCode,
      difficulty: numberValue(item.difficulty),
      knowledgePoints: textArray(item.knowledge_points ?? item.knowledgePoints),
      stem: valueText(item, 'stem'),
      options: array(item.options).map(normalizeOption).filter(Boolean),
      answer: valueText(item, 'answer'),
      explanation: valueText(item, 'explanation'),
      scoringRubric: valueText(item, 'scoring_rubric', 'scoringRubric'),
      estimatedMinutes: numberValue(item.estimated_minutes ?? item.estimatedMinutes),
      sourceRefs: normalizeSourceRefs(item.source_refs ?? item.sourceRefs),
    };
  });
}

function normalizeOption(option) {
  if (!isRecord(option)) return cleanText(option);
  const label = valueText(option, 'label', 'key');
  const content = valueText(option, 'content', 'text', 'value');
  return [label, content].filter(Boolean).join(' ').trim();
}

function normalizeCustomSections(value) {
  return array(value).map((raw, index) => {
    const item = record(raw);
    return {
      id: valueText(item, 'id') || `section-${index + 1}`,
      title: valueText(item, 'title') || `自定义模块 ${index + 1}`,
      content: valueText(item, 'content'),
    };
  });
}

function normalizeSourceRefs(value) {
  return array(value).map((raw) => {
    if (!isRecord(raw)) return { excerpt: cleanText(raw) };
    return {
      assetId: valueText(raw, 'asset_id', 'assetId', 'source_id', 'sourceId'),
      page: numberValue(raw.page),
      blockIds: textArray(raw.block_ids ?? raw.blockIds),
      excerpt: valueText(raw, 'excerpt'),
      fileName: valueText(raw, 'file_name', 'fileName', 'name'),
      title: valueText(raw, 'title'),
    };
  }).filter((item) => Object.values(item).some((entry) => Array.isArray(entry) ? entry.length : entry !== '' && entry !== null));
}

function collectVisibleTexts(value, parentKey, output) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text && !TECHNICAL_TEXT_KEYS.has(parentKey)) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVisibleTexts(item, parentKey, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) collectVisibleTexts(child, key, output);
}

function valueText(object, ...keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = cleanText(value);
      if (text) return text;
    }
  }
  return '';
}

function textList(value) {
  if (Array.isArray(value)) return textArray(value);
  const text = cleanText(value);
  return text ? [text] : [];
}

function textArray(value) {
  return array(value).map(cleanText).filter(Boolean);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function record(value) {
  return isRecord(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasMeaningfulValue(value) {
  const stack = [{ value, key: '' }];
  const seen = new WeakSet();
  while (stack.length) {
    const current = stack.pop();
    if (typeof current.value === 'string') {
      if (!NON_BODY_CONTENT_KEYS.has(current.key) && current.value.trim()) return true;
      continue;
    }
    if (typeof current.value === 'number' || typeof current.value === 'boolean') {
      if (!NON_BODY_CONTENT_KEYS.has(current.key)) return true;
      continue;
    }
    if (!current.value || typeof current.value !== 'object' || seen.has(current.value)) continue;
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, key: current.key });
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) stack.push({ value: child, key });
  }
  return false;
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(value || '');
}

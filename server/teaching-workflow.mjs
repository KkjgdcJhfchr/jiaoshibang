const MAX_QUESTIONS = 30;

export function buildKnowledgeMap(lessonPlan) {
  const metadata = lessonPlan.metadata || {};
  const chapter = text(metadata.chapter || metadata.title || lessonPlan.title || '当前教案', 200);
  const exercises = array(lessonPlan.exercises).slice(0, MAX_QUESTIONS);
  const pointNames = new Map();

  for (const name of [
    ...array(lessonPlan.keyPoints || lessonPlan.key_points),
    ...array(lessonPlan.difficultPoints || lessonPlan.difficult_points),
  ]) addPoint(pointNames, name, 0);

  exercises.forEach((question) => {
    const difficulty = boundedNumber(question.difficulty, 2, 1, 5);
    for (const name of array(question.knowledgePoints || question.knowledge_points)) {
      addPoint(pointNames, name, difficulty);
    }
  });

  if (!pointNames.size) {
    throw workflowError('KNOWLEDGE_POINTS_REQUIRED', '当前教案没有可用于构建图谱的知识点');
  }

  const nodes = [{
    id: 'lesson-root',
    kind: 'lesson',
    label: chapter,
    subject: text(metadata.subject, 80),
    grade: text(metadata.grade, 80),
    confidence: 1,
  }];
  const edges = [];
  const pointIdByName = new Map();

  [...pointNames.entries()].forEach(([name, stats], index) => {
    const pointId = `kp-${index + 1}`;
    pointIdByName.set(name, pointId);
    const averageDifficulty = stats.count ? stats.difficultyTotal / stats.count : 2;
    nodes.push({
      id: pointId,
      kind: 'knowledge_point',
      label: name,
      questionCount: stats.count,
      cognitiveLevel: cognitiveLevel(averageDifficulty),
      lessonPhase: lessonPhase(averageDifficulty),
      confidence: Number((stats.count ? Math.min(0.99, 0.76 + stats.count * 0.045) : 0.72).toFixed(2)),
    });
    edges.push({ id: `edge-lesson-${index + 1}`, from: 'lesson-root', to: pointId, relation: '教授' });
  });

  exercises.forEach((question, questionIndex) => {
    const questionId = `question-${questionIndex + 1}`;
    const knowledgePoints = array(question.knowledgePoints || question.knowledge_points)
      .map((item) => text(item, 120))
      .filter(Boolean);
    nodes.push({
      id: questionId,
      kind: 'question',
      label: text(question.stem, 160) || `习题 ${questionIndex + 1}`,
      type: text(question.type, 40) || '综合题',
      difficulty: boundedNumber(question.difficulty, 2, 1, 5),
      source: text(question.source, 80) || 'AI 原创题',
    });
    for (const point of knowledgePoints) {
      const pointId = pointIdByName.get(point);
      if (pointId) edges.push({ id: `edge-${pointId}-${questionId}`, from: pointId, to: questionId, relation: '考察于' });
    }
  });

  const taggedQuestions = exercises.filter((question) => array(question.knowledgePoints || question.knowledge_points).length).length;
  return {
    schemaVersion: 'teaching-knowledge-map.v1',
    lesson: { title: chapter, subject: text(metadata.subject, 80), grade: text(metadata.grade, 80) },
    nodes,
    edges,
    health: {
      knowledgePointCount: pointNames.size,
      questionCount: exercises.length,
      taggedQuestionRate: exercises.length ? Number((taggedQuestions / exercises.length).toFixed(2)) : 0,
      isolatedNodeCount: nodes.filter((node) => node.kind !== 'lesson' && !edges.some((edge) => edge.from === node.id || edge.to === node.id)).length,
      pendingConflicts: 0,
    },
  };
}

export function buildRecommendedPaper(lessonPlan, options = {}) {
  const metadata = lessonPlan.metadata || {};
  const sourceQuestions = array(lessonPlan.exercises).slice(0, MAX_QUESTIONS);
  if (sourceQuestions.length < 10) {
    throw workflowError('INSUFFICIENT_QUESTIONS', '当前教案至少需要 10 道完整习题后才能智能组卷');
  }
  const requestedCount = Math.min(
    sourceQuestions.length,
    boundedNumber(options.questionCount || options.count, 10, 10, MAX_QUESTIONS),
  );
  const preferredTypes = new Set(array(options.questionTypes).map((item) => text(item, 40)).filter(Boolean));

  const scored = sourceQuestions.map((question, index) => {
    const source = text(question.source, 80) || 'AI 原创题';
    const points = array(question.knowledgePoints || question.knowledge_points).map((item) => text(item, 120)).filter(Boolean);
    const type = text(question.type, 40) || '综合题';
    const relevance = Math.min(1, 0.68 + points.length * 0.08);
    const quality = sourceQuality(source);
    const preference = preferredTypes.size ? (preferredTypes.has(type) ? 1 : 0.62) : 0.82;
    const diversity = Math.max(0.65, 1 - index * 0.012);
    const recommendationScore = 0.4 * relevance + 0.3 * quality + 0.2 * preference + 0.1 * diversity;
    return {
      id: text(question.id, 80) || `recommended-${index + 1}`,
      stem: text(question.stem, 2_000),
      options: array(question.options).map((item) => text(item, 500)),
      answer: text(question.answer, 2_000),
      explanation: text(question.explanation || question.analysis, 4_000),
      type,
      difficulty: boundedNumber(question.difficulty, 2, 1, 5),
      source,
      knowledgePoints: points,
      recommendationScore: Number(recommendationScore.toFixed(3)),
      scoreBreakdown: {
        relevance: Number(relevance.toFixed(2)),
        quality: Number(quality.toFixed(2)),
        preference: Number(preference.toFixed(2)),
        diversity: Number(diversity.toFixed(2)),
      },
    };
  });

  const selected = scored
    .sort((left, right) => right.recommendationScore - left.recommendationScore)
    .slice(0, requestedCount)
    .sort((left, right) => difficultyBand(left.difficulty) - difficultyBand(right.difficulty)
      || left.difficulty - right.difficulty
      || left.type.localeCompare(right.type, 'zh-CN'));

  const pointCoverage = new Map();
  selected.forEach((question) => question.knowledgePoints.forEach((point) => pointCoverage.set(point, (pointCoverage.get(point) || 0) + 1)));
  const pointsPerQuestion = Math.max(1, Math.floor(100 / selected.length));
  const sections = [
    buildSection('基础巩固', selected.filter((question) => question.difficulty <= 2), pointsPerQuestion),
    buildSection('能力提升', selected.filter((question) => question.difficulty === 3), pointsPerQuestion),
    buildSection('综合应用', selected.filter((question) => question.difficulty >= 4), pointsPerQuestion),
  ].filter((section) => section.questions.length);

  return {
    schemaVersion: 'recommended-paper.v1',
    title: `${text(metadata.chapter || metadata.title, 160) || '当前章节'}同步练习`,
    subject: text(metadata.subject, 80),
    grade: text(metadata.grade, 80),
    questionCount: selected.length,
    totalScore: selected.length * pointsPerQuestion,
    durationMinutes: boundedNumber(options.durationMinutes, 45, 20, 180),
    sections,
    questions: selected,
    coverage: [...pointCoverage.entries()].map(([knowledgePoint, count]) => ({ knowledgePoint, count })),
    strategy: {
      formula: '0.4 × 相关性 + 0.3 × 质量度 + 0.2 × 教师偏好 + 0.1 × 多样性',
      ordering: '易 → 中 → 难，并优先保持题型交替',
      duplicateThreshold: 0.95,
      humanReviewRequired: true,
    },
  };
}

function buildSection(title, questions, pointsPerQuestion) {
  return { title, pointsPerQuestion, score: questions.length * pointsPerQuestion, questions: questions.map((question) => question.id) };
}

function addPoint(map, rawName, difficulty) {
  const name = text(rawName, 120);
  if (!name) return;
  const current = map.get(name) || { count: 0, difficultyTotal: 0 };
  if (difficulty > 0) {
    current.count += 1;
    current.difficultyTotal += difficulty;
  }
  map.set(name, current);
}

function cognitiveLevel(difficulty) {
  if (difficulty <= 1.5) return '记忆';
  if (difficulty <= 2.5) return '理解';
  if (difficulty <= 3.5) return '应用';
  return '创新';
}

function lessonPhase(difficulty) {
  if (difficulty <= 1.5) return '新课导入';
  if (difficulty <= 3) return '巩固练习';
  return '课后作业';
}

function difficultyBand(difficulty) {
  if (difficulty <= 2) return 0;
  if (difficulty === 3) return 1;
  return 2;
}

function sourceQuality(source) {
  if (/名校|真题/.test(source)) return 1;
  if (/教材|课本/.test(source)) return 0.9;
  if (/AI|原创/.test(source)) return 0.78;
  return 0.84;
}

function array(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function text(value, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '';
  return String(value).trim().slice(0, maxLength);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function workflowError(code, message) {
  const error = new Error(message);
  error.status = 422;
  error.code = code;
  return error;
}

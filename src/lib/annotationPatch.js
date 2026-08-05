const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function annotationPathTokens(path) {
  if (typeof path !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)) return null;
  const tokens = [];
  const matcher = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
  let match;
  while ((match = matcher.exec(path))) {
    const token = match[1] ?? Number(match[2]);
    if (typeof token === 'string' && BLOCKED_PATH_SEGMENTS.has(token)) return null;
    tokens.push(token);
  }
  return tokens.length ? tokens : null;
}

function valueAtPath(source, tokens) {
  let value = source;
  for (const token of tokens) {
    if (value === null || typeof value !== 'object' || !(token in value)) return { found: false };
    value = value[token];
  }
  return { found: true, value };
}

export function mergeAnnotationTargets(baseLesson, revisedLesson, targetPaths) {
  const candidate = structuredClone(baseLesson);
  const uniquePaths = [...new Set(Array.isArray(targetPaths) ? targetPaths : [])];
  for (const path of uniquePaths) {
    const tokens = annotationPathTokens(path);
    if (!tokens) continue;
    const revised = valueAtPath(revisedLesson, tokens);
    if (!revised.found) continue;
    let target = candidate;
    let valid = true;
    for (const token of tokens.slice(0, -1)) {
      if (target === null || typeof target !== 'object' || !(token in target)) {
        valid = false;
        break;
      }
      target = target[token];
    }
    if (!valid || target === null || typeof target !== 'object') continue;
    target[tokens.at(-1)] = structuredClone(revised.value);
  }
  return candidate;
}

export function formatStructuredBoard(board) {
  if (!board || typeof board !== 'object') return '';
  const lines = [];
  if (board.layout_description) lines.push(`整体布局：${board.layout_description}`);
  for (const section of board.sections || []) {
    const heading = [section.position ? `【${section.position}】` : '', section.title || '板书区域'].filter(Boolean).join(' ');
    lines.push(`${heading}${heading && section.content ? '：' : ''}${section.content || ''}`);
  }
  return lines.filter(Boolean).join('\n');
}

export function synchronizeAnnotationDerivedFields(lesson, targetPaths) {
  const next = structuredClone(lesson);
  if ((targetPaths || []).some((path) => path.startsWith('board_design_structured.'))) {
    next.board_design = formatStructuredBoard(next.board_design_structured);
  }
  return next;
}

export function isAnnotationPathAllowed(sectionKey, path, lesson = null) {
  if (typeof sectionKey !== 'string' || typeof path !== 'string' || !annotationPathTokens(path)) return false;
  const standard = {
    objectives: /^(source_summary|core_competencies|learning_objectives\[\d+\])$/,
    learner: /^(metadata\.class_profile|learner_analysis\.(class_characteristics|known|challenge|strategy))$/,
    keypoints: /^(key_points|difficult_points)$/,
    preparation: /^(preparation\.(teacher|students|materials)|safety_and_inclusion)$/,
    timeline: /^timeline\[\d+\]$/,
    interaction: /^(differentiation\.(support|standard|challenge)|assessment_plan\.(diagnostic|formative|summative|success_criteria))$/,
    board: /^(board_design|board_design_structured\.layout_description|board_design_structured\.sections\[\d+\])$/,
    homework: /^(homework\[\d+\]|reflection_prompts)$/,
    exercises: /^exercises\[\d+\]$/,
  };
  if (standard[sectionKey]) {
    if (!standard[sectionKey].test(path)) return false;
    return lesson ? valueAtPath(lesson, annotationPathTokens(path)).found : true;
  }
  if (!sectionKey.startsWith('custom:')) return false;
  const match = path.match(/^custom_sections\[(\d+)\]\.(title|content)$/);
  if (!match || !Array.isArray(lesson?.custom_sections)) return false;
  return lesson.custom_sections[Number(match[1])]?.id === sectionKey.slice(7);
}

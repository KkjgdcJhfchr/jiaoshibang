const PDF_MIME = 'application/pdf';
const MAX_PDF_OUTPUT_BYTES = 48 * 1024 * 1024;
const MAX_PDF_HTML_BYTES = 7 * 1024 * 1024;

export class LessonPdfExportError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'LessonPdfExportError';
    this.status = status;
    this.code = code;
    this.internalDetails = details;
  }
}

export function renderLessonPdfHtml(model) {
  const metadata = model?.metadata || {};
  const sections = Array.isArray(model?.sections) ? model.sections : [];
  const metaItems = [
    ['学科', metadata.subject],
    ['年级', metadata.grade],
    ['教材版本', metadata.textbookEdition],
    ['章节', metadata.chapter],
    ['课时', metadata.durationMinutes ? `${metadata.durationMinutes} 分钟` : ''],
    ['班级学情', metadata.classProfile],
  ].filter(([, value]) => visible(value));

  const sectionHtml = sections
    .map((section, index) => renderSection(section, index + 1))
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(model?.title || '教案')}</title>
  <style>${PDF_STYLES}</style>
</head>
<body>
  <header class="cover-block">
    <p class="kicker">课堂教学设计</p>
    <h1>${formatText(model?.title || '教案')}</h1>
    <div class="title-rule"></div>
    <dl class="metadata-grid">
      ${metaItems.map(([label, value]) => `<div><dt>${label}</dt><dd>${formatText(value)}</dd></div>`).join('')}
    </dl>
  </header>
  <main>${sectionHtml}</main>
</body>
</html>`;
}

export async function generateLessonPdf(model, {
  gotenbergUrl,
  timeoutMs = 120_000,
  requestId = '',
  fetchImpl = fetch,
} = {}) {
  if (!gotenbergUrl) {
    throw new LessonPdfExportError(503, 'PDF_EXPORT_NOT_CONFIGURED', 'PDF 导出服务尚未配置');
  }
  const html = renderLessonPdfHtml(model);
  if (Buffer.byteLength(html, 'utf8') > MAX_PDF_HTML_BYTES) {
    throw new LessonPdfExportError(
      413,
      'PDF_EXPORT_INPUT_TOO_LARGE',
      '教案内容过多，无法一次导出 PDF',
    );
  }
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html; charset=utf-8' }), 'index.html');
  form.append('preferCssPageSize', 'true');
  form.append('printBackground', 'true');
  form.append('emulatedMediaType', 'print');
  form.append('failOnConsoleExceptions', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${gotenbergUrl}/forms/chromium/convert/html`, {
        method: 'POST',
        headers: {
          ...(requestId ? { 'Gotenberg-Trace': requestId } : {}),
          'Gotenberg-Output-Filename': 'lesson-plan',
        },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new LessonPdfExportError(504, 'PDF_EXPORT_TIMEOUT', 'PDF 生成超时，请稍后重试');
      }
      throw new LessonPdfExportError(503, 'PDF_EXPORT_UNAVAILABLE', 'PDF 生成服务暂时不可用，请稍后重试');
    }

    if (!response.ok) {
      const upstreamMessage = (await response.text().catch(() => '')).trim().slice(0, 300);
      throw new LessonPdfExportError(
        response.status === 503 ? 503 : 502,
        'PDF_EXPORT_FAILED',
        'PDF 生成失败，请稍后重试',
        upstreamMessage ? { upstreamMessage } : undefined,
      );
    }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/pdf')) {
      throw new LessonPdfExportError(502, 'PDF_EXPORT_INVALID_RESPONSE', 'PDF 生成服务返回了无效文件');
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_PDF_OUTPUT_BYTES) {
      throw new LessonPdfExportError(502, 'PDF_EXPORT_TOO_LARGE', '生成的 PDF 文件过大，请精简教案后重试');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_OUTPUT_BYTES || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new LessonPdfExportError(502, 'PDF_EXPORT_INVALID_FILE', 'PDF 文件校验失败，请稍后重试');
    }
    return { buffer, mimeType: PDF_MIME };
  } finally {
    clearTimeout(timer);
  }
}

function renderSection(section, ordinal) {
  const heading = `<header class="section-heading"><span>${String(ordinal).padStart(2, '0')}</span><h2>${formatText(section?.title || '')}</h2></header>`;
  let body = '';
  if (section?.kind === 'objectives') body = renderObjectives(section.data);
  else if (section?.kind === 'learner') body = renderLearner(section.data);
  else if (section?.kind === 'keypoints') body = renderKeypoints(section.data);
  else if (section?.kind === 'preparation') body = renderPreparation(section.data);
  else if (section?.kind === 'timeline') body = renderTimeline(section.data);
  else if (section?.kind === 'interaction') body = renderInteraction(section.data);
  else if (section?.kind === 'board') body = renderBoard(section.data);
  else if (section?.kind === 'homework') body = renderHomework(section.data);
  else if (section?.kind === 'exercises') body = renderExercises(section.data);
  else if (section?.kind === 'custom') body = `<div class="prose-card">${formatText(section.data?.content || '')}</div>`;
  return `<section class="lesson-section lesson-${escapeAttribute(section?.kind || 'custom')}">${heading}${body || '<p class="empty">暂无内容</p>'}</section>`;
}

function renderObjectives(data = {}) {
  const objectives = array(data.objectives);
  return `
    ${visible(data.sourceSummary) ? `<div class="summary-card"><b>章节内容概述</b><p>${formatText(data.sourceSummary)}</p></div>` : ''}
    ${array(data.coreCompetencies).length ? `<div class="competency-strip"><b>核心素养</b>${pillList(data.coreCompetencies)}</div>` : ''}
    <div class="objective-list">${objectives.map((item) => `
      <article class="objective-item">
        <span class="objective-type">${formatText(item.type || '教学目标')}</span>
        <div class="objective-copy"><p>${formatText(item.content)}</p>
          ${visible(item.measurableEvidence) ? `<div class="evidence"><b>达成证据</b><span>${formatText(item.measurableEvidence)}</span></div>` : ''}
          ${renderSourceRefs(item.sourceRefs)}
        </div>
      </article>`).join('')}</div>`;
}

function renderLearner(data = {}) {
  const rows = [
    ['班级整体情况', data.classProfile],
    ['班级学习特征', data.classCharacteristics],
    ['已有基础', data.currentKnowledge],
    ['学习挑战', array(data.challenges)],
    ['教学策略', array(data.strategies)],
  ];
  return `<div class="label-detail-list">${rows.filter(([, value]) => hasContent(value)).map(([label, value]) => labelDetail(label, value)).join('')}</div>`;
}

function renderKeypoints(data = {}) {
  return `<div class="two-column-grid">
    ${featureCard('教学重点', data.keyPoints, 'accent')}
    ${featureCard('教学难点', data.difficultPoints, 'warm')}
  </div>`;
}

function renderPreparation(data = {}) {
  return `<div class="three-column-grid">
    ${featureCard('教师准备', data.teacher)}
    ${featureCard('学生准备', data.students)}
    ${featureCard('教学材料', data.materials)}
  </div>
  ${array(data.safetyAndInclusion).length ? `<div class="safety-card"><b>课堂安全与包容</b>${bulletList(data.safetyAndInclusion)}</div>` : ''}`;
}

function renderTimeline(data = {}) {
  return `<div class="timeline-stack">${array(data.stages).map((stage, index) => `
    <article class="stage-card">
      <header class="stage-header">
        <div><span>环节 ${index + 1}</span><h3>${formatText(stage.stage || `教学环节 ${index + 1}`)}</h3></div>
        <p><b>${numberOrZero(stage.startMinute)}—${numberOrZero(stage.startMinute) + numberOrZero(stage.durationMinutes)} 分钟</b><small>共 ${numberOrZero(stage.durationMinutes)} 分钟</small></p>
      </header>
      ${visible(stage.engagementGoal) ? `<div class="goal-banner"><b>参与目标</b>${formatText(stage.engagementGoal)}</div>` : ''}
      <div class="stage-grid">
        <div>${detailGroup('教师活动', bulletList(stage.teacherActions))}${detailGroup('讲解话术', textBlock(stage.teacherScript), 'script')}</div>
        <div>${detailGroup('学生活动', bulletList(stage.studentActions))}${detailGroup('形成性评价', textBlock(stage.formativeAssessment))}</div>
      </div>
      ${renderQuestions(stage)}
      <div class="stage-grid stage-grid-secondary">
        <div>${detailGroup('预期回应', bulletList(stage.expectedResponses))}${detailGroup('常见误区', bulletList(stage.misconceptions))}</div>
        <div>${detailGroup('备用策略', textBlock(stage.fallbackStrategy))}${renderSourceRefs(stage.sourceRefs)}</div>
      </div>
    </article>`).join('')}</div>`;
}

function renderQuestions(stage) {
  const details = array(stage.questionDetails);
  const simple = array(stage.questions);
  if (!details.length && !simple.length) return '';
  return `<div class="question-box"><b class="question-box-title">课堂提问</b>
    ${details.map((question, index) => `<article class="question-detail"><h4>提问 ${index + 1}　${formatText(question.prompt)}</h4>
      ${visible(question.purpose) ? labelLine('提问目的', question.purpose) : ''}
      ${visible(question.expectedResponse) ? labelLine('预期回答', question.expectedResponse) : ''}
      ${visible(question.followUp) ? labelLine('继续追问', question.followUp) : ''}
      ${renderSourceRefs(question.sourceRefs)}</article>`).join('')}
    ${simple.length ? bulletList(simple) : ''}
  </div>`;
}

function renderInteraction(data = {}) {
  const differentiation = data.differentiation || {};
  const assessment = data.assessmentPlan || {};
  return `<h3 class="subheading">分层教学</h3><div class="three-column-grid">
    ${featureCard('基础支持', differentiation.support)}
    ${featureCard('常规任务', differentiation.standard)}
    ${featureCard('拓展挑战', differentiation.challenge)}
  </div><h3 class="subheading">学习评价方案</h3><div class="two-column-grid assessment-grid">
    ${featureCard('课前诊断', assessment.diagnostic)}
    ${featureCard('过程评价', assessment.formative)}
    ${featureCard('总结评价', assessment.summative)}
    ${featureCard('达成标准', assessment.successCriteria, 'accent')}
  </div>`;
}

function renderBoard(data = {}) {
  const structured = data.structured || {};
  const sections = array(structured.sections);
  if (!visible(structured.layoutDescription) && !sections.length) {
    return visible(data.fallback) ? `<pre class="board-fallback">${formatText(data.fallback)}</pre>` : '';
  }
  return `${visible(structured.layoutDescription) ? `<div class="summary-card"><b>整体布局</b><p>${formatText(structured.layoutDescription)}</p></div>` : ''}
    <div class="board-grid">${sections.map((item) => `<article>
      <div class="board-meta"><span><b>区域标题</b>${formatText(item.title)}</span><span><b>位置</b>${formatText(item.position)}</span></div>
      <div class="board-content">${formatText(item.content)}</div>
    </article>`).join('')}</div>`;
}

function renderHomework(data = {}) {
  return `<div class="homework-list">${array(data.items).map((item, index) => `<article class="homework-card">
    <span>${formatText(item.level || `任务 ${index + 1}`)}</span><div><p>${formatText(item.content)}</p>
      <dl>${visible(item.estimatedMinutes) ? `<div><dt>建议用时</dt><dd>${numberOrZero(item.estimatedMinutes)} 分钟</dd></div>` : ''}${visible(item.answerGuidance) ? `<div><dt>完成指导</dt><dd>${formatText(item.answerGuidance)}</dd></div>` : ''}</dl>
      ${renderSourceRefs(item.sourceRefs)}</div></article>`).join('')}</div>
    ${array(data.reflectionPrompts).length ? `<div class="reflection-card"><b>课后反思提示</b>${bulletList(data.reflectionPrompts)}</div>` : ''}`;
}

function renderExercises(data = {}) {
  return `<div class="exercise-list">${array(data.items).map((item, index) => `<article class="exercise-card">
    <header><span>${index + 1}</span><div><h3>${formatText(item.stem)}</h3><p>${formatText(item.type || '习题')}${visible(item.difficulty) ? ` · 难度 ${numberOrZero(item.difficulty)}/5` : ''}${visible(item.estimatedMinutes) ? ` · 建议 ${numberOrZero(item.estimatedMinutes)} 分钟` : ''}${array(item.knowledgePoints).length ? ` · 知识点：${item.knowledgePoints.map(formatText).join('、')}` : ''}</p></div></header>
    ${array(item.options).length ? `<div class="options">${item.options.map((option, optionIndex) => `<p><b>${String.fromCharCode(65 + optionIndex)}</b>${formatText(option)}</p>`).join('')}</div>` : ''}
    <div class="answer-grid">${visible(item.answer) ? labelDetail('参考答案', item.answer) : ''}${visible(item.explanation) ? labelDetail('解析', item.explanation) : ''}${visible(item.scoringRubric) ? labelDetail('评分标准', item.scoringRubric) : ''}</div>
    ${renderSourceRefs(item.sourceRefs)}
  </article>`).join('')}</div>`;
}

function detailGroup(label, contents, extraClass = '') {
  if (!contents) return '';
  return `<section class="detail-group ${extraClass}"><b>${label}</b>${contents}</section>`;
}

function labelDetail(label, value) {
  const content = Array.isArray(value) ? bulletList(value) : formatText(value);
  return `<div class="label-detail"><b>${label}</b><div>${content}</div></div>`;
}

function labelLine(label, value) {
  return `<p class="label-line"><b>${label}</b><span>${formatText(value)}</span></p>`;
}

function featureCard(label, values, modifier = '') {
  const content = Array.isArray(values) ? bulletList(values) : textBlock(values);
  return `<article class="feature-card ${modifier}"><b>${label}</b>${content || '<p class="empty">暂无内容</p>'}</article>`;
}

function renderSourceRefs(refs) {
  const items = array(refs).map((reference) => {
    const sourceNames = [reference.fileName, reference.title]
      .filter(visible)
      .filter((value, index, values) => values.indexOf(value) === index);
    const location = [...sourceNames, visible(reference.page) ? `第 ${numberOrZero(reference.page)} 页` : ''].filter(Boolean).join(' · ');
    const parts = [location, reference.excerpt].filter(visible);
    return parts.length ? parts.join('：') : '';
  }).filter(Boolean);
  return items.length ? `<div class="source-refs"><b>教材依据</b>${bulletList(items)}</div>` : '';
}

function bulletList(items) {
  const normalized = array(items).filter(visible);
  return normalized.length ? `<ul>${normalized.map((item) => `<li>${formatText(item)}</li>`).join('')}</ul>` : '';
}

function pillList(items) {
  return `<div>${array(items).filter(visible).map((item) => `<span>${formatText(item)}</span>`).join('')}</div>`;
}

function textBlock(value) {
  return visible(value) ? `<p>${formatText(value)}</p>` : '';
}

function formatText(value) {
  return escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '-');
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function visible(value) {
  if (value === 0) return true;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function hasContent(value) {
  return Array.isArray(value) ? value.some(visible) : visible(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

const PDF_STYLES = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #21302c; background: #fff; font-family: "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 10.2pt; line-height: 1.68; overflow-wrap: anywhere; }
  p, li, dd { orphans: 3; widows: 3; }
  p, ul, dl { margin: 0; }
  ul { padding-left: 1.25em; }
  li + li { margin-top: 2.5pt; }
  b { font-weight: 700; }
  .cover-block { padding: 7mm 0 5mm; border-bottom: 2px solid #24342f; }
  .kicker { margin: 0 0 5pt; color: #35897b; font-size: 9pt; font-weight: 800; letter-spacing: .18em; }
  h1 { margin: 0; color: #18231f; font-family: "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", serif; font-size: 23pt; line-height: 1.35; font-weight: 800; }
  .title-rule { width: 44px; height: 3px; margin: 11pt 0 12pt; background: #35897b; }
  .metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5pt 18pt; }
  .metadata-grid > div { display: grid; grid-template-columns: 62pt minmax(0,1fr); gap: 7pt; border-bottom: 1px solid #dce5e1; padding: 3pt 0 4pt; }
  .metadata-grid dt { color: #6b7d76; font-size: 8.5pt; font-weight: 700; }
  .metadata-grid dd { margin: 0; font-weight: 600; }
  .lesson-section { margin-top: 21pt; }
  .section-heading { display: flex; align-items: center; gap: 9pt; margin: 0 0 11pt; break-after: avoid-page; page-break-after: avoid; }
  .section-heading > span { display: inline-flex; align-items: center; justify-content: center; width: 24pt; height: 24pt; border-radius: 50%; color: #fff; background: #35897b; font-size: 8.5pt; font-weight: 800; }
  h2 { margin: 0; color: #18231f; font-family: "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", serif; font-size: 16pt; line-height: 1.3; }
  h3, h4 { break-after: avoid-page; page-break-after: avoid; }
  .subheading { margin: 13pt 0 7pt; color: #26443c; font-size: 11.5pt; }
  .summary-card, .prose-card, .safety-card, .reflection-card { padding: 10pt 12pt; border: 1px solid #d7e2dd; border-radius: 7pt; background: #fbfcfb; }
  .summary-card b, .safety-card > b, .reflection-card > b { display: block; margin-bottom: 4pt; color: #2d776b; }
  .competency-strip { display: flex; align-items: flex-start; gap: 10pt; margin: 8pt 0; padding: 8pt 10pt; border-radius: 6pt; background: #eff6f3; }
  .competency-strip > b { flex: 0 0 auto; color: #2d776b; }
  .competency-strip > div { display: flex; flex-wrap: wrap; gap: 4pt; }
  .competency-strip span { padding: 1.5pt 6pt; border: 1px solid #c7ddd6; border-radius: 10pt; background: #fff; font-size: 8.5pt; }
  .objective-list { margin-top: 8pt; border-top: 1px solid #d8e2de; }
  .objective-item { display: grid; grid-template-columns: 72pt minmax(0,1fr); gap: 11pt; padding: 9pt 0; border-bottom: 1px solid #d8e2de; break-inside: avoid-page; page-break-inside: avoid; }
  .objective-type { align-self: start; padding: 4pt 6pt; border-radius: 5pt; color: #1f6f62; background: #e7f3ef; text-align: center; font-size: 8.5pt; font-weight: 800; }
  .objective-copy > p { font-size: 10.5pt; }
  .evidence { display: grid; grid-template-columns: 58pt minmax(0,1fr); gap: 7pt; margin-top: 5pt; padding-top: 5pt; border-top: 1px dashed #d8e2de; color: #64756f; font-size: 8.5pt; }
  .evidence b { color: #2d776b; }
  .label-detail-list, .answer-grid { border: 1px solid #d7e2dd; border-radius: 7pt; overflow: hidden; }
  .label-detail { display: grid; grid-template-columns: 92pt minmax(0,1fr); gap: 10pt; padding: 8pt 10pt; background: #fff; }
  .label-detail + .label-detail { border-top: 1px solid #e0e7e4; }
  .label-detail > b { color: #2d776b; }
  .two-column-grid, .three-column-grid, .stage-grid, .board-grid { display: grid; gap: 8pt; }
  .two-column-grid, .stage-grid, .board-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .three-column-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .feature-card { min-width: 0; padding: 9pt 10pt; border: 1px solid #d7e2dd; border-radius: 7pt; background: #fbfcfb; break-inside: avoid-page; page-break-inside: avoid; }
  .feature-card > b { display: block; margin-bottom: 4pt; color: #2d776b; }
  .feature-card.accent { border-top: 3px solid #35897b; }
  .feature-card.warm { border-top: 3px solid #c9974c; }
  .safety-card, .reflection-card { margin-top: 8pt; }
  .timeline-stack { display: grid; gap: 10pt; }
  .stage-card { border: 1px solid #cfdcd7; border-radius: 8pt; overflow: hidden; background: #fff; }
  .stage-header { display: flex; justify-content: space-between; gap: 12pt; align-items: center; padding: 8pt 10pt; color: #fff; background: #2b4a42; break-after: avoid-page; page-break-after: avoid; }
  .stage-header > div { display: flex; align-items: center; gap: 8pt; min-width: 0; }
  .stage-header span { color: #b9d8cf; font-size: 8pt; font-weight: 700; }
  .stage-header h3 { margin: 0; font-size: 12pt; line-height: 1.35; }
  .stage-header > p { flex: 0 0 auto; text-align: right; }
  .stage-header small { display: block; color: #c7ddd6; font-size: 7.5pt; }
  .goal-banner { display: grid; grid-template-columns: 58pt minmax(0,1fr); gap: 8pt; padding: 7pt 10pt; color: #2d5147; background: #eaf4f0; }
  .stage-grid { padding: 8pt 10pt 0; }
  .stage-grid-secondary { padding-bottom: 9pt; }
  .detail-group { margin-bottom: 8pt; }
  .detail-group > b { display: block; margin-bottom: 3pt; color: #2d776b; font-size: 8.5pt; }
  .detail-group.script { padding: 7pt 8pt; border-left: 3px solid #7baea2; background: #f5f9f7; }
  .question-box { margin: 2pt 10pt 0; padding: 8pt 9pt; border: 1px solid #ead7b4; border-radius: 6pt; background: #fffaf1; }
  .question-box-title { display: block; margin-bottom: 4pt; color: #8a6326; }
  .question-detail + .question-detail { margin-top: 6pt; padding-top: 6pt; border-top: 1px dashed #dec89f; }
  .question-detail h4 { margin: 0 0 4pt; font-size: 9.5pt; }
  .label-line { display: grid; grid-template-columns: 58pt minmax(0,1fr); gap: 6pt; font-size: 8.5pt; }
  .label-line b { color: #8a6326; }
  .source-refs { margin-top: 5pt; padding-top: 5pt; border-top: 1px dashed #d6dfdc; color: #667671; font-size: 7.8pt; }
  .source-refs > b { color: #2d776b; }
  .source-refs ul { margin-top: 2pt; }
  .board-grid article { min-width: 0; padding: 10pt; border-radius: 7pt; color: #eff7f4; background: #24342f; break-inside: avoid-page; page-break-inside: avoid; }
  .board-meta { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 5pt; padding-bottom: 6pt; border-bottom: 1px solid rgba(255,255,255,.18); font-size: 8pt; }
  .board-meta span { display: grid; grid-template-columns: 46pt minmax(0,1fr); gap: 4pt; }
  .board-meta b { color: #add0c6; }
  .board-content { padding-top: 7pt; white-space: pre-wrap; }
  .board-fallback { margin: 0; padding: 11pt; border-radius: 7pt; color: #eff7f4; background: #24342f; white-space: pre-wrap; font: inherit; }
  .homework-list { display: grid; gap: 7pt; }
  .homework-card { display: grid; grid-template-columns: 74pt minmax(0,1fr); gap: 10pt; padding: 9pt 10pt; border: 1px solid #d7e2dd; border-radius: 7pt; break-inside: avoid-page; page-break-inside: avoid; }
  .homework-card > span { align-self: start; padding: 4pt 5pt; border-radius: 5pt; color: #1f6f62; background: #e7f3ef; text-align: center; font-weight: 800; }
  .homework-card dl { display: grid; gap: 3pt; margin-top: 5pt; color: #65756f; font-size: 8.5pt; }
  .homework-card dl > div { display: grid; grid-template-columns: 58pt minmax(0,1fr); gap: 7pt; }
  .homework-card dt { color: #2d776b; font-weight: 700; }
  .homework-card dd { margin: 0; }
  .exercise-list { display: grid; gap: 8pt; }
  .exercise-card { border: 1px solid #d7e2dd; border-radius: 7pt; overflow: hidden; }
  .exercise-card > header { display: grid; grid-template-columns: 25pt minmax(0,1fr); gap: 8pt; align-items: start; padding: 8pt 10pt; background: #f4f8f6; break-after: avoid-page; page-break-after: avoid; }
  .exercise-card > header > span { display: flex; align-items: center; justify-content: center; width: 22pt; height: 22pt; border-radius: 50%; color: #1f6f62; background: #e3efeb; font-weight: 800; }
  .exercise-card h3 { margin: 0; color: #17231f; font-size: 10.5pt; }
  .exercise-card header p { margin-top: 2pt; color: #708079; font-size: 7.8pt; }
  .options { display: grid; gap: 4pt; padding: 8pt 10pt; }
  .options p { display: grid; grid-template-columns: 20pt minmax(0,1fr); gap: 5pt; }
  .options b { display: flex; align-items: center; justify-content: center; height: 18pt; border-radius: 50%; color: #2d776b; background: #edf5f2; font-size: 8pt; }
  .exercise-card .answer-grid { margin: 0 10pt 9pt; }
  .exercise-card .answer-grid .label-detail { grid-template-columns: 70pt minmax(0,1fr); padding: 6pt 8pt; }
  .exercise-card > .source-refs { margin: 0 10pt 9pt; }
  .empty { color: #8a9792; }
  @media print {
    body { background: #fff; }
    .lesson-section:first-child { margin-top: 18pt; }
  }
`;

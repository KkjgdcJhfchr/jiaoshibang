import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LevelFormat,
  LineRuleType,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

// compact_reference_guide_a4: the compact reference preset with an explicit
// A4/1.6 cm page-geometry override for a classroom-ready Chinese lesson plan.
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 907;
const TABLE_INDENT = 120;
const TABLE_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2) - TABLE_INDENT;
const LABEL_WIDTH = 1660;
const DETAIL_WIDTH = TABLE_WIDTH - LABEL_WIDTH;
const FONT_SANS = {
  ascii: 'Microsoft YaHei',
  hAnsi: 'Microsoft YaHei',
  eastAsia: 'Microsoft YaHei',
  cs: 'Microsoft YaHei',
};
const FONT_SERIF = {
  ascii: 'SimSun',
  hAnsi: 'SimSun',
  eastAsia: 'SimSun',
  cs: 'SimSun',
};
const COLORS = {
  ink: '18322B',
  body: '243832',
  accent: '2F7F73',
  accentDark: '245F57',
  muted: '667873',
  border: 'CCD9D5',
  pale: 'EAF4F1',
  paleGold: 'F8F2E5',
  white: 'FFFFFF',
};
const CELL_MARGINS = { top: 100, bottom: 100, left: 120, right: 120 };
const GRID_BORDER = { style: BorderStyle.SINGLE, size: 6, color: COLORS.border };
const TABLE_BORDERS = {
  top: GRID_BORDER,
  bottom: GRID_BORDER,
  left: GRID_BORDER,
  right: GRID_BORDER,
  insideHorizontal: GRID_BORDER,
  insideVertical: GRID_BORDER,
};
const NO_BORDER = { style: BorderStyle.NIL, size: 0, color: COLORS.white };
const NO_TABLE_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
};
const NO_CELL_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
};

export async function generateLessonDocx(model) {
  const exportModel = isRecord(model) ? model : {};
  const children = [];
  addOpeningBlock(children, exportModel);

  for (const rawSection of array(exportModel.sections)) {
    const section = isRecord(rawSection) ? rawSection : {};
    children.push(sectionHeading(section.title || '未命名模块'));
    addSection(children, section);
  }

  const document = new Document({
    creator: '',
    title: clean(exportModel.title) || '教案',
    subject: '课时教学设计',
    description: '课时教学设计',
    styles: buildStyles(),
    numbering: {
      config: [
        {
          reference: 'lesson-bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              run: { font: FONT_SANS, size: 20, color: COLORS.accentDark },
              paragraph: {
                indent: { left: 540, hanging: 270 },
                spacing: { after: 80, line: 300, lineRule: LineRuleType.AUTO },
              },
            },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: PageOrientation.PORTRAIT },
          margin: {
            top: PAGE_MARGIN,
            right: PAGE_MARGIN,
            bottom: PAGE_MARGIN,
            left: PAGE_MARGIN,
            header: 420,
            footer: 500,
            gutter: 0,
          },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({
              children: [PageNumber.CURRENT],
              font: FONT_SANS,
              size: 18,
              color: COLORS.muted,
            })],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(document);
}

function buildStyles() {
  return {
    default: {
      document: {
        run: { font: FONT_SANS, size: 21, color: COLORS.body, language: { eastAsia: 'zh-CN' } },
        paragraph: {
          spacing: { before: 0, after: 120, line: 300, lineRule: LineRuleType.AUTO },
          widowControl: true,
        },
      },
      title: {
        run: { font: FONT_SANS, size: 56, bold: true, color: COLORS.ink },
        paragraph: { spacing: { before: 0, after: 160 }, keepNext: true },
      },
      heading1: {
        run: { font: FONT_SANS, size: 32, bold: true, color: COLORS.accentDark },
        paragraph: { spacing: { before: 360, after: 200 }, keepNext: true, keepLines: true, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT_SANS, size: 26, bold: true, color: COLORS.accentDark },
        paragraph: { spacing: { before: 280, after: 140 }, keepNext: true, keepLines: true, outlineLevel: 1 },
      },
      heading3: {
        run: { font: FONT_SANS, size: 24, bold: true, color: COLORS.ink },
        paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, keepLines: true, outlineLevel: 2 },
      },
    },
    paragraphStyles: [
      {
        id: 'LessonKicker',
        name: '课时教学设计标签',
        basedOn: 'Normal',
        next: 'LessonTitle',
        run: { font: FONT_SANS, size: 19, bold: true, color: COLORS.accent, characterSpacing: 30 },
        paragraph: { spacing: { before: 0, after: 70 }, keepNext: true },
      },
      {
        id: 'LessonTitle',
        name: '教案标题',
        basedOn: 'Title',
        next: 'Normal',
        run: { font: FONT_SERIF, size: 54, bold: true, color: COLORS.ink },
        paragraph: { spacing: { before: 0, after: 220 }, keepNext: true, keepLines: true, outlineLevel: 0 },
      },
      {
        id: 'LessonSection',
        name: '教案一级标题',
        basedOn: 'Heading1',
        next: 'Normal',
        run: { font: FONT_SANS, size: 32, bold: true, color: COLORS.accentDark },
        paragraph: {
          spacing: { before: 360, after: 200 },
          keepNext: true,
          keepLines: true,
          outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.border, space: 6 } },
        },
      },
      {
        id: 'LessonSubheading',
        name: '教案二级标题',
        basedOn: 'Heading2',
        next: 'Normal',
        run: { font: FONT_SANS, size: 25, bold: true, color: COLORS.accentDark },
        paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 1 },
      },
      {
        id: 'LessonBody',
        name: '教案正文',
        basedOn: 'Normal',
        next: 'LessonBody',
        run: { font: FONT_SANS, size: 21, color: COLORS.body },
        paragraph: { spacing: { before: 0, after: 120, line: 300, lineRule: LineRuleType.AUTO }, widowControl: true },
      },
      {
        id: 'LessonMuted',
        name: '教案辅助文字',
        basedOn: 'Normal',
        next: 'LessonBody',
        run: { font: FONT_SANS, size: 18, color: COLORS.muted },
        paragraph: { spacing: { before: 0, after: 80, line: 280, lineRule: LineRuleType.AUTO } },
      },
    ],
  };
}

function addOpeningBlock(children, model) {
  children.push(new Paragraph({ style: 'LessonKicker', text: '课时教学设计' }));
  children.push(new Paragraph({ style: 'LessonTitle', text: clean(model.title) || '教案' }));

  const metadata = record(model.metadata);
  const entries = [
    ['学科 / 年级', joinTruthy([metadata.subject, metadata.grade], ' · ')],
    ['教材版本', metadata.textbookEdition],
    ['章节', metadata.chapter],
    ['课时', metadata.durationMinutes === null || metadata.durationMinutes === undefined || metadata.durationMinutes === ''
      ? '' : `${metadata.durationMinutes} 分钟`],
  ];
  const widths = [2100, 1900, 3600, TABLE_WIDTH - 7600];
  children.push(new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    indent: { size: TABLE_INDENT, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: NO_TABLE_BORDERS,
    margins: CELL_MARGINS,
    rows: [new TableRow({
      children: entries.map(([label, value], index) => new TableCell({
        width: { size: widths[index], type: WidthType.DXA },
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: index % 2 ? COLORS.paleGold : COLORS.pale, color: 'auto' },
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
        children: [
          textParagraph(label, { size: 17, bold: true, color: COLORS.accentDark, after: 40 }),
          textParagraph(value || '—', { size: 20, bold: true, color: COLORS.ink, after: 0 }),
        ],
      })),
    })],
  }));
  children.push(spacer(80));
}

function addSection(children, section) {
  const data = record(section.data);
  switch (section.kind) {
    case 'objectives': return addObjectives(children, data);
    case 'learner': return addLearner(children, data);
    case 'keypoints': return addKeyPoints(children, data);
    case 'preparation': return addPreparation(children, data);
    case 'timeline': return addTimeline(children, data);
    case 'interaction': return addInteraction(children, data);
    case 'board': return addBoard(children, data);
    case 'homework': return addHomework(children, data);
    case 'exercises': return addExercises(children, data);
    case 'custom': return addCustom(children, data);
    default: return addGenericValue(children, data);
  }
}

function addObjectives(children, data) {
  if (clean(data.sourceSummary)) {
    children.push(callout('章节内容概述', data.sourceSummary, COLORS.pale));
  }
  if (array(data.coreCompetencies).length) {
    children.push(labelDetailTable([['核心素养', bulletParagraphs(data.coreCompetencies)]]));
    children.push(spacer());
  }
  const objectives = array(data.objectives);
  objectives.forEach((objective, index) => {
    const item = record(objective);
    const rows = [
      ['目标类型', clean(item.type) || '教学目标'],
      ['目标内容', item.content],
      ['达成证据', item.measurableEvidence],
    ];
    const sourceLines = sourceRefLines(item.sourceRefs);
    if (sourceLines.length) rows.push(['教材依据', sourceLines.map((text) => bodyParagraph(text, 50))]);
    children.push(labelDetailTable(rows.filter(([, value]) => hasContent(value)), {
      labelFill: COLORS.pale,
      topAccent: true,
      keepTogether: true,
    }));
    if (index < objectives.length - 1) children.push(spacer(100));
  });
  if (!clean(data.sourceSummary) && !array(data.coreCompetencies).length && !objectives.length) addEmpty(children);
}

function addLearner(children, data) {
  const rows = [
    ['班级画像', data.classProfile],
    ['班级特点', data.classCharacteristics],
    ['现有基础', data.currentKnowledge],
    ['学习难点', bulletParagraphs(data.challenges)],
    ['教学策略', bulletParagraphs(data.strategies)],
  ].filter(([, value]) => hasContent(value));
  if (rows.length) children.push(labelDetailTable(rows)); else addEmpty(children);
}

function addKeyPoints(children, data) {
  const left = titledCellContent('教学重点', data.keyPoints);
  const right = titledCellContent('教学难点', data.difficultPoints);
  if (!array(data.keyPoints).length && !array(data.difficultPoints).length) return addEmpty(children);
  children.push(twoColumnTable(left, right));
}

function addPreparation(children, data) {
  const rows = [
    ['教师准备', bulletParagraphs(data.teacher)],
    ['学生准备', bulletParagraphs(data.students)],
    ['教材与工具', bulletParagraphs(data.materials)],
    ['安全与包容', bulletParagraphs(data.safetyAndInclusion)],
  ].filter(([, value]) => hasContent(value));
  if (rows.length) children.push(labelDetailTable(rows)); else addEmpty(children);
}

function addTimeline(children, data) {
  const stages = array(data.stages);
  if (!stages.length) return addEmpty(children);
  stages.forEach((rawStage, index) => {
    const stage = record(rawStage);
    const rows = [
      ['参与目标', stage.engagementGoal],
      ['教师活动', bulletParagraphs(stage.teacherActions)],
      ['讲解话术', stage.teacherScript],
      ['学生活动', bulletParagraphs(stage.studentActions)],
      ['核心提问', bulletParagraphs(stage.questions)],
      ['追问设计', questionDetailParagraphs(stage.questionDetails)],
      ['预期回应', bulletParagraphs(stage.expectedResponses)],
      ['常见误区', bulletParagraphs(stage.misconceptions)],
      ['形成性评价', stage.formativeAssessment],
      ['备用策略', stage.fallbackStrategy],
      ['教材依据', sourceRefLines(stage.sourceRefs).map((text) => bodyParagraph(text, 50))],
    ].filter(([, value]) => hasContent(value));
    children.push(headedDetailTable(stage.stage || '教学环节', timeRange(stage), rows, { labelFill: 'F3F7F6' }));
    if (index < stages.length - 1) children.push(spacer(180));
  });
}

function addInteraction(children, data) {
  const differentiation = record(data.differentiation);
  if (array(differentiation.support).length || array(differentiation.standard).length || array(differentiation.challenge).length) {
    children.push(subheading('分层学习支持'));
    children.push(threeColumnTable([
      titledCellContent('基础支持', differentiation.support),
      titledCellContent('常规任务', differentiation.standard),
      titledCellContent('拓展挑战', differentiation.challenge),
    ]));
    children.push(spacer(100));
  }
  const assessment = record(data.assessmentPlan);
  const rows = [
    ['诊断性评价', bulletParagraphs(assessment.diagnostic)],
    ['形成性评价', bulletParagraphs(assessment.formative)],
    ['总结性评价', bulletParagraphs(assessment.summative)],
    ['成功标准', bulletParagraphs(assessment.successCriteria)],
  ].filter(([, value]) => hasContent(value));
  if (rows.length) {
    children.push(subheading('评价安排'));
    children.push(labelDetailTable(rows));
  }
  if (!rows.length && !array(differentiation.support).length && !array(differentiation.standard).length && !array(differentiation.challenge).length) addEmpty(children);
}

function addBoard(children, data) {
  const structured = record(data.structured);
  if (clean(structured.layoutDescription)) children.push(callout('整体布局', structured.layoutDescription, 'F3F7F6'));
  const sections = array(structured.sections);
  for (const raw of sections) {
    const item = record(raw);
    const title = joinTruthy([item.title, item.position ? `位置：${item.position}` : ''], ' · ') || '板书区域';
    children.push(stageBand(title, ''));
    addMultilineBody(children, item.content);
    children.push(spacer(100));
  }
  if (clean(data.fallback)) {
    if (sections.length) children.push(subheading('板书文字稿'));
    children.push(callout('板书内容', data.fallback, COLORS.pale));
  }
  if (!clean(structured.layoutDescription) && !sections.length && !clean(data.fallback)) addEmpty(children);
}

function addHomework(children, data) {
  const items = array(data.items);
  for (const raw of items) {
    const item = record(raw);
    const time = item.estimatedMinutes === null || item.estimatedMinutes === undefined || item.estimatedMinutes === ''
      ? '' : `预计 ${item.estimatedMinutes} 分钟`;
    children.push(stageBand(clean(item.level) || '课后作业', time));
    const rows = [
      ['作业要求', item.content],
      ['答题指导', item.answerGuidance],
      ['教材依据', sourceRefLines(item.sourceRefs).map((text) => bodyParagraph(text, 50))],
    ].filter(([, value]) => hasContent(value));
    if (rows.length) children.push(labelDetailTable(rows));
    children.push(spacer(120));
  }
  if (array(data.reflectionPrompts).length) {
    children.push(subheading('课后反思要点'));
    children.push(...bulletParagraphs(data.reflectionPrompts));
  }
  if (!items.length && !array(data.reflectionPrompts).length) addEmpty(children);
}

function addExercises(children, data) {
  const items = array(data.items);
  if (!items.length) return addEmpty(children);
  items.forEach((raw, index) => {
    const item = record(raw);
    const questionContent = [];
    if (clean(item.stem)) questionContent.push(bodyParagraph(item.stem, 120, true));
    array(item.options).forEach((option, optionIndex) => {
      const label = optionIndex < 26 ? String.fromCharCode(65 + optionIndex) : String(optionIndex + 1);
      const optionText = removeCurrentOptionLabel(option, label);
      questionContent.push(new Paragraph({
        style: 'LessonBody',
        indent: { left: 420, hanging: 0 },
        spacing: { before: 0, after: 70, line: 300, lineRule: LineRuleType.AUTO },
        children: [
          new TextRun({ text: `${label}. `, font: FONT_SANS, size: 20, bold: true, color: COLORS.accentDark }),
          new TextRun({ text: optionText, font: FONT_SANS, size: 20, color: COLORS.body }),
        ],
      }));
    });
    const rows = [
      [null, questionContent],
      ['参考答案', item.answer],
      ['答案解析', item.explanation],
      ['评分标准', item.scoringRubric],
      ['教材依据', sourceRefLines(item.sourceRefs).map((text) => bodyParagraph(text, 50))],
    ].filter(([, value]) => hasContent(value));
    children.push(headedDetailTable(
      `题目 ${String(index + 1).padStart(2, '0')} · ${clean(item.type) || '练习题'}`,
      exerciseMeta(item),
      rows,
      { labelFill: COLORS.paleGold },
    ));
    if (index < items.length - 1) children.push(spacer(180));
  });
}

function addCustom(children, data) {
  if (!clean(data.content)) return addEmpty(children);
  addMultilineBody(children, data.content);
}

function addGenericValue(children, value, label = '') {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (label) children.push(subheading(label));
    addMultilineBody(children, value);
    return;
  }
  if (Array.isArray(value)) {
    children.push(...bulletParagraphs(value.map((item) => typeof item === 'object' ? JSON.stringify(item) : item)));
    return;
  }
  const entries = Object.entries(record(value));
  if (!entries.length) return addEmpty(children);
  for (const [key, child] of entries) addGenericValue(children, child, key);
}

function sectionHeading(text) {
  return new Paragraph({ style: 'LessonSection', text: clean(text) || '未命名模块' });
}

function subheading(text) {
  return new Paragraph({ style: 'LessonSubheading', text: clean(text) });
}

function bodyParagraph(text, after = 120, bold = false) {
  return textParagraph(text, { size: 21, color: COLORS.body, after, bold, style: 'LessonBody' });
}

function textParagraph(text, options = {}) {
  return new Paragraph({
    style: options.style,
    alignment: options.alignment,
    keepNext: options.keepNext,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 120,
      line: options.line ?? 300,
      lineRule: LineRuleType.AUTO,
    },
    children: [new TextRun({
      text: clean(text),
      font: options.font || FONT_SANS,
      size: options.size ?? 21,
      bold: Boolean(options.bold),
      color: options.color || COLORS.body,
    })],
  });
}

function addMultilineBody(children, text) {
  const lines = clean(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  for (const line of lines) children.push(bodyParagraph(line));
}

function bulletParagraphs(values) {
  return array(values).map(clean).filter(Boolean).map((text) => new Paragraph({
    style: 'LessonBody',
    numbering: { reference: 'lesson-bullets', level: 0 },
    spacing: { before: 0, after: 80, line: 300, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text, font: FONT_SANS, size: 20, color: COLORS.body })],
  }));
}

function callout(label, content, fill) {
  return makeTable([
    new TableRow({ children: [makeCell([
      textParagraph(label, { size: 18, bold: true, color: COLORS.accentDark, after: 55, keepNext: true }),
      ...clean(content).split(/\r?\n/).filter(Boolean).map((line) => bodyParagraph(line, 40)),
    ], TABLE_WIDTH, fill)] }),
  ], [TABLE_WIDTH], { borders: NO_TABLE_BORDERS, indent: TABLE_INDENT });
}

function labelDetailTable(rows, options = {}) {
  const detailTable = makeTable(rows.map(([label, value]) => new TableRow({
    cantSplit: true,
    children: [
      makeCell([textParagraph(label, { size: 18, bold: true, color: COLORS.accentDark, after: 0 })], LABEL_WIDTH, options.labelFill || COLORS.pale),
      makeCell(normalizeCellContent(value), DETAIL_WIDTH, COLORS.white),
    ],
  })), [LABEL_WIDTH, DETAIL_WIDTH], {
    borders: options.topAccent ? {
      ...TABLE_BORDERS,
      top: { style: BorderStyle.SINGLE, size: 14, color: COLORS.accent },
    } : TABLE_BORDERS,
    indent: options.keepTogether ? 0 : TABLE_INDENT,
  });
  if (!options.keepTogether) return detailTable;
  return makeTable([new TableRow({
    cantSplit: true,
    children: [new TableCell({
      children: [detailTable],
      width: { size: TABLE_WIDTH, type: WidthType.DXA },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      borders: NO_CELL_BORDERS,
      verticalAlign: VerticalAlign.TOP,
    })],
  })], [TABLE_WIDTH], { borders: NO_TABLE_BORDERS, indent: TABLE_INDENT });
}

function headedDetailTable(title, meta, rows, options = {}) {
  const metaText = clean(meta);
  const metaWidth = metaText ? 2200 : 0;
  const widths = metaWidth
    ? [LABEL_WIDTH, DETAIL_WIDTH - metaWidth, metaWidth]
    : [LABEL_WIDTH, DETAIL_WIDTH];
  const spanCount = widths.length;
  const headerCells = [makeCell([
    textParagraph(title, { size: 22, bold: true, color: COLORS.white, after: 0, keepNext: true }),
  ], TABLE_WIDTH - metaWidth, COLORS.accentDark, { columnSpan: metaWidth ? 2 : spanCount })];
  if (metaWidth) {
    headerCells.push(makeCell([
      textParagraph(metaText, { size: 18, bold: true, color: COLORS.accentDark, after: 0, alignment: AlignmentType.RIGHT, keepNext: true }),
    ], metaWidth, COLORS.pale));
  }
  const bodyRows = rows.map(([label, value]) => {
    if (label === null || label === undefined || label === '') {
      return new TableRow({
        cantSplit: true,
        children: [makeCell(normalizeCellContent(value), TABLE_WIDTH, COLORS.white, { columnSpan: spanCount })],
      });
    }
    return new TableRow({
      cantSplit: true,
      children: [
        makeCell([textParagraph(label, { size: 18, bold: true, color: COLORS.accentDark, after: 0 })], LABEL_WIDTH, options.labelFill || COLORS.pale),
        makeCell(normalizeCellContent(value), DETAIL_WIDTH, COLORS.white, { columnSpan: metaWidth ? 2 : 1 }),
      ],
    });
  });
  return makeTable([
    new TableRow({ children: headerCells, cantSplit: true, tableHeader: true }),
    ...bodyRows,
  ], widths, { borders: TABLE_BORDERS, indent: TABLE_INDENT });
}

function twoColumnTable(left, right) {
  const leftWidth = Math.floor(TABLE_WIDTH / 2);
  const rightWidth = TABLE_WIDTH - leftWidth;
  return makeTable([new TableRow({
    children: [makeCell(left, leftWidth, 'F3F7F6'), makeCell(right, rightWidth, COLORS.paleGold)],
  })], [leftWidth, rightWidth], { borders: TABLE_BORDERS, indent: TABLE_INDENT });
}

function threeColumnTable(columns) {
  const a = Math.floor(TABLE_WIDTH / 3);
  const widths = [a, a, TABLE_WIDTH - (a * 2)];
  return makeTable([new TableRow({
    children: columns.map((column, index) => makeCell(column, widths[index], index === 1 ? COLORS.paleGold : 'F3F7F6')),
  })], widths, { borders: TABLE_BORDERS, indent: TABLE_INDENT });
}

function stageBand(title, meta) {
  const metaWidth = meta ? 2200 : 0;
  const titleWidth = TABLE_WIDTH - metaWidth;
  const cells = [makeCell([
    textParagraph(title, { size: 22, bold: true, color: COLORS.white, after: 0 }),
  ], titleWidth, COLORS.accentDark)];
  const widths = [titleWidth];
  if (meta) {
    cells.push(makeCell([
      textParagraph(meta, { size: 18, bold: true, color: COLORS.accentDark, after: 0, alignment: AlignmentType.RIGHT }),
    ], metaWidth, COLORS.pale));
    widths.push(metaWidth);
  }
  return makeTable([new TableRow({ children: cells, cantSplit: true })], widths, { borders: NO_TABLE_BORDERS, indent: TABLE_INDENT });
}

function makeTable(rows, columnWidths, options = {}) {
  return new Table({
    rows,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    indent: { size: options.indent ?? TABLE_INDENT, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    margins: CELL_MARGINS,
    borders: options.borders || TABLE_BORDERS,
  });
}

function makeCell(children, width, fill = COLORS.white, options = {}) {
  return new TableCell({
    children: children.length ? children : [new Paragraph('')],
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.TOP,
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    columnSpan: options.columnSpan,
    borders: options.borders,
  });
}

function normalizeCellContent(value) {
  if (Array.isArray(value)) return value.length ? value : [new Paragraph('')];
  const lines = clean(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines.map((line) => bodyParagraph(line, 50)) : [new Paragraph('')];
}

function titledCellContent(title, values) {
  const paragraphs = [textParagraph(title, { size: 21, bold: true, color: COLORS.accentDark, after: 90, keepNext: true })];
  const bullets = bulletParagraphs(values);
  return paragraphs.concat(bullets.length ? bullets : [textParagraph('—', { size: 19, color: COLORS.muted, after: 0 })]);
}

function questionDetailParagraphs(values) {
  const output = [];
  for (const raw of array(values)) {
    const item = record(raw);
    const parts = [
      ['问题', item.prompt],
      ['提问目的', item.purpose],
      ['预期回应', item.expectedResponse],
      ['继续追问', item.followUp],
    ].filter(([, value]) => clean(value));
    const refs = sourceRefLines(item.sourceRefs);
    for (const [label, value] of parts) output.push(richLabelParagraph(label, value));
    for (const ref of refs) output.push(richLabelParagraph('教材依据', ref));
  }
  return output;
}

function richLabelParagraph(label, value) {
  return new Paragraph({
    style: 'LessonBody',
    spacing: { before: 0, after: 70, line: 300, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({ text: `${clean(label)}：`, font: FONT_SANS, size: 20, bold: true, color: COLORS.accentDark }),
      new TextRun({ text: clean(value), font: FONT_SANS, size: 20, color: COLORS.body }),
    ],
  });
}

function sourceRefLines(value) {
  return array(value).map((raw) => {
    const ref = record(raw);
    const source = clean(ref.title) || clean(ref.fileName);
    const location = ref.page === null || ref.page === undefined || ref.page === '' ? '' : `第 ${ref.page} 页`;
    const block = array(ref.blockIds).map(clean).filter(Boolean).join('、');
    const excerpt = clean(ref.excerpt);
    const parts = [source, location, block ? `内容块 ${block}` : '', excerpt].filter(Boolean);
    return parts.join('：');
  }).filter(Boolean);
}

function timeRange(stage) {
  const start = numberOrNull(stage.startMinute);
  const duration = numberOrNull(stage.durationMinutes);
  if (start !== null && duration !== null) return `${start}—${start + duration} 分钟 · 共 ${duration} 分钟`;
  if (duration !== null) return `共 ${duration} 分钟`;
  return '';
}

function exerciseMeta(item) {
  const parts = [];
  const difficulty = numberOrNull(item.difficulty);
  const minutes = numberOrNull(item.estimatedMinutes);
  if (difficulty !== null) parts.push(`难度 ${difficulty}/5`);
  if (minutes !== null) parts.push(`建议 ${minutes} 分钟`);
  const knowledge = array(item.knowledgePoints).map(clean).filter(Boolean);
  if (knowledge.length) parts.push(`知识点：${knowledge.join('、')}`);
  return parts.join(' · ');
}

function spacer(after = 120) {
  return new Paragraph({ spacing: { before: 0, after }, children: [] });
}

function addEmpty(children) {
  children.push(new Paragraph({ style: 'LessonMuted', text: '本模块暂未填写。' }));
}

function hasContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  return clean(value).length > 0;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  let sanitized = '';
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    const isXml10Character = codePoint === 0x09
      || codePoint === 0x0A
      || codePoint === 0x0D
      || (codePoint >= 0x20 && codePoint <= 0xD7FF)
      || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
      || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    if (isXml10Character && codePoint !== 0x7F) sanitized += character;
  }
  return sanitized.trim();
}

function joinTruthy(values, separator) {
  return values.map(clean).filter(Boolean).join(separator);
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function removeCurrentOptionLabel(value, label) {
  const text = clean(value);
  const expectedLabel = String(label);
  if (text.slice(0, expectedLabel.length).toLocaleUpperCase('en-US') !== expectedLabel.toLocaleUpperCase('en-US')) {
    return text;
  }
  const remainder = text.slice(expectedLabel.length);
  if (!remainder) return '';
  const punctuation = remainder.match(/^\s*[.．、:：)）]\s*/);
  if (punctuation) return remainder.slice(punctuation[0].length);
  if (/^\s+/.test(remainder)) return remainder.trimStart();
  return text;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

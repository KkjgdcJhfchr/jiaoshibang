import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { sampleLesson } from '../src/data/sampleLesson.js';
import { generateLessonDocx } from './lesson-export-docx.mjs';
import { buildLessonExportModel, collectLessonExportTexts } from './lesson-export-model.mjs';

const lesson = structuredClone(sampleLesson);
lesson.metadata.title = `${lesson.metadata.title} & <完整导出>`;
const model = buildLessonExportModel(lesson);
const buffer = await generateLessonDocx(model);

assert.ok(Buffer.isBuffer(buffer));
assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK', 'DOCX 必须是 ZIP/OOXML 文件');

const entries = unzipEntries(buffer);
const documentXml = entries.get('word/document.xml')?.toString('utf8');
const footerEntries = [...entries.entries()].filter(([name]) => /^word\/footer\d*\.xml$/i.test(name));
assert.ok(documentXml, 'DOCX 缺少 word/document.xml');
assert.ok(footerEntries.length > 0, 'DOCX 缺少 footer.xml');

const bodyXml = documentXml.match(/<w:body>([\s\S]*?)<\/w:body>/)?.[1] || '';
const topLevelTables = extractTopLevelElements(bodyXml, 'w:tbl');
const headedTables = topLevelTables.filter((table) => /<w:tblHeader(?:\s[^>]*)?\/>/.test(table));
const timelineCount = model.sections
  .find((section) => section.kind === 'timeline')?.data?.stages?.length || 0;
const exerciseCount = model.sections
  .find((section) => section.kind === 'exercises')?.data?.items?.length || 0;
assert.equal(
  headedTables.length,
  timelineCount + exerciseCount,
  '每个教学环节和每道习题必须各自使用一个带重复表头的连续表格',
);
for (const table of headedTables) {
  const rows = extractTopLevelElements(table, 'w:tr');
  assert.ok(rows.length > 1, '带标题的教学环节或习题表格必须包含明细行');
  assert.match(rows[0], /<w:tblHeader(?:\s[^>]*)?\/>/, '首行必须是重复表头');
  assert.match(rows[0], /<w:cantSplit(?:\s[^>]*)?\/>/, '表头不得跨页拆分');
  for (const row of rows.slice(1)) {
    assert.match(row, /<w:cantSplit(?:\s[^>]*)?\/>/, '明细行不得跨页拆分');
  }
}

const objectiveSection = model.sections.find((section) => section.kind === 'objectives');
const objectiveTables = topLevelTables.filter((table) => {
  const nestedTableCount = (table.match(/<w:tbl(?:\s[^>]*)?>/g) || []).length;
  return nestedTableCount > 1;
});
assert.equal(
  objectiveTables.length,
  objectiveSection?.data?.objectives?.length || 0,
  '每个教学目标必须使用一个不可拆分的外层表格保持整体分页',
);
for (const table of objectiveTables) {
  const rows = extractTopLevelElements(table, 'w:tr');
  assert.equal(rows.length, 1, '教学目标外层表格只能包含一个整体行');
  assert.match(rows[0], /<w:cantSplit(?:\s[^>]*)?\/>/, '单个教学目标不得跨页拆分');
}

const beforeSectPr = bodyXml.replace(/<w:sectPr[\s\S]*$/, '').trim();
assert.match(
  beforeSectPr,
  /<\/w:tbl>$/,
  '最后一道习题后不得残留会生成空白页的空段落',
);

const footerXml = footerEntries.map(([, contents]) => contents.toString('utf8')).join('\n');
const inspectedXml = `${documentXml}\n${footerXml}`;
assert.doesNotMatch(
  extractWordText(inspectedXml),
  /https?:\/\/|www\.|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:cn|com|net|org)\b/i,
  '正文或页脚不应写入网站域名',
);

const numberedParagraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
for (const paragraph of numberedParagraphs) {
  const paragraphText = extractWordText(paragraph).trim();
  if (paragraph.includes('<w:numPr')) {
    assert.ok(paragraphText, 'DOCX 不应包含无正文的编号段落');
  }
  assert.doesNotMatch(paragraphText, /^\d+[.、]?$/, `DOCX 不应包含孤立空编号：${paragraphText}`);
}

const ooxmlText = normalizeVisibleText(extractWordText(inspectedXml));
for (const text of collectLessonExportTexts(model)) {
  const expected = normalizeVisibleText(text);
  if (!expected) continue;
  assert.ok(
    ooxmlText.includes(expected),
    `DOCX OOXML 缺少或改写了模型可见文本：${JSON.stringify(text)}`,
  );
}

assert.ok(documentXml.includes('&amp;'), '特殊字符 & 应由 OOXML 转义');
assert.ok(documentXml.includes('&lt;完整导出&gt;'), '特殊字符 < > 应由 OOXML 转义');

const invalidXmlCharacters = `\u0000\u000B\uFFFE\uFFFF\uD800高\uDC00低`;
const boundaryLesson = structuredClone(sampleLesson);
boundaryLesson.metadata.title = `边界标题${invalidXmlCharacters}保留🙂`;
boundaryLesson.timeline = [structuredClone(sampleLesson.timeline[0])];
boundaryLesson.exercises = [{
  ...structuredClone(sampleLesson.exercises[0]),
  options: [
    { label: 'A', content: `甲${invalidXmlCharacters}保留🚀` },
    { label: 'B.', content: '乙' },
    { label: 'C、', content: '丙' },
    { label: 'D．', content: '丁' },
  ],
}];
const boundaryModel = buildLessonExportModel(boundaryLesson);
const boundaryTimeline = boundaryModel.sections.find((section) => section.kind === 'timeline');
const boundaryExercises = boundaryModel.sections.find((section) => section.kind === 'exercises');
boundaryTimeline.data.stages[0].startMinute = null;
boundaryTimeline.data.stages[0].durationMinutes = undefined;
boundaryExercises.data.items[0].difficulty = ' \t ';
boundaryExercises.data.items[0].estimatedMinutes = null;

const boundaryEntries = unzipEntries(await generateLessonDocx(boundaryModel));
const boundaryDocumentXml = boundaryEntries.get('word/document.xml')?.toString('utf8');
assert.ok(boundaryDocumentXml, '边界用例 DOCX 缺少 word/document.xml');
const boundaryVisibleText = extractWordText(boundaryDocumentXml);
assert.doesNotMatch(
  boundaryVisibleText,
  /0—0 分钟|共 0 分钟|难度 0\/5|建议 0 分钟/,
  'null、undefined 或空白数值不得伪造为 0',
);
assert.ok(boundaryVisibleText.includes('A. 甲高低保留🚀'), '选项 A 应只保留一个标签');
assert.ok(boundaryVisibleText.includes('B. 乙'), '选项 B 应只保留一个标签');
assert.ok(boundaryVisibleText.includes('C. 丙'), '选项 C 应只保留一个标签');
assert.ok(boundaryVisibleText.includes('D. 丁'), '选项 D 应只保留一个标签');
assert.doesNotMatch(
  boundaryVisibleText,
  /A\.\s*A(?:\s|[.．、:：)）])|B\.\s*B(?:\s|[.．、:：)）])|C\.\s*C(?:\s|[.．、:：)）])|D\.\s*D(?:\s|[.．、:：)）])/i,
  '模型已带当前选项标签时不得再次添加',
);
assert.ok(boundaryVisibleText.includes('边界标题高低保留🙂'), '合法的补充平面字符必须保留');
assert.doesNotMatch(boundaryVisibleText, /\uFFFD/, '孤立代理项必须删除而不是写成替换字符');
for (const [name, contents] of boundaryEntries) {
  if (!/\.(?:xml|rels)$/i.test(name)) continue;
  assertXml10CodePoints(contents.toString('utf8'), name);
}

console.log('lesson export DOCX tests passed');

function unzipEntries(zip) {
  const eocdOffset = findSignatureFromEnd(zip, 0x06054b50);
  assert.ok(eocdOffset >= 0, 'DOCX ZIP 缺少 EOCD');
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, 'DOCX ZIP 中央目录损坏');
    const compression = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const filenameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localHeaderOffset = zip.readUInt32LE(cursor + 42);
    const filename = zip.subarray(cursor + 46, cursor + 46 + filenameLength).toString('utf8');

    assert.equal(zip.readUInt32LE(localHeaderOffset), 0x04034b50, `DOCX ZIP 本地条目损坏：${filename}`);
    const localFilenameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
    const contents = compression === 0
      ? Buffer.from(compressed)
      : compression === 8 ? inflateRawSync(compressed) : null;
    assert.ok(contents, `DOCX ZIP 使用了不支持的压缩方法：${compression}`);
    entries.set(filename, contents);
    cursor += 46 + filenameLength + extraLength + commentLength;
  }

  return entries;
}

function findSignatureFromEnd(buffer, signature) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= minimum; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) return index;
  }
  return -1;
}

function extractWordText(xml) {
  return [...String(xml || '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function normalizeVisibleText(value) {
  return String(value ?? '').replace(/\s+/g, '');
}

function extractTopLevelElements(xml, tagName) {
  const token = new RegExp(`<${tagName}(?:\\s[^>]*)?>|<\\/${tagName}>`, 'g');
  const output = [];
  let depth = 0;
  let start = -1;

  for (const match of xml.matchAll(token)) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        output.push(xml.slice(start, match.index + match[0].length));
        start = -1;
      }
    } else {
      if (depth === 0) start = match.index;
      depth += 1;
    }
  }
  return output;
}

function assertXml10CodePoints(xml, name) {
  for (const character of String(xml)) {
    const codePoint = character.codePointAt(0);
    assertXml10CodePoint(codePoint, name);
  }
  for (const reference of String(xml).matchAll(/&#(?:x([0-9a-f]+)|(\d+));/gi)) {
    const codePoint = Number.parseInt(reference[1] || reference[2], reference[1] ? 16 : 10);
    assertXml10CodePoint(codePoint, `${name} 的字符引用`);
  }
}

function assertXml10CodePoint(codePoint, name) {
  const valid = codePoint === 0x09
    || codePoint === 0x0A
    || codePoint === 0x0D
    || (codePoint >= 0x20 && codePoint <= 0xD7FF)
    || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
  assert.ok(valid, `${name} 含 XML 1.0 非法码点 U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`);
}

import assert from 'node:assert/strict';
import { sampleLesson } from '../src/data/sampleLesson.js';
import { buildLessonExportModel, collectLessonExportTexts } from './lesson-export-model.mjs';
import { generateLessonPdf, renderLessonPdfHtml } from './lesson-export-pdf.mjs';

const lesson = structuredClone(sampleLesson);
lesson.metadata.title = '完整导出 <春> & 特殊字符';
lesson.section_titles = { timeline: '课堂完整流程' };
lesson.custom_sections = [{ id: 'sentinel', title: '跨学科拓展', content: '自定义模块哨兵：观察、记录与表达。' }];
lesson.section_order = ['objectives', 'timeline', 'custom:sentinel', 'learner'];
lesson.timeline[0].teacher_script = `${lesson.timeline[0].teacher_script}\n第二段完整课堂话术。\n\n第三段保留空行，包含 <观察> & “表达”。`;
lesson.timeline[0].source_refs = [{
  file_name: '教材图册\n第二行文件名.pdf',
  title: '引用章节 <图文> & 校对',
  page: 6,
  excerpt: '引用原文第一段。\r\n引用原文第二段。',
}];

const model = buildLessonExportModel(lesson);
const html = renderLessonPdfHtml(model);
assert.match(html, /^<!doctype html>/);
assert.ok(html.includes('完整导出 &lt;春&gt; &amp; 特殊字符'));
assert.ok(html.includes('课堂完整流程'));
assert.ok(html.includes('自定义模块哨兵：观察、记录与表达。'));
assert.ok(html.includes('第二段完整课堂话术。'));
assert.ok(!html.includes('beikexing.cn'));
assert.ok(!html.includes('window.print'));
assert.ok(!html.includes('<script'));

for (const text of collectLessonExportTexts(model)) {
  const expected = htmlTextFragment(text);
  assert.ok(
    html.includes(expected),
    `PDF HTML 缺少或改写了导出文本：${JSON.stringify(text)}\n期望片段：${expected}`,
  );
}

let capturedHtml = '';
const fakePdf = Buffer.from('%PDF-1.7\n% lesson export test\n%%EOF');
const generated = await generateLessonPdf(model, {
  gotenbergUrl: 'http://gotenberg.test:3000',
  requestId: 'pdf-test-request',
  fetchImpl: async (url, options) => {
    assert.equal(url, 'http://gotenberg.test:3000/forms/chromium/convert/html');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Gotenberg-Trace'], 'pdf-test-request');
    assert.equal(options.body.get('preferCssPageSize'), 'true');
    assert.equal(options.body.get('printBackground'), 'true');
    const file = options.body.get('files');
    assert.equal(file.name, 'index.html');
    capturedHtml = await file.text();
    return new Response(fakePdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(fakePdf.byteLength),
      },
    });
  },
});
assert.equal(generated.mimeType, 'application/pdf');
assert.deepEqual(generated.buffer, fakePdf);
assert.ok(capturedHtml.includes('课堂完整流程'));

let upstreamFailure;
try {
  await generateLessonPdf(model, {
    gotenbergUrl: 'http://gotenberg.test:3000',
    fetchImpl: async () => new Response('chromium failed at /tmp/private-job/index.html', { status: 500 }),
  });
} catch (error) {
  upstreamFailure = error;
}
assert.equal(upstreamFailure?.code, 'PDF_EXPORT_FAILED');
assert.equal(upstreamFailure?.details, undefined, '转换器内部错误不得通过公共 details 返回给客户端');
assert.deepEqual(
  upstreamFailure?.internalDetails,
  { upstreamMessage: 'chromium failed at /tmp/private-job/index.html' },
  '转换器内部错误仅保留给服务端按 requestId 记录',
);

console.log('lesson export PDF tests passed');

function htmlTextFragment(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replace(/\r\n?|\n/g, '<br>');
}

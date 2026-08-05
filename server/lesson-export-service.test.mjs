import assert from 'node:assert/strict';
import { sampleLesson } from '../src/data/sampleLesson.js';
import { exportLessonDocument } from './lesson-export-service.mjs';

const docx = await exportLessonDocument(structuredClone(sampleLesson), 'docx');
assert.equal(docx.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
assert.equal(docx.filename, '《春》第一课时教学设计.docx');
assert.equal(docx.buffer.subarray(0, 2).toString('ascii'), 'PK');

const fakePdf = Buffer.from('%PDF-1.7\n% export service fixture\n%%EOF');
let pdfRequestCount = 0;
const pdf = await exportLessonDocument(structuredClone(sampleLesson), 'pdf', {
  gotenbergUrl: 'http://gotenberg.test:3000',
  requestId: 'lesson-export-service-test',
  fetchImpl: async (url, options) => {
    pdfRequestCount += 1;
    assert.equal(url, 'http://gotenberg.test:3000/forms/chromium/convert/html');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Gotenberg-Trace'], 'lesson-export-service-test');
    assert.ok(options.body instanceof FormData);
    return new Response(fakePdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(fakePdf.byteLength),
      },
    });
  },
});

assert.equal(pdfRequestCount, 1);
assert.equal(pdf.mimeType, 'application/pdf');
assert.equal(pdf.filename, '《春》第一课时教学设计.pdf');
assert.equal(pdf.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
assert.deepEqual(pdf.buffer, fakePdf);

await assert.rejects(
  exportLessonDocument({ metadata: { title: '空教案' } }, 'docx'),
  (error) => error?.status === 422 && error?.code === 'LESSON_EXPORT_EMPTY',
  '没有正文内容的空教案必须拒绝导出',
);

console.log('lesson export service tests passed');

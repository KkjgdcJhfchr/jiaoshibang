import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { sampleLesson } from '../src/data/sampleLesson.js';
import { exportLessonDocument } from '../server/lesson-export-service.mjs';

const outputArgument = process.argv[2];
if (!outputArgument) {
  console.error('用法：node scripts/render-export-fixture.mjs <输出目录>');
  process.exitCode = 1;
} else {
  const outputDirectory = path.resolve(outputArgument);
  await mkdir(outputDirectory, { recursive: true });

  const lesson = structuredClone(sampleLesson);
  const docx = await exportLessonDocument(lesson, 'docx');
  const docxPath = path.join(outputDirectory, docx.filename);
  await writeFile(docxPath, docx.buffer);
  console.log(`DOCX fixture: ${docxPath}`);

  const gotenbergUrl = String(process.env.GOTENBERG_URL || '').trim();
  if (gotenbergUrl) {
    const pdf = await exportLessonDocument(lesson, 'pdf', {
      gotenbergUrl,
      requestId: `lesson-export-fixture-${Date.now()}`,
    });
    const pdfPath = path.join(outputDirectory, pdf.filename);
    await writeFile(pdfPath, pdf.buffer);
    console.log(`PDF fixture: ${pdfPath}`);
  } else {
    console.log('未设置 GOTENBERG_URL，已跳过 PDF fixture。');
  }
}

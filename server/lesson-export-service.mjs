import {
  buildLessonExportModel,
  collectLessonExportTexts,
  sanitizeExportFilename,
  validateLessonExportInput,
} from './lesson-export-model.mjs';
import { generateLessonDocx } from './lesson-export-docx.mjs';
import { generateLessonPdf, LessonPdfExportError } from './lesson-export-pdf.mjs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_EXPORT_TEXT_ITEMS = 30_000;
const MAX_EXPORT_TEXT_CHARACTERS = 3_000_000;
const MAX_DOCX_OUTPUT_BYTES = 48 * 1024 * 1024;

export class LessonExportError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'LessonExportError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function exportLessonDocument(lesson, format, options = {}) {
  if (!['docx', 'pdf'].includes(format)) {
    throw new LessonExportError(400, 'LESSON_EXPORT_FORMAT_INVALID', '不支持该导出格式');
  }
  const inputError = validateLessonExportInput(lesson);
  if (inputError) {
    throw new LessonExportError(inputError.status, inputError.code, inputError.message);
  }
  const model = buildLessonExportModel(lesson);
  const texts = collectLessonExportTexts(model);
  const characters = texts.reduce((total, item) => total + item.length, 0);
  if (!model.title || !Array.isArray(model.sections) || model.sections.length === 0) {
    throw new LessonExportError(422, 'LESSON_EXPORT_INVALID', '教案内容不完整，无法导出');
  }
  if (texts.length > MAX_EXPORT_TEXT_ITEMS || characters > MAX_EXPORT_TEXT_CHARACTERS) {
    throw new LessonExportError(413, 'LESSON_EXPORT_TOO_LARGE', '教案内容过多，无法一次导出');
  }

  if (format === 'pdf') {
    try {
      const exported = await generateLessonPdf(model, options);
      return {
        ...exported,
        filename: sanitizeExportFilename(model.title, 'pdf'),
      };
    } catch (error) {
      const requestId = String(options.requestId || '').replace(/[\r\n]/g, '').slice(0, 100) || 'unknown';
      if (error instanceof LessonPdfExportError) {
        console.error(
          `[lesson-export] PDF generation failed requestId=${requestId} code=${error.code}`,
          error.internalDetails || '',
        );
        throw error;
      }
      console.error(`[lesson-export] PDF generation failed requestId=${requestId} code=PDF_EXPORT_FAILED`, error);
      throw new LessonExportError(502, 'PDF_EXPORT_FAILED', 'PDF 生成失败，请稍后重试');
    }
  }

  let buffer;
  try {
    buffer = await generateLessonDocx(model);
  } catch (error) {
    console.error('[lesson-export] DOCX generation failed', error);
    throw new LessonExportError(500, 'DOCX_EXPORT_FAILED', 'Word 文档生成失败，请稍后重试');
  }
  if (!Buffer.isBuffer(buffer)
    || buffer.byteLength === 0
    || buffer.byteLength > MAX_DOCX_OUTPUT_BYTES
    || buffer[0] !== 0x50
    || buffer[1] !== 0x4b) {
    throw new LessonExportError(500, 'DOCX_EXPORT_INVALID_FILE', 'Word 文档校验失败，请稍后重试');
  }
  return {
    buffer,
    mimeType: DOCX_MIME,
    filename: sanitizeExportFilename(model.title, 'docx'),
  };
}

import { extractTextFromDocx } from './docx';
import { extractTextFromImage } from './image';
import { extractTextFromPdf } from './pdf';
import { extractTextFromCsv, extractTextFromXlsx } from './spreadsheet';
import { truncateToWordLimit } from './truncate';

export { terminateOcrWorker } from './image';

/**
 * Extracts representative text for a document by its (already
 * magic-byte-verified, from Phase 2) mime type, then truncates it to ~800
 * words before it goes anywhere near the classification prompt.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const rawText = await extractRawText(buffer, mimeType);
  return truncateToWordLimit(rawText);
}

async function extractRawText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  switch (mimeType) {
    case 'application/pdf':
      return extractTextFromPdf(buffer);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractTextFromDocx(buffer);

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return extractTextFromXlsx(buffer);

    case 'text/csv':
      return extractTextFromCsv(buffer);

    case 'image/jpeg':
      return extractTextFromImage(buffer, 'jpg');

    case 'image/png':
      return extractTextFromImage(buffer, 'png');

    case 'image/heic':
    case 'image/heif':
      return extractTextFromImage(buffer, 'heic');

    default:
      throw new Error(`Unsupported mime type for extraction: ${mimeType}`);
  }
}

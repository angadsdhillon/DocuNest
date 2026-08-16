import { PDFParse } from 'pdf-parse';

import { ocrImageBuffer } from './image';

/**
 * A strong signal that a PDF is a scanned image rather than real text —
 * pdf.js successfully "parsed" the file but found nothing (or almost
 * nothing) to extract.
 */
const MIN_TEXT_LENGTH_BEFORE_OCR_FALLBACK = 50;

/**
 * Scanned PDFs are usually short receipts/letters, not 200-page contracts —
 * capping at the first 5 pages keeps OCR fallback bounded in time and cost
 * even if someone uploads something huge.
 */
const MAX_OCR_FALLBACK_PAGES = 5;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const directText = result.text.trim();

    if (directText.length >= MIN_TEXT_LENGTH_BEFORE_OCR_FALLBACK) {
      return directText;
    }

    return await extractTextViaOcrFallback(parser);
  } finally {
    await parser.destroy();
  }
}

async function extractTextViaOcrFallback(
  parser: PDFParse,
): Promise<string> {
  const screenshots = await parser.getScreenshot({
    first: MAX_OCR_FALLBACK_PAGES,
    scale: 2,
  });

  const pageTexts: string[] = [];

  for (const page of screenshots.pages) {
    if (!page.data) {
      continue;
    }

    const pageText = await ocrImageBuffer(Buffer.from(page.data));
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n\n').trim();
}

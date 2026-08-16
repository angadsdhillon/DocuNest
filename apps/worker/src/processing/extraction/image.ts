import heicConvert from 'heic-convert';
import { createWorker, type Worker } from 'tesseract.js';

let cachedWorkerPromise: Promise<Worker> | null = null;

/**
 * One Tesseract worker for the whole process, reused across jobs — creating
 * a fresh worker per OCR call would reload the language model every time.
 * Concurrency is bounded by the BullMQ worker's own concurrency (3), so
 * jobs share this one Tesseract worker sequentially rather than each
 * spinning up their own.
 */
function getTesseractWorker(): Promise<Worker> {
  if (!cachedWorkerPromise) {
    cachedWorkerPromise = createWorker('eng');
  }

  return cachedWorkerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (cachedWorkerPromise) {
    const worker = await cachedWorkerPromise;
    await worker.terminate();
    cachedWorkerPromise = null;
  }
}

export async function ocrImageBuffer(imageBuffer: Buffer): Promise<string> {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(imageBuffer);
  return data.text.trim();
}

/**
 * HEIC/HEIF has no magic-byte-visible pixel data Tesseract (or any
 * JS-native decoder) can read directly, so it's converted to JPEG in memory
 * first. `heic-convert` is a pure-JS/WASM decoder — no native/system HEIC
 * library dependency, so this works the same in any Node environment the
 * worker is deployed to.
 */
export async function extractTextFromImage(
  buffer: Buffer,
  extension: 'jpg' | 'jpeg' | 'png' | 'heic',
): Promise<string> {
  if (extension !== 'heic') {
    return ocrImageBuffer(buffer);
  }

  const jpegBuffer = await heicConvert({
    buffer: new Uint8Array(buffer),
    format: 'JPEG',
    quality: 0.92,
  });

  return ocrImageBuffer(Buffer.from(jpegBuffer));
}

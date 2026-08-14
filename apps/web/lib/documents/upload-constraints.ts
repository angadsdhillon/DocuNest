/**
 * Upload policy shared between the client (convenience, instant feedback)
 * and the server (the real security boundary). Deliberately has no imports
 * so it is safe to pull into both server code and `'use client'` components
 * without dragging any server-only dependency into the browser bundle.
 */

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'xlsx',
  'csv',
  'jpg',
  'jpeg',
  'png',
  'heic',
] as const;

export type AllowedDocumentExtension =
  (typeof ALLOWED_DOCUMENT_EXTENSIONS)[number];

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Magic-byte mime types that are acceptable for each extension. `csv` has no
 * entry because plain text has no magic bytes — it is verified separately
 * (see `lib/storage/upload-service.ts`).
 */
export const EXTENSION_MIME_TYPES: Record<
  Exclude<AllowedDocumentExtension, 'csv'>,
  readonly string[]
> = {
  pdf: ['application/pdf'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  heic: ['image/heic', 'image/heif'],
};

export function getFileExtension(filename: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

export function isAllowedDocumentExtension(
  extension: string | null,
): extension is AllowedDocumentExtension {
  return (
    !!extension &&
    (ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)
  );
}

export function formatAllowedExtensionsList(): string {
  return ALLOWED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(
    ', ',
  );
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

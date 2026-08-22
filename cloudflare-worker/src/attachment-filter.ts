import type { Attachment } from 'postal-mime';

/**
 * Kept identical, on purpose, to the allow-list in
 * `apps/web/lib/documents/upload-constraints.ts`. This Worker does its own
 * copy rather than importing that module — a Cloudflare Worker can't import
 * Next.js server code across the monorepo boundary — but if that list ever
 * changes, change it here too. This is only ever a cheap first filter, not
 * the security boundary: the backend re-verifies every attachment's actual
 * bytes with magic-byte sniffing (see `document-ingest.ts` in apps/web)
 * before it ever gets stored, exactly like manual upload.
 */
const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'xlsx',
  'csv',
  'jpg',
  'jpeg',
  'png',
  'heic',
]);

/** Same 25MB cap as manual upload (Phase 2) and the backend's own re-check. */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

export type QualifyingAttachment = {
  filename: string;
  bytes: Uint8Array;
};

function getExtension(filename: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Normalizes the three shapes `Attachment.content` can take (per
 * `postal-mime`'s types) into a `Uint8Array`, so the rest of this module —
 * and the caller that PUTs these bytes to the presigned R2 URL — only ever
 * deals with one type. `attachmentEncoding` is left at its default
 * ("arraybuffer") when calling `PostalMime.parse`, so `string` is not
 * expected in practice, but handled anyway since the type allows it.
 */
function toBytes(content: Attachment['content']): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

/**
 * Filters an email's attachments down to the ones worth forwarding to the
 * backend: a real filename with an allow-listed extension, not an inline
 * image (a logo embedded in an HTML signature, referenced by `cid:`), and
 * within the size cap. Everything else — an `.ics` calendar invite, a
 * signature PNG, a 40MB video someone forwarded by mistake — is silently
 * dropped rather than causing the whole message to fail, per the phase
 * spec: a spammer probing addresses must never get a bounce that confirms
 * anything.
 */
export function filterQualifyingAttachments(
  attachments: Attachment[],
): QualifyingAttachment[] {
  const qualifying: QualifyingAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.disposition === 'inline') {
      continue;
    }

    if (!attachment.filename) {
      continue;
    }

    const extension = getExtension(attachment.filename);
    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
      continue;
    }

    const bytes = toBytes(attachment.content);
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
      continue;
    }

    qualifying.push({ filename: attachment.filename, bytes });
  }

  return qualifying;
}

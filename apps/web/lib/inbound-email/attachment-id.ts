import { createHash } from 'node:crypto';

/**
 * Derives a stable, UUID-shaped `documents.id` from the facts that identify
 * one specific attachment of one specific email — not a fresh
 * `randomUUID()` per request. This is what makes retried Worker deliveries
 * safe: the same email redelivered (mail transfer agents do this) computes
 * the exact same id, the exact same R2 storage key
 * (`{userId}/{documentId}/{filename}`), and therefore collides with the
 * existing row on both the primary key and the
 * `(user_id, source_message_id, storage_key)` unique constraint from Phase 1
 * — so a duplicate delivery can only ever be recognized and dropped, never
 * inserted twice.
 *
 * `attachmentIndex` is included so that two different attachments in the
 * same email that happen to share a filename (rare, but not impossible)
 * still get distinct ids instead of colliding with each other.
 *
 * Not cryptographically a UUIDv5 (uses SHA-256, not SHA-1, and doesn't use a
 * formal namespace UUID) — it only needs to be deterministic and
 * collision-resistant, not spec-compliant, so this stays simple rather than
 * pulling in a `uuid` dependency for one hash.
 */
export function deriveDeterministicDocumentId(
  userId: string,
  sourceMessageId: string,
  attachmentIndex: number,
  filename: string,
): string {
  const hash = createHash('sha256')
    .update(`${userId}|${sourceMessageId}|${attachmentIndex}|${filename}`)
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Set the version/variant bits so this reads as a well-formed UUID
  // wherever it's displayed or logged, even though it isn't a real UUIDv5.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

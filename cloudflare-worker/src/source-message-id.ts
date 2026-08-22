import type { Email } from 'postal-mime';

/**
 * The value stored in `documents.source_message_id`, which the backend
 * relies on (together with the deterministic per-attachment storage key it
 * derives from this) to recognize a retried delivery of the same email —
 * mail transfer agents redeliver on transient failures, and this must not
 * create a second document each time. Most real mail has a `Message-ID`
 * header, which is exactly this: a value the *sending* server generates
 * once and keeps unchanged across retries of the same delivery attempt.
 *
 * Falls back to a hash of stable envelope facts (from/to/subject/date) only
 * for the rare message that lacks one — still deterministic across a
 * retried delivery of the same physical email, since none of those facts
 * change between retries.
 */
export async function deriveSourceMessageId(
  parsedEmail: Email,
  envelopeFrom: string,
  envelopeTo: string,
): Promise<string> {
  if (parsedEmail.messageId) {
    return parsedEmail.messageId.replace(/^<|>$/g, '');
  }

  const fallbackInput = `${envelopeFrom}|${envelopeTo}|${parsedEmail.subject ?? ''}|${parsedEmail.date ?? ''}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fallbackInput),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `synthetic-${hex}`;
}

/**
 * Storage key conventions for documents in R2.
 *
 * Final objects live at `{user_id}/{document_id}/{original_filename}` so
 * every user's files sit under their own prefix — this matters both for
 * security (a storage-key leak from one user says nothing about another
 * user's keys) and for future per-user data export/deletion (delete
 * everything under one prefix).
 *
 * Uploads land first at a `staging/{user_id}/{document_id}/{original_filename}`
 * key so the object can be verified and encrypted before it ever occupies its
 * final, permanent key. Keeping staging under its own top-level prefix (not
 * mixed into user prefixes) makes it possible to point a single R2 lifecycle
 * rule ("expire objects under staging/ after 24 hours") at every user's
 * abandoned/interrupted uploads at once.
 */

const PATH_SEPARATORS_PATTERN = /[\\/]+/g;
const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001f\u007f]/g;
const LEADING_DOTS_PATTERN = /^\.+/;

/**
 * Strips characters from a user-supplied filename that would otherwise
 * change the shape of the storage key it's embedded in — path separators
 * (which would add extra "directories" or, with `../`, walk back out of the
 * user's own prefix), control characters, and leading dots. This is a
 * defensive measure on top of the strict, magic-byte-checked file type
 * allow-list; it never needs to reject a file outright, only make its name
 * safe to embed in an object key.
 */
export function sanitizeFilenameForStorageKey(originalFilename: string): string {
  const withoutPathSeparators = originalFilename.replace(
    PATH_SEPARATORS_PATTERN,
    '_',
  );
  const withoutControlCharacters = withoutPathSeparators.replace(
    CONTROL_CHARACTERS_PATTERN,
    '',
  );
  const withoutLeadingDots = withoutControlCharacters.replace(
    LEADING_DOTS_PATTERN,
    '',
  );
  const trimmed = withoutLeadingDots.trim();

  return trimmed.length > 0 ? trimmed : 'unnamed-file';
}

export function buildDocumentStorageKey(
  userId: string,
  documentId: string,
  originalFilename: string,
): string {
  return `${userId}/${documentId}/${sanitizeFilenameForStorageKey(originalFilename)}`;
}

export function buildStagingStorageKey(
  userId: string,
  documentId: string,
  originalFilename: string,
): string {
  return `staging/${userId}/${documentId}/${sanitizeFilenameForStorageKey(originalFilename)}`;
}

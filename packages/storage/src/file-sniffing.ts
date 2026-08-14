import { fileTypeFromBuffer } from 'file-type';

export type SniffedFileType = {
  ext: string;
  mime: string;
};

/**
 * Detects a file's real type from its bytes (magic-byte sniffing), never
 * from a filename extension or a client-declared Content-Type. This is the
 * primitive the upload flow uses to catch a mislabelled file (e.g. a `.exe`
 * renamed to `.pdf`) — the extension is only ever a claim, this is a check.
 *
 * Returns `undefined` for content `file-type` cannot fingerprint, which is
 * expected (and fine) for plain-text formats like CSV that have no magic
 * bytes — callers must fall back to a different check for those.
 */
export async function sniffFileType(
  buffer: Buffer,
): Promise<SniffedFileType | undefined> {
  const result = await fileTypeFromBuffer(buffer);
  return result;
}

const MIN_CONTROL_CHARACTER_EXCLUDING_TAB_LF_CR = 0;

/**
 * Cheap heuristic for "this looks like text, not a renamed binary": plain
 * text and CSV never legitimately contain a NUL byte or other control
 * characters (other than tab/newline/carriage-return), while executables,
 * archives and images always do somewhere in their first few KB.
 */
export function looksLikePlainText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));

  for (const byte of sample) {
    const isDisallowedControlCharacter =
      (byte <= 8 && byte >= MIN_CONTROL_CHARACTER_EXCLUDING_TAB_LF_CR) ||
      byte === 11 ||
      byte === 12 ||
      (byte >= 14 && byte <= 31);

    if (isDisallowedControlCharacter) {
      return false;
    }
  }

  return true;
}

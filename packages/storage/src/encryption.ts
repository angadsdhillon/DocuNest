import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for document bytes at rest in R2.
 *
 * This is the ONLY module in the codebase that is allowed to touch
 * `DOCUMENT_ENCRYPTION_MASTER_KEY` directly. Every other module — the
 * upload flow, and every future phase that reads a file back out (the
 * document viewer, the AI classification worker, offline export, etc.) —
 * must go through `encryptFileBuffer` / `decryptFileBuffer` rather than
 * re-implementing crypto, or reading the master key itself, elsewhere.
 *
 * Scheme, per file:
 *   1. Generate a random 256-bit data-encryption key (DEK).
 *   2. Encrypt the file's bytes with the DEK using AES-256-GCM and a random
 *      96-bit IV (the size GCM is designed for).
 *   3. Encrypt ("wrap") the DEK itself with the master key
 *      (key-encryption key, KEK), using the same AES-256-GCM construction.
 *   4. Store the wrapped DEK and the file's IV as R2 object metadata on the
 *      *same* object as the ciphertext, so they can never become separated
 *      from the data they decrypt.
 *
 * Losing or rotating the master key only requires re-wrapping each file's
 * DEK, not re-encrypting every file's bytes — the usual reason to prefer
 * envelope encryption over encrypting everything directly with one key.
 */

const AES_256_GCM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export type EncryptedFile = {
  /** AES-GCM ciphertext with the 16-byte auth tag appended. */
  ciphertext: Buffer;
  /** The IV used to encrypt the file bytes. Store alongside the ciphertext. */
  iv: Buffer;
  /** The file's data key, itself encrypted with the master key. */
  encryptedDataKey: Buffer;
};

export function parseMasterKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64');

  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `DOCUMENT_ENCRYPTION_MASTER_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}); it should be a base64-encoded 32-byte key.`,
    );
  }

  return key;
}

export function encryptFileBuffer(
  masterKey: Buffer,
  plaintext: Buffer,
): EncryptedFile {
  const dataKey = randomBytes(KEY_LENGTH_BYTES);
  const iv = randomBytes(IV_LENGTH_BYTES);

  const cipher = createCipheriv(AES_256_GCM, dataKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, authTag]),
    iv,
    encryptedDataKey: wrapDataKey(masterKey, dataKey),
  };
}

export function decryptFileBuffer(
  masterKey: Buffer,
  ciphertextWithTag: Buffer,
  iv: Buffer,
  encryptedDataKey: Buffer,
): Buffer {
  const dataKey = unwrapDataKey(masterKey, encryptedDataKey);

  const authTag = ciphertextWithTag.subarray(
    ciphertextWithTag.length - AUTH_TAG_LENGTH_BYTES,
  );
  const encrypted = ciphertextWithTag.subarray(
    0,
    ciphertextWithTag.length - AUTH_TAG_LENGTH_BYTES,
  );

  const decipher = createDecipheriv(AES_256_GCM, dataKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Packs iv + authTag + ciphertext into one blob so the wrapped key is a single opaque value that fits in one metadata entry. */
function wrapDataKey(masterKey: Buffer, dataKey: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(AES_256_GCM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

function unwrapDataKey(masterKey: Buffer, wrapped: Buffer): Buffer {
  const iv = wrapped.subarray(0, IV_LENGTH_BYTES);
  const authTag = wrapped.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const encrypted = wrapped.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv(AES_256_GCM, masterKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Metadata key names used to store the IV and wrapped data key alongside the
 * ciphertext on the R2 object itself, so they are written and read
 * atomically with it rather than living in a separate DB column that could
 * drift out of sync with the object it describes. R2/S3 lower-cases and
 * prefixes these with `x-amz-meta-` automatically.
 */
export const ENCRYPTION_METADATA_KEYS = {
  iv: 'docunest-iv',
  encryptedDataKey: 'docunest-encrypted-data-key',
  originalSizeBytes: 'docunest-original-size-bytes',
} as const;

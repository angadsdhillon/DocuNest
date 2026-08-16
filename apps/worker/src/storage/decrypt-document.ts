import {
  decryptFileBuffer,
  ENCRYPTION_METADATA_KEYS,
  getObjectBuffer,
  headObject,
  parseMasterKey,
} from '@docunest/storage';

import { getWorkerEnvironment } from '../env';
import { getR2BucketName, getR2Client } from './r2-client';

/**
 * Downloads a document's encrypted bytes from R2 and decrypts them in
 * memory using the envelope-encryption scheme from `packages/storage`. The
 * plaintext this returns must never be written to disk — every caller
 * (extraction, OCR) has to work directly off this in-memory `Buffer` and
 * let it be garbage-collected once processing finishes.
 */
export async function decryptDocumentBuffer(
  storageKey: string,
): Promise<Buffer> {
  const r2 = getR2Client();
  const bucket = getR2BucketName();

  const head = await headObject(r2, bucket, storageKey);

  if (!head) {
    throw new Error(`Object not found in R2 for storage key (redacted).`);
  }

  const ivBase64 = head.metadata[ENCRYPTION_METADATA_KEYS.iv];
  const encryptedDataKeyBase64 =
    head.metadata[ENCRYPTION_METADATA_KEYS.encryptedDataKey];

  if (!ivBase64 || !encryptedDataKeyBase64) {
    throw new Error(
      'Stored object is missing required encryption metadata (iv / encrypted data key).',
    );
  }

  const ciphertext = await getObjectBuffer(r2, bucket, storageKey);
  const masterKey = parseMasterKey(
    getWorkerEnvironment().DOCUMENT_ENCRYPTION_MASTER_KEY,
  );

  return decryptFileBuffer(
    masterKey,
    ciphertext,
    Buffer.from(ivBase64, 'base64'),
    Buffer.from(encryptedDataKeyBase64, 'base64'),
  );
}

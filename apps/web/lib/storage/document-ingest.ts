import 'server-only';

import { createHash } from 'node:crypto';

import {
  buildDocumentStorageKey,
  buildStagingStorageKey,
  deleteObjectIgnoringNotFound,
  ENCRYPTION_METADATA_KEYS,
  encryptFileBuffer,
  getObjectBuffer,
  headObject,
  looksLikePlainText,
  parseMasterKey,
  putObject,
  sniffFileType,
  type SniffedFileType,
} from '@docunest/storage';

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  EXTENSION_MIME_TYPES,
  getFileExtension,
  isAllowedDocumentExtension,
  MAX_UPLOAD_SIZE_BYTES,
  type AllowedDocumentExtension,
} from '@/lib/documents/upload-constraints';
import { getStorageEnvironment } from '@/lib/storage/env';
import { getR2BucketName, getR2Client } from '@/lib/storage/r2-client';
import { getStorageUsage, wouldExceedQuota } from '@/lib/storage/quota-service';
import type { DocuNestSupabaseClient } from '@/lib/supabase/server';

/**
 * Bytes read from a staged object to sniff its real file type. Every format
 * in the allow-list identifies itself well within the first few KB (PDF,
 * PNG and JPEG within the first dozen bytes; the zip-based Office formats
 * and HEIC's ftyp box need a bit more), so this avoids downloading the
 * whole object twice for the common case where it will be rejected.
 */
const TYPE_SNIFF_BYTE_COUNT = 4_100;

export type VerifyAndEncryptStagedObjectParams = {
  /** Whichever client can see this user's quota: RLS-scoped for a signed-in
   * session, or the service-role client for a server-to-server caller with
   * no session (the inbound-email webhook). */
  supabase: DocuNestSupabaseClient;
  userId: string;
  documentId: string;
  originalFilename: string;
};

export type VerifyAndEncryptStagedObjectResult =
  | {
      status: 'ok';
      finalKey: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string;
    }
  | { status: 'not-found'; message: string }
  | { status: 'unsupported-type'; message: string }
  | { status: 'too-large'; message: string }
  | { status: 'quota-exceeded'; message: string }
  | { status: 'error'; message: string };

/**
 * The verify-sniff-encrypt-store core shared by manual upload
 * (`completeManualUpload`) and the inbound-email webhook
 * (`completeInboundAttachment`) — everything between "an unencrypted object
 * is sitting at a staging key" and "an encrypted object is sitting at its
 * permanent key, verified against the type allow-list, the size cap and the
 * user's quota." Deliberately stops short of the `documents` row insert:
 * the two callers need different columns (`source_type`,
 * `source_message_id`) and different duplicate-handling, so that part stays
 * in each caller.
 *
 * Nothing here trusts the caller's word about the file: every check re-reads
 * the object straight from R2. Any failure along the way deletes whatever
 * was written and returns before the caller can insert a row, so there is
 * never a permanent object left behind with no row pointing at it.
 */
export async function verifyAndEncryptStagedObject(
  params: VerifyAndEncryptStagedObjectParams,
): Promise<VerifyAndEncryptStagedObjectResult> {
  const extension = getFileExtension(params.originalFilename);

  if (!isAllowedDocumentExtension(extension)) {
    return {
      status: 'unsupported-type',
      message: `Files of type "${extension ?? 'unknown'}" are not supported.`,
    };
  }

  const r2 = getR2Client();
  const bucket = getR2BucketName();
  const stagingKey = buildStagingStorageKey(
    params.userId,
    params.documentId,
    params.originalFilename,
  );

  const stagedObject = await headObject(r2, bucket, stagingKey);

  if (!stagedObject) {
    return {
      status: 'not-found',
      message:
        'We could not find that upload — it may have failed, expired, or already been completed.',
    };
  }

  const actualSizeBytes = stagedObject.contentLengthBytes;

  if (actualSizeBytes <= 0 || actualSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);
    return { status: 'too-large', message: 'Files must be no larger than 25MB.' };
  }

  const usage = await getStorageUsage(params.userId, params.supabase);

  if (!usage) {
    return {
      status: 'error',
      message: 'Could not verify storage usage. Please try again.',
    };
  }

  if (wouldExceedQuota(usage, actualSizeBytes)) {
    await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);
    return {
      status: 'quota-exceeded',
      message: 'This upload would put the account over its storage limit.',
    };
  }

  const sniffSample = await getObjectBuffer(r2, bucket, stagingKey, {
    startInclusive: 0,
    endInclusive: Math.min(TYPE_SNIFF_BYTE_COUNT, actualSizeBytes) - 1,
  });
  const sniffed = await sniffFileType(sniffSample);
  const typeCheck = matchesDeclaredExtension(extension, sniffed, sniffSample);

  if (!typeCheck.ok) {
    await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);
    return { status: 'unsupported-type', message: typeCheck.reason };
  }

  const plaintext = await getObjectBuffer(r2, bucket, stagingKey);

  if (plaintext.length !== actualSizeBytes) {
    await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);
    return {
      status: 'error',
      message: 'The uploaded file could not be verified. Please try again.',
    };
  }

  const masterKey = parseMasterKey(
    getStorageEnvironment().DOCUMENT_ENCRYPTION_MASTER_KEY,
  );
  const encrypted = encryptFileBuffer(masterKey, plaintext);
  const checksumSha256 = createHash('sha256').update(plaintext).digest('hex');
  const finalKey = buildDocumentStorageKey(
    params.userId,
    params.documentId,
    params.originalFilename,
  );

  try {
    await putObject(r2, bucket, finalKey, encrypted.ciphertext, {
      // The object's own bytes are now ciphertext, not the original file
      // format, so a generic content type is stored on the object itself.
      // The real, magic-byte-verified mime type is recorded in the
      // `documents` row instead.
      contentType: 'application/octet-stream',
      metadata: {
        [ENCRYPTION_METADATA_KEYS.iv]: encrypted.iv.toString('base64'),
        [ENCRYPTION_METADATA_KEYS.encryptedDataKey]:
          encrypted.encryptedDataKey.toString('base64'),
        [ENCRYPTION_METADATA_KEYS.originalSizeBytes]: String(plaintext.length),
      },
    });
  } catch (error) {
    console.error(
      `[document-ingest] failed to write encrypted object (documentId=${params.documentId})`,
      error,
    );
    return {
      status: 'error',
      message: 'Could not store the uploaded file. Please try again.',
    };
  }

  // Best-effort: the staging object sits under a prefix that should also
  // carry a bucket lifecycle rule expiring it after ~24h, as a backstop for
  // any cleanup call that fails to run (e.g. the server crashes right here).
  await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);

  return {
    status: 'ok',
    finalKey,
    mimeType: typeCheck.mimeType,
    sizeBytes: plaintext.length,
    checksumSha256,
  };
}

type TypeMatchResult =
  | { ok: true; mimeType: string }
  | { ok: false; reason: string };

function matchesDeclaredExtension(
  extension: AllowedDocumentExtension,
  sniffed: SniffedFileType | undefined,
  sampleBuffer: Buffer,
): TypeMatchResult {
  if (extension === 'csv') {
    if (sniffed) {
      return {
        ok: false,
        reason: `This file's content looks like a ${sniffed.mime} file, not a CSV.`,
      };
    }

    if (!looksLikePlainText(sampleBuffer)) {
      return {
        ok: false,
        reason: "This file's content does not look like plain-text CSV.",
      };
    }

    return { ok: true, mimeType: 'text/csv' };
  }

  const allowedMimeTypes = EXTENSION_MIME_TYPES[extension];

  if (!sniffed || !allowedMimeTypes.includes(sniffed.mime)) {
    return {
      ok: false,
      reason: sniffed
        ? `This file's content looks like a ${sniffed.mime} file, not a .${extension} file.`
        : `This file's content could not be verified as a .${extension} file.`,
    };
  }

  return { ok: true, mimeType: sniffed.mime };
}

// Re-exported so callers that only need the allow-list constant (e.g. to
// build a user-facing error message) don't need a second import path.
export { ALLOWED_DOCUMENT_EXTENSIONS };

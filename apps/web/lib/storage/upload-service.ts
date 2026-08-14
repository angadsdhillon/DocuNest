import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import {
  buildDocumentStorageKey,
  buildStagingStorageKey,
  createPresignedPutUrl,
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
import type { DocumentRecord } from '@docunest/shared-types';

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
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Bytes read from a staged object to sniff its real file type. Every format
 * in the allow-list identifies itself well within the first few KB (PDF,
 * PNG and JPEG within the first dozen bytes; the zip-based Office formats
 * and HEIC's ftyp box need a bit more), so this avoids downloading the
 * whole object twice for the common case where it will be rejected.
 */
const TYPE_SNIFF_BYTE_COUNT = 4_100;

/** How long a presigned staging upload URL stays valid. */
const STAGING_UPLOAD_URL_TTL_SECONDS = 5 * 60;

// ---------------------------------------------------------------------------
// Step 1 — issue a presigned upload URL
// ---------------------------------------------------------------------------

export type CreateUploadTicketParams = {
  userId: string;
  originalFilename: string;
  declaredMimeType: string;
  declaredSizeBytes: number;
};

export type CreateUploadTicketResult =
  | {
      status: 'ok';
      documentId: string;
      uploadUrl: string;
      originalFilename: string;
      expiresInSeconds: number;
    }
  | { status: 'unsupported-type'; message: string }
  | { status: 'too-large'; message: string }
  | { status: 'quota-exceeded'; message: string }
  | { status: 'error'; message: string };

/**
 * Validates the requested upload against the type allow-list, the hard size
 * cap, and the user's remaining storage quota, then hands back a presigned
 * URL for a *staging* key — never the file's final key. Encryption has to
 * happen server-side (see `completeManualUpload`), so nothing durable is
 * created here yet: no `documents` row, and the object this URL points at is
 * temporary and unencrypted.
 */
export async function createUploadTicket(
  params: CreateUploadTicketParams,
): Promise<CreateUploadTicketResult> {
  const extension = getFileExtension(params.originalFilename);

  if (!isAllowedDocumentExtension(extension)) {
    return {
      status: 'unsupported-type',
      message: `Files of type "${extension ?? 'unknown'}" are not supported. Allowed types: ${ALLOWED_DOCUMENT_EXTENSIONS.join(', ')}.`,
    };
  }

  if (
    params.declaredSizeBytes <= 0 ||
    params.declaredSizeBytes > MAX_UPLOAD_SIZE_BYTES
  ) {
    return {
      status: 'too-large',
      message: 'Files must be no larger than 25MB.',
    };
  }

  const usage = await getStorageUsage(params.userId);

  if (!usage) {
    return {
      status: 'error',
      message: 'Could not check your storage usage. Please try again.',
    };
  }

  if (wouldExceedQuota(usage, params.declaredSizeBytes)) {
    return {
      status: 'quota-exceeded',
      message:
        'This upload would put you over your storage limit. Delete something first, or upgrade your plan.',
    };
  }

  const documentId = randomUUID();
  const stagingKey = buildStagingStorageKey(
    params.userId,
    documentId,
    params.originalFilename,
  );

  const uploadUrl = await createPresignedPutUrl(
    getR2Client(),
    getR2BucketName(),
    stagingKey,
    STAGING_UPLOAD_URL_TTL_SECONDS,
  );

  return {
    status: 'ok',
    documentId,
    uploadUrl,
    // Echoed back so the client sends exactly the same (sanitized) name to
    // `completeManualUpload` that the staging key was built from.
    originalFilename: filenameFromStagingKey(stagingKey),
    expiresInSeconds: STAGING_UPLOAD_URL_TTL_SECONDS,
  };
}

function filenameFromStagingKey(stagingKey: string): string {
  const segments = stagingKey.split('/');
  return segments[segments.length - 1];
}

// ---------------------------------------------------------------------------
// Step 2 — verify, encrypt, and finalize the upload
// ---------------------------------------------------------------------------

export type CompleteUploadParams = {
  userId: string;
  documentId: string;
  originalFilename: string;
};

export type CompleteUploadResult =
  | { status: 'ok'; document: DocumentRecord }
  | { status: 'not-found'; message: string }
  | { status: 'unsupported-type'; message: string }
  | { status: 'too-large'; message: string }
  | { status: 'quota-exceeded'; message: string }
  | { status: 'error'; message: string };

/**
 * Called once the client's direct-to-R2 upload finishes. Nothing here trusts
 * the client's word that the upload succeeded: every check re-reads the
 * object straight from R2.
 *
 * Flow: confirm the staged object really exists and read its real size ->
 * re-check the size cap and quota against that real size -> sniff the file's
 * actual content and confirm it matches the claimed extension -> download,
 * encrypt, and write it to its permanent key -> delete the staging object ->
 * insert the `documents` row. Any failure along the way deletes whatever
 * was written and returns before a `documents` row is created, so there is
 * never a row pointing at a file that isn't safely stored, and never a
 * permanent object left behind for a row that doesn't exist.
 */
export async function completeManualUpload(
  params: CompleteUploadParams,
): Promise<CompleteUploadResult> {
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
        'We could not find that upload — it may have failed, expired, or already been completed. Please try uploading again.',
    };
  }

  const actualSizeBytes = stagedObject.contentLengthBytes;

  if (actualSizeBytes <= 0 || actualSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);
    return { status: 'too-large', message: 'Files must be no larger than 25MB.' };
  }

  const usage = await getStorageUsage(params.userId);

  if (!usage) {
    return {
      status: 'error',
      message: 'Could not verify your storage usage. Please try again.',
    };
  }

  if (wouldExceedQuota(usage, actualSizeBytes)) {
    await deleteObjectIgnoringNotFound(r2, bucket, stagingKey);
    return {
      status: 'quota-exceeded',
      message:
        'This upload would put you over your storage limit. Delete something first, or upgrade your plan.',
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
      `[upload] failed to write encrypted object (documentId=${params.documentId})`,
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

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      id: params.documentId,
      user_id: params.userId,
      category_id: null,
      source_type: 'manual_upload',
      original_filename: params.originalFilename,
      mime_type: typeCheck.mimeType,
      file_size_bytes: plaintext.length,
      storage_key: finalKey,
      checksum_sha256: checksumSha256,
      status: 'processing',
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error(
      `[upload] failed to create document row after storing file (documentId=${params.documentId}, code=${error?.code ?? 'no_row'})`,
    );
    // Don't leave an orphaned encrypted object with no database row pointing
    // at it — better to make the user retry the whole upload.
    await deleteObjectIgnoringNotFound(r2, bucket, finalKey);
    return {
      status: 'error',
      message:
        'The upload succeeded but could not be recorded. Please try again.',
    };
  }

  const document: DocumentRecord = {
    id: data.id,
    user_id: data.user_id,
    category_id: data.category_id,
    source_type: 'manual_upload',
    source_message_id: data.source_message_id,
    original_filename: data.original_filename,
    mime_type: data.mime_type,
    file_size_bytes: data.file_size_bytes,
    storage_key: data.storage_key,
    checksum_sha256: data.checksum_sha256,
    ai_summary: data.ai_summary,
    ai_confidence: data.ai_confidence,
    status: 'processing',
    deleted_at: data.deleted_at,
    created_at: data.created_at,
  };

  return { status: 'ok', document };
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
        reason: `This file's content looks like a ${sniffed.mime} file, not a CSV — please check the file and try again.`,
      };
    }

    if (!looksLikePlainText(sampleBuffer)) {
      return {
        ok: false,
        reason:
          "This file's content does not look like plain-text CSV — please check the file and try again.",
      };
    }

    return { ok: true, mimeType: 'text/csv' };
  }

  const allowedMimeTypes = EXTENSION_MIME_TYPES[extension];

  if (!sniffed || !allowedMimeTypes.includes(sniffed.mime)) {
    return {
      ok: false,
      reason: sniffed
        ? `This file's content looks like a ${sniffed.mime} file, not a .${extension} file — please check the file and try again.`
        : `This file's content could not be verified as a .${extension} file — please check the file and try again.`,
    };
  }

  return { ok: true, mimeType: sniffed.mime };
}

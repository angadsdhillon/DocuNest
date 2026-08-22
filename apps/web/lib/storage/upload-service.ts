import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  buildStagingStorageKey,
  createPresignedPutUrl,
  deleteObjectIgnoringNotFound,
} from '@docunest/storage';
import type { DocumentRecord } from '@docunest/shared-types';

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  getFileExtension,
  isAllowedDocumentExtension,
  MAX_UPLOAD_SIZE_BYTES,
} from '@/lib/documents/upload-constraints';
import { enqueueDocumentProcessing } from '@/lib/queue/document-processing-queue';
import { verifyAndEncryptStagedObject } from '@/lib/storage/document-ingest';
import { getR2BucketName, getR2Client } from '@/lib/storage/r2-client';
import { getStorageUsage, wouldExceedQuota } from '@/lib/storage/quota-service';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
 * the client's word that the upload succeeded — `verifyAndEncryptStagedObject`
 * re-reads the object straight from R2, checks it against the type
 * allow-list, the size cap and quota, then encrypts it into its permanent
 * key. This function's own job is just the manual-upload-specific part:
 * inserting the `documents` row with `source_type: 'manual_upload'` and
 * enqueuing processing. Any failure along the way returns before a
 * `documents` row is created, so there is never a row pointing at a file
 * that isn't safely stored, and never a permanent object left behind for a
 * row that doesn't exist.
 */
export async function completeManualUpload(
  params: CompleteUploadParams,
): Promise<CompleteUploadResult> {
  const supabase = createSupabaseServerClient();

  const verified = await verifyAndEncryptStagedObject({
    supabase,
    userId: params.userId,
    documentId: params.documentId,
    originalFilename: params.originalFilename,
  });

  if (verified.status !== 'ok') {
    return verified;
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      id: params.documentId,
      user_id: params.userId,
      category_id: null,
      source_type: 'manual_upload',
      original_filename: params.originalFilename,
      mime_type: verified.mimeType,
      file_size_bytes: verified.sizeBytes,
      storage_key: verified.finalKey,
      checksum_sha256: verified.checksumSha256,
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
    await deleteObjectIgnoringNotFound(getR2Client(), getR2BucketName(), verified.finalKey);
    return {
      status: 'error',
      message:
        'The upload succeeded but could not be recorded. Please try again.',
    };
  }

  // Enqueue Phase 3's processing pipeline (virus scan, extraction, AI
  // classification) now that the encrypted file and its row both exist.
  // Best-effort by design — see `enqueueDocumentProcessing`'s doc comment.
  await enqueueDocumentProcessing(params.documentId);

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
    ai_entities: null,
    ai_suggested_category: data.ai_suggested_category,
    status: 'processing',
    deleted_at: data.deleted_at,
    created_at: data.created_at,
  };

  return { status: 'ok', document };
}

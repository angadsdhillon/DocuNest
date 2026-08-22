import 'server-only';

import { buildStagingStorageKey, createPresignedPutUrl } from '@docunest/storage';

import { deriveDeterministicDocumentId } from '@/lib/inbound-email/attachment-id';
import { resolveUserIdByInboundToken } from '@/lib/inbound-email/token-lookup';
import {
  getFileExtension,
  isAllowedDocumentExtension,
  MAX_UPLOAD_SIZE_BYTES,
} from '@/lib/documents/upload-constraints';
import { enqueueDocumentProcessing } from '@/lib/queue/document-processing-queue';
import { verifyAndEncryptStagedObject } from '@/lib/storage/document-ingest';
import { getR2BucketName, getR2Client } from '@/lib/storage/r2-client';
import { getStorageUsage, wouldExceedQuota } from '@/lib/storage/quota-service';
import { getSupabaseServiceClient } from '@/lib/supabase/service-client';

/** Same TTL as the manual-upload staging URL — see `upload-service.ts`. */
const STAGING_UPLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Every "we're not going to process this" outcome uses the same shape and
 * carries no attachment content or email text — only a reason code, safe to
 * log. `invalid-token` in particular must never produce an HTTP response
 * distinguishable from any other skip reason (see `token-lookup.ts`), so
 * every reason funnels through this one type.
 */
export type InboundSkipReason =
  | 'invalid-token'
  | 'rate-limited'
  | 'unsupported-type'
  | 'too-large'
  | 'quota-exceeded'
  | 'not-found'
  | 'duplicate'
  | 'error';

// ---------------------------------------------------------------------------
// Step 1 — issue a presigned upload URL for one attachment
// ---------------------------------------------------------------------------

export type CreateInboundAttachmentTicketParams = {
  token: string;
  filename: string;
  declaredSizeBytes: number;
  /** Deterministic per email (Message-ID header, or a Worker-computed
   * fallback) — see `attachment-id.ts` for why this has to be stable
   * across a retried delivery. */
  sourceMessageId: string;
  /** Position of this attachment within the email, so two attachments that
   * happen to share a filename still get distinct derived ids. */
  attachmentIndex: number;
};

export type CreateInboundAttachmentTicketResult =
  | { status: 'ok'; documentId: string; uploadUrl: string; expiresInSeconds: number }
  | { status: 'skip'; reason: InboundSkipReason };

export async function createInboundAttachmentTicket(
  params: CreateInboundAttachmentTicketParams,
): Promise<CreateInboundAttachmentTicketResult> {
  const userId = await resolveUserIdByInboundToken(params.token);

  if (!userId) {
    return { status: 'skip', reason: 'invalid-token' };
  }

  const extension = getFileExtension(params.filename);

  if (!isAllowedDocumentExtension(extension)) {
    return { status: 'skip', reason: 'unsupported-type' };
  }

  if (
    params.declaredSizeBytes <= 0 ||
    params.declaredSizeBytes > MAX_UPLOAD_SIZE_BYTES
  ) {
    return { status: 'skip', reason: 'too-large' };
  }

  const supabase = getSupabaseServiceClient();
  const usage = await getStorageUsage(userId, supabase);

  if (!usage) {
    return { status: 'skip', reason: 'error' };
  }

  if (wouldExceedQuota(usage, params.declaredSizeBytes)) {
    return { status: 'skip', reason: 'quota-exceeded' };
  }

  const documentId = deriveDeterministicDocumentId(
    userId,
    params.sourceMessageId,
    params.attachmentIndex,
    params.filename,
  );

  // A retried delivery of an attachment we've already fully processed
  // shouldn't even get a staging URL — cheaper to stop here than to let the
  // Worker upload bytes we're going to discard as a duplicate in step 2.
  const { data: existing } = await supabase
    .from('documents')
    .select('id')
    .eq('id', documentId)
    .maybeSingle();

  if (existing) {
    return { status: 'skip', reason: 'duplicate' };
  }

  const stagingKey = buildStagingStorageKey(userId, documentId, params.filename);
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
    expiresInSeconds: STAGING_UPLOAD_URL_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — verify, encrypt, and finalize one attachment
// ---------------------------------------------------------------------------

export type CompleteInboundAttachmentParams = {
  token: string;
  documentId: string;
  filename: string;
  sourceMessageId: string;
  /**
   * Accepted because the phase spec calls for the Worker to send them, but
   * deliberately unused beyond request validation: there is no `documents`
   * column for either yet, and the security rules for this app forbid
   * logging anything that identifies a sender or quotes email content. A
   * future phase that wants to show "forwarded from x@y.com" in the UI
   * should add real columns for these rather than starting to log them.
   */
  senderAddress: string;
  subject: string;
};

export type CompleteInboundAttachmentResult =
  | { status: 'ok'; duplicate: boolean }
  | { status: 'skip'; reason: InboundSkipReason };

export async function completeInboundAttachment(
  // `senderAddress` / `subject` intentionally unread — see the doc comment
  // on `CompleteInboundAttachmentParams`.
  params: CompleteInboundAttachmentParams,
): Promise<CompleteInboundAttachmentResult> {
  const userId = await resolveUserIdByInboundToken(params.token);

  if (!userId) {
    return { status: 'skip', reason: 'invalid-token' };
  }

  const supabase = getSupabaseServiceClient();

  // A retried delivery lands on the exact same deterministic id (see
  // `attachment-id.ts`) — check for it up front, before touching R2 at all,
  // so a duplicate never re-triggers the encrypt/quota/storage work, and
  // never risks disturbing the object the *first* delivery already wrote.
  const { data: existing } = await supabase
    .from('documents')
    .select('id')
    .eq('id', params.documentId)
    .maybeSingle();

  if (existing) {
    return { status: 'ok', duplicate: true };
  }

  const verified = await verifyAndEncryptStagedObject({
    supabase,
    userId,
    documentId: params.documentId,
    originalFilename: params.filename,
  });

  if (verified.status !== 'ok') {
    if (verified.status === 'error') {
      return { status: 'skip', reason: 'error' };
    }
    return { status: 'skip', reason: verified.status };
  }

  const { error } = await supabase.from('documents').insert({
    id: params.documentId,
    user_id: userId,
    category_id: null,
    source_type: 'forwarded_email',
    source_message_id: params.sourceMessageId,
    original_filename: params.filename,
    mime_type: verified.mimeType,
    file_size_bytes: verified.sizeBytes,
    storage_key: verified.finalKey,
    checksum_sha256: verified.checksumSha256,
    status: 'processing',
  });

  if (error) {
    if (error.code === '23505') {
      // A concurrent duplicate delivery won the race to insert first. The
      // object we just wrote is at the exact same deterministic key the
      // winning row now points at (harmless to leave in place — its own
      // embedded IV/wrapped key metadata is self-consistent regardless of
      // which of the two identical writes happened last), so there is
      // nothing to clean up.
      return { status: 'ok', duplicate: true };
    }

    console.error(
      `[inbound-email] failed to insert document row (documentId=${params.documentId}, code=${error.code})`,
    );
    return { status: 'skip', reason: 'error' };
  }

  await enqueueDocumentProcessing(params.documentId);

  return { status: 'ok', duplicate: false };
}

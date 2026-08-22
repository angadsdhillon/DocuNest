import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getInboundEmailEnvironment } from '@/lib/inbound-email/env';
import { completeInboundAttachment } from '@/lib/inbound-email/inbound-email-service';
import {
  INBOUND_WORKER_SHARED_SECRET_HEADER,
  isValidSharedSecret,
} from '@/lib/inbound-email/shared-secret';

export const runtime = 'nodejs';

const requestBodySchema = z.object({
  token: z.string().min(1).max(64),
  documentId: z.uuid(),
  filename: z.string().min(1).max(255),
  sourceMessageId: z.string().min(1).max(998),
  // Accepted per the phase spec but not yet persisted or logged anywhere —
  // see the doc comment on `CompleteInboundAttachmentParams`.
  senderAddress: z.string().min(1).max(998),
  subject: z.string().max(998),
});

/**
 * Step 2 of 2 for one inbound-email attachment. Called by the Cloudflare
 * Worker after it finishes PUTting the attachment's bytes to the presigned
 * URL from `attachment-url`. Re-verifies everything server-side exactly
 * like manual upload's `upload-complete` does (real size from R2, real
 * magic-byte type, quota against actual bytes) via the same
 * `verifyAndEncryptStagedObject` used there, then inserts the `documents`
 * row with `source_type: 'forwarded_email'` and enqueues the same
 * `process_document` job from Phase 3.
 *
 * Request:  { token, documentId, filename, sourceMessageId }
 * Response: { status: 'ok', duplicate: boolean } | { status: 'skip', reason }
 *
 * Always 200 for anything short of a bad shared secret or malformed body —
 * see `attachment-url/route.ts` for why. In particular, a duplicate
 * delivery of an email already fully processed returns `{ status: 'ok',
 * duplicate: true }`, not an error, so the Worker (and whatever mail
 * transfer agent retried the delivery) never has a reason to retry again.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const environment = getInboundEmailEnvironment();
  const providedSecret = request.headers.get(
    INBOUND_WORKER_SHARED_SECRET_HEADER,
  );

  if (
    !isValidSharedSecret(
      providedSecret,
      environment.INBOUND_WORKER_SHARED_SECRET,
    )
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = requestBodySchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid attachment-complete request.' },
      { status: 400 },
    );
  }

  const result = await completeInboundAttachment({
    token: parsed.data.token,
    documentId: parsed.data.documentId,
    filename: parsed.data.filename,
    sourceMessageId: parsed.data.sourceMessageId,
    senderAddress: parsed.data.senderAddress,
    subject: parsed.data.subject,
  });

  return NextResponse.json(result);
}

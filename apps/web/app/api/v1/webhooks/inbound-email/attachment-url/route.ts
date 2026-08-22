import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getInboundEmailEnvironment } from '@/lib/inbound-email/env';
import { createInboundAttachmentTicket } from '@/lib/inbound-email/inbound-email-service';
import { consumeHourlyAttachmentRateLimit } from '@/lib/inbound-email/rate-limit';
import {
  INBOUND_WORKER_SHARED_SECRET_HEADER,
  isValidSharedSecret,
} from '@/lib/inbound-email/shared-secret';

export const runtime = 'nodejs';

const requestBodySchema = z.object({
  token: z.string().min(1).max(64),
  filename: z.string().min(1).max(255),
  declaredSizeBytes: z.number().int().positive(),
  sourceMessageId: z.string().min(1).max(998), // RFC 5322 header line length cap
  attachmentIndex: z.number().int().min(0),
});

/**
 * Step 1 of 2 for one inbound-email attachment (see `attachment-complete`
 * for step 2). Called by the Cloudflare Worker in `/cloudflare-worker` once
 * per qualifying attachment. Issues a presigned R2 staging URL so the
 * Worker can PUT the attachment's bytes directly to R2 — bypassing this
 * Next.js route entirely for the actual file bytes, since Vercel's
 * Function body-size limit (4.5MB, not configurable) is well under the
 * 25MB attachment cap this needs to support. This route's body is always
 * small JSON; only the presigned-URL PUT that follows carries file bytes.
 *
 * Request:  { token, filename, declaredSizeBytes, sourceMessageId, attachmentIndex }
 * Response: { status: 'ok', documentId, uploadUrl, expiresInSeconds }
 *         | { status: 'skip', reason }
 *
 * Always responds 200 for anything short of a bad shared secret or a
 * malformed body — an invalid token, a rate limit, an unsupported type, and
 * so on are all ordinary "don't process this" outcomes, not errors, and
 * must never be distinguishable by HTTP status from one another (see
 * `token-lookup.ts`).
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
      { error: 'Invalid attachment-url request.' },
      { status: 400 },
    );
  }

  const rateLimit = await consumeHourlyAttachmentRateLimit(
    parsed.data.token,
    environment.INBOUND_EMAIL_MAX_ATTACHMENTS_PER_HOUR,
  );

  if (!rateLimit.isAllowed) {
    return NextResponse.json({ status: 'skip', reason: 'rate-limited' });
  }

  const result = await createInboundAttachmentTicket({
    token: parsed.data.token,
    filename: parsed.data.filename,
    declaredSizeBytes: parsed.data.declaredSizeBytes,
    sourceMessageId: parsed.data.sourceMessageId,
    attachmentIndex: parsed.data.attachmentIndex,
  });

  return NextResponse.json(result);
}

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getVerifiedUser } from '@/lib/auth/session';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { completeManualUpload } from '@/lib/storage/upload-service';

export const runtime = 'nodejs';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;

const requestBodySchema = z.object({
  documentId: z.uuid(),
  originalFilename: z.string().min(1).max(255),
});

/**
 * Called after the client's direct-to-R2 PUT to the presigned staging URL
 * finishes. Re-verifies everything server-side (the object actually landed
 * in R2, its real size, its real content type) rather than trusting the
 * client's "I'm done" — then encrypts the file into its permanent key and
 * creates the `documents` row.
 *
 * Request:  { documentId: string; originalFilename: string }
 * Response: { document: DocumentRecord }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getVerifiedUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = consumeRateLimit(
    `upload-complete:${user.id}`,
    MAX_REQUESTS_PER_WINDOW,
    RATE_LIMIT_WINDOW_MS,
  );

  if (!rateLimit.isAllowed) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please slow down and try again shortly.' },
      { status: 429 },
    );
  }

  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = requestBodySchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid upload-complete request.' },
      { status: 400 },
    );
  }

  const result = await completeManualUpload({
    userId: user.id,
    documentId: parsed.data.documentId,
    originalFilename: parsed.data.originalFilename,
  });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({ document: result.document }, { status: 201 });

    case 'not-found':
    case 'unsupported-type':
    case 'too-large':
      return NextResponse.json({ error: result.message }, { status: 400 });

    case 'quota-exceeded':
      return NextResponse.json({ error: result.message }, { status: 403 });

    case 'error':
      return NextResponse.json({ error: result.message }, { status: 500 });
  }
}

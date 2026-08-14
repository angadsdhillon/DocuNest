import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getVerifiedUser } from '@/lib/auth/session';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/documents/upload-constraints';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { createUploadTicket } from '@/lib/storage/upload-service';

export const runtime = 'nodejs';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;

const requestBodySchema = z.object({
  filename: z.string().min(1).max(255),
  declaredMimeType: z.string().max(255),
  declaredSizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES * 2),
});

/**
 * Issues a presigned R2 upload URL for a *staging* location — never a
 * document's final key, since files must be encrypted server-side before
 * they reach their permanent home (see `lib/storage/upload-service.ts`).
 *
 * Request:  { filename: string; declaredMimeType: string; declaredSizeBytes: number }
 * Response: { documentId: string; uploadUrl: string; originalFilename: string; expiresInSeconds: number }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getVerifiedUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimit = consumeRateLimit(
    `upload-url:${user.id}`,
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
      { error: 'Invalid upload request.' },
      { status: 400 },
    );
  }

  const result = await createUploadTicket({
    userId: user.id,
    originalFilename: parsed.data.filename,
    declaredMimeType: parsed.data.declaredMimeType,
    declaredSizeBytes: parsed.data.declaredSizeBytes,
  });

  switch (result.status) {
    case 'ok':
      return NextResponse.json({
        documentId: result.documentId,
        uploadUrl: result.uploadUrl,
        originalFilename: result.originalFilename,
        expiresInSeconds: result.expiresInSeconds,
      });

    case 'unsupported-type':
    case 'too-large':
      return NextResponse.json({ error: result.message }, { status: 400 });

    case 'quota-exceeded':
      return NextResponse.json({ error: result.message }, { status: 403 });

    case 'error':
      return NextResponse.json({ error: result.message }, { status: 500 });
  }
}

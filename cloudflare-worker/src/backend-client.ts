import type { Env } from './env';

const SHARED_SECRET_HEADER = 'x-inbound-worker-secret';

type AttachmentUrlResponse =
  | { status: 'ok'; documentId: string; uploadUrl: string; expiresInSeconds: number }
  | { status: 'skip'; reason: string };

type AttachmentCompleteResponse =
  | { status: 'ok'; duplicate: boolean }
  | { status: 'skip'; reason: string };

async function postJson<T>(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${env.BACKEND_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SHARED_SECRET_HEADER]: env.INBOUND_WORKER_SHARED_SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${path} responded with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export type AttachmentTicketOutcome =
  | { proceed: true; documentId: string; uploadUrl: string }
  | { proceed: false; reason: string };

/** Step 1: ask the backend for a presigned R2 staging URL for one attachment. */
export async function requestAttachmentUploadUrl(
  env: Env,
  params: {
    token: string;
    filename: string;
    declaredSizeBytes: number;
    sourceMessageId: string;
    attachmentIndex: number;
  },
): Promise<AttachmentTicketOutcome> {
  const result = await postJson<AttachmentUrlResponse>(
    env,
    '/api/v1/webhooks/inbound-email/attachment-url',
    params,
  );

  if (result.status !== 'ok') {
    return { proceed: false, reason: result.reason };
  }

  return {
    proceed: true,
    documentId: result.documentId,
    uploadUrl: result.uploadUrl,
  };
}

/** Step 2: after PUTting bytes to the presigned URL, ask the backend to finalize. */
export async function completeAttachmentUpload(
  env: Env,
  params: {
    token: string;
    documentId: string;
    filename: string;
    sourceMessageId: string;
    senderAddress: string;
    subject: string;
  },
): Promise<{ ok: boolean; duplicate: boolean; reason?: string }> {
  const result = await postJson<AttachmentCompleteResponse>(
    env,
    '/api/v1/webhooks/inbound-email/attachment-complete',
    params,
  );

  if (result.status !== 'ok') {
    return { ok: false, duplicate: false, reason: result.reason };
  }

  return { ok: true, duplicate: result.duplicate };
}

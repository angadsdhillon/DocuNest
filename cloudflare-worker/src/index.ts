import PostalMime from 'postal-mime';

import {
  completeAttachmentUpload,
  requestAttachmentUploadUrl,
} from './backend-client';
import { filterQualifyingAttachments } from './attachment-filter';
import type { Env } from './env';
import { deriveSourceMessageId } from './source-message-id';

/**
 * Never appears in any log line below in full — only its first 8
 * characters, enough to correlate related log lines for one delivery
 * without making the full, still-valid inbound address recoverable from
 * `wrangler tail` output.
 */
function redactToken(token: string): string {
  return `${token.slice(0, 8)}…`;
}

/**
 * Pulls the per-user token out of the envelope recipient address
 * (`{token}@{INBOUND_EMAIL_DOMAIN}`). Returns `null` for anything that
 * doesn't match this Worker's configured domain — which should be
 * unreachable in production, since the Email Routing rule only ever
 * delivers mail for that domain to this Worker, but is cheap to check
 * defensively.
 */
function extractRecipientToken(
  envelopeTo: string,
  inboundEmailDomain: string,
): string | null {
  const atIndex = envelopeTo.lastIndexOf('@');
  if (atIndex === -1) {
    return null;
  }

  const localPart = envelopeTo.slice(0, atIndex);
  const domain = envelopeTo.slice(atIndex + 1).toLowerCase();

  if (domain !== inboundEmailDomain.toLowerCase() || localPart.length === 0) {
    return null;
  }

  return localPart;
}

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await handleInboundEmail(message, env);
    } catch (error) {
      // Never let an unexpected error turn into a bounce or rejection — an
      // uncaught exception in an `email()` handler still results in the
      // message being accepted (Cloudflare requires an explicit
      // `setReject`/`forward` to do otherwise), but log defensively anyway
      // so a systematic failure is visible in `wrangler tail` without ever
      // including message content.
      console.error('[inbound-email] unhandled error processing message', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const token = extractRecipientToken(message.to, env.INBOUND_EMAIL_DOMAIN);

  if (!token) {
    console.log(
      '[inbound-email] recipient did not match INBOUND_EMAIL_DOMAIN, ignoring',
    );
    return;
  }

  // `message.raw` is a single-use ReadableStream — buffer it once before
  // handing it to postal-mime, per Cloudflare's Email Workers API.
  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const parsedEmail = await PostalMime.parse(rawBuffer);

  const qualifyingAttachments = filterQualifyingAttachments(
    parsedEmail.attachments,
  );

  if (qualifyingAttachments.length === 0) {
    // Per the phase spec: a plain-text forward with no attachments, or an
    // email whose only attachments were filtered out, is accepted and
    // silently ignored — never bounced, never rejected. Nothing here calls
    // `message.setReject()`.
    console.log('[inbound-email] no qualifying attachments, ignoring', {
      token: redactToken(token),
    });
    return;
  }

  const sourceMessageId = await deriveSourceMessageId(
    parsedEmail,
    message.from,
    message.to,
  );
  const senderAddress = message.from;
  const subject = parsedEmail.subject ?? '';

  for (const [attachmentIndex, attachment] of qualifyingAttachments.entries()) {
    await processAttachment(env, {
      token,
      sourceMessageId,
      attachmentIndex,
      senderAddress,
      subject,
      attachment,
    });
  }
}

async function processAttachment(
  env: Env,
  params: {
    token: string;
    sourceMessageId: string;
    attachmentIndex: number;
    senderAddress: string;
    subject: string;
    attachment: { filename: string; bytes: Uint8Array };
  },
): Promise<void> {
  const logContext = {
    token: redactToken(params.token),
    attachmentIndex: params.attachmentIndex,
    sizeBytes: params.attachment.bytes.byteLength,
  };

  try {
    const ticket = await requestAttachmentUploadUrl(env, {
      token: params.token,
      filename: params.attachment.filename,
      declaredSizeBytes: params.attachment.bytes.byteLength,
      sourceMessageId: params.sourceMessageId,
      attachmentIndex: params.attachmentIndex,
    });

    if (!ticket.proceed) {
      console.log('[inbound-email] attachment skipped before upload', {
        ...logContext,
        reason: ticket.reason,
      });
      return;
    }

    const putResponse = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      body: params.attachment.bytes,
    });

    if (!putResponse.ok) {
      console.error('[inbound-email] staging upload failed', {
        ...logContext,
        httpStatus: putResponse.status,
      });
      return;
    }

    const completion = await completeAttachmentUpload(env, {
      token: params.token,
      documentId: ticket.documentId,
      filename: params.attachment.filename,
      sourceMessageId: params.sourceMessageId,
      senderAddress: params.senderAddress,
      subject: params.subject,
    });

    if (!completion.ok) {
      console.log('[inbound-email] attachment skipped after upload', {
        ...logContext,
        reason: completion.reason,
      });
      return;
    }

    console.log('[inbound-email] attachment processed', {
      ...logContext,
      documentId: ticket.documentId,
      duplicate: completion.duplicate,
    });
  } catch (error) {
    console.error('[inbound-email] attachment processing failed', {
      ...logContext,
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
}

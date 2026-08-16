import 'server-only';

import {
  createDocumentProcessingQueue,
  createQueueRedisConnection,
  enqueueDocumentProcessingJob,
  type ProcessDocumentJobData,
} from '@docunest/queue';
import type { Queue } from 'bullmq';

import { getQueueEnvironment } from '@/lib/queue/env';

let cachedQueue: Queue<ProcessDocumentJobData> | null = null;

/**
 * One BullMQ `Queue` (and its underlying Redis connection) per server
 * process — safe to share across requests, since adding jobs is the only
 * thing this process ever does with it.
 */
function getDocumentProcessingQueue(): Queue<ProcessDocumentJobData> {
  if (cachedQueue) {
    return cachedQueue;
  }

  const connection = createQueueRedisConnection(getQueueEnvironment());
  cachedQueue = createDocumentProcessingQueue(connection);
  return cachedQueue;
}

/**
 * Enqueues background processing (virus scan, extraction, AI
 * classification) for a document that was just recorded by
 * `completeManualUpload`. Never throws — a queue outage must not fail the
 * upload response, since the file is already safely stored and the
 * `documents` row already exists with `status: 'processing'`. Failing here
 * is logged loudly instead: today that means the document stays stuck at
 * "processing" until it is retried by hand (`npm run enqueue-stale`, a
 * later phase) or the worker adds its own reconciliation sweep.
 */
export async function enqueueDocumentProcessing(
  documentId: string,
): Promise<void> {
  try {
    const queue = getDocumentProcessingQueue();
    await enqueueDocumentProcessingJob(queue, documentId);
  } catch (error) {
    console.error(
      `[queue] failed to enqueue document-processing job (documentId=${documentId})`,
      error,
    );
  }
}

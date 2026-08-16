import {
  DOCUMENT_PROCESSING_QUEUE_NAME,
  type ProcessDocumentJobData,
} from '@docunest/queue';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { getWorkerEnvironment } from '../env';
import { logError, logInfo, logWarn } from '../logger';
import { markDocumentFailed } from '../processing/document-repository';
import { processDocumentJob } from '../processing/pipeline';

/**
 * Builds (but does not start listening on) the BullMQ `Worker` that
 * consumes `document-processing` jobs. Concurrency is configurable via
 * `WORKER_CONCURRENCY` (default 3, per Phase 3's spec). Retries (3
 * attempts, exponential backoff) are configured queue-side, on the job
 * itself, when it's enqueued — this file only reacts to a job's *final*
 * failure, after every attempt is exhausted, by moving the document to
 * `failed` so it stops looking stuck at "processing" in the UI.
 */
export function createDocumentProcessingWorker(
  connection: Redis,
): Worker<ProcessDocumentJobData> {
  const environment = getWorkerEnvironment();

  const worker = new Worker<ProcessDocumentJobData>(
    DOCUMENT_PROCESSING_QUEUE_NAME,
    async (job: Job<ProcessDocumentJobData>) => {
      await processDocumentJob(job.data.documentId);
    },
    {
      connection,
      concurrency: environment.WORKER_CONCURRENCY,
    },
  );

  worker.on('completed', (job) => {
    logInfo('Job completed', { documentId: job.data.documentId, jobId: job.id ?? '' });
  });

  worker.on('failed', (job, error) => {
    if (!job) {
      logError('Job failed with no job reference', error);
      return;
    }

    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = attemptsMade >= maxAttempts;

    logError(
      `Job attempt ${attemptsMade}/${maxAttempts} failed`,
      error,
      { documentId: job.data.documentId, jobId: job.id ?? '' },
    );

    if (!isFinalAttempt) {
      return;
    }

    logWarn('Job permanently failed after exhausting retries — marking document failed', {
      documentId: job.data.documentId,
    });

    markDocumentFailed(job.data.documentId).catch((markFailedError: unknown) => {
      logError(
        "Could not mark document failed after the job's retries were exhausted",
        markFailedError,
        { documentId: job.data.documentId },
      );
    });
  });

  return worker;
}

import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';

/**
 * Single queue for turning an uploaded (or, later, forwarded) document into
 * an extracted, virus-scanned, AI-classified, categorized document. Producer
 * (`apps/web`, after a manual upload is confirmed) and consumer
 * (`apps/worker`) must agree on this exact name and job data shape.
 */
export const DOCUMENT_PROCESSING_QUEUE_NAME = 'document-processing';
export const PROCESS_DOCUMENT_JOB_NAME = 'process_document';

export type ProcessDocumentJobData = {
  documentId: string;
};

/**
 * 3 attempts total (the original try plus 2 retries), exponential backoff.
 * Job history is trimmed so Redis doesn't grow unbounded — BullMQ keeps the
 * failed set as its dead-letter queue; jobs land there automatically once
 * `attempts` is exhausted rather than being retried forever.
 */
export const DOCUMENT_PROCESSING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export function createDocumentProcessingQueue(
  connection: ConnectionOptions,
): Queue<ProcessDocumentJobData> {
  return new Queue<ProcessDocumentJobData>(DOCUMENT_PROCESSING_QUEUE_NAME, {
    connection,
  });
}

/**
 * Enqueues processing for one document, using the document's own id as the
 * BullMQ job id. That makes enqueuing idempotent at the queue level: calling
 * this twice for the same document while a job is still waiting or active
 * is a no-op (BullMQ refuses the duplicate `jobId`), so a retried
 * "upload-complete" request can never create two competing jobs for the
 * same document.
 */
export async function enqueueDocumentProcessingJob(
  queue: Queue<ProcessDocumentJobData>,
  documentId: string,
): Promise<void> {
  await queue.add(
    PROCESS_DOCUMENT_JOB_NAME,
    { documentId },
    { ...DOCUMENT_PROCESSING_JOB_OPTIONS, jobId: documentId },
  );
}

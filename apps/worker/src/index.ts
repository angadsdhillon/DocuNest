import { config as loadDotenv } from 'dotenv';

// Loaded before anything else touches `process.env`. `.env.local` (real,
// untracked secrets) takes precedence over `.env` (a checked-in dev
// default, if one exists) — mirrors how apps/web resolves its own env.
loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

import { createQueueRedisConnection } from '@docunest/queue';

import { getWorkerEnvironment } from './env';
import { logError, logInfo } from './logger';
import { createDocumentProcessingWorker } from './queue/document-processing-worker';
import { terminateOcrWorker } from './processing/extraction';

async function main(): Promise<void> {
  const environment = getWorkerEnvironment();

  logInfo('Starting document-processing worker', {
    concurrency: environment.WORKER_CONCURRENCY,
    model: environment.OPENAI_CLASSIFICATION_MODEL,
    nodeEnv: environment.NODE_ENV,
  });

  const connection = createQueueRedisConnection(environment);
  const worker = createDocumentProcessingWorker(connection);

  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logInfo(`Received ${signal} — shutting down gracefully`);

    try {
      await worker.close();
      await terminateOcrWorker();
      connection.disconnect();
    } catch (error) {
      logError('Error during shutdown', error);
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logInfo('Worker is listening for jobs', {
    queue: 'document-processing',
  });
}

main().catch((error: unknown) => {
  logError('Worker failed to start', error);
  process.exit(1);
});

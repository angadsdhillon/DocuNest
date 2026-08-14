import 'server-only';

import { createR2Client, type S3Client } from '@docunest/storage';

import { getStorageEnvironment } from '@/lib/storage/env';

let cachedClient: S3Client | null = null;

/**
 * A single R2 client per server process. Safe to share across requests: the
 * SDK client itself holds no per-user or per-request state.
 */
export function getR2Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const environment = getStorageEnvironment();

  cachedClient = createR2Client({
    accountId: environment.R2_ACCOUNT_ID,
    accessKeyId: environment.R2_ACCESS_KEY_ID,
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
    endpoint: environment.R2_ENDPOINT,
  });

  return cachedClient;
}

export function getR2BucketName(): string {
  return getStorageEnvironment().R2_BUCKET_NAME;
}

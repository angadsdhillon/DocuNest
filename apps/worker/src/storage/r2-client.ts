import { createR2Client, type S3Client } from '@docunest/storage';

import { getWorkerEnvironment } from '../env';

let cachedClient: S3Client | null = null;

export function getR2Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const environment = getWorkerEnvironment();

  cachedClient = createR2Client({
    accountId: environment.R2_ACCOUNT_ID,
    accessKeyId: environment.R2_ACCESS_KEY_ID,
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
    endpoint: environment.R2_ENDPOINT,
  });

  return cachedClient;
}

export function getR2BucketName(): string {
  return getWorkerEnvironment().R2_BUCKET_NAME;
}

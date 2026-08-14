import { S3Client } from '@aws-sdk/client-s3';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Full R2 S3-API endpoint, e.g. https://<accountId>.r2.cloudflarestorage.com */
  endpoint: string;
};

/**
 * Creates an S3-compatible client pointed at Cloudflare R2.
 *
 * Only the S3-compatible subset of the AWS SDK is used here — no
 * AWS-specific extras (STS, IAM, SSO, etc.) — since R2 only implements the
 * S3 API surface. `region` is fixed to `auto` because R2 does not have AWS
 * regions.
 */
export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 does not support the AWS SDK v3's newer flexible-checksum requests
    // (it rejects/mishandles the extra `x-amz-checksum-*` headers on some
    // operations). Restricting checksum behaviour to "only when the caller
    // explicitly asks for one" keeps every request compatible with R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export type { S3Client } from '@aws-sdk/client-s3';

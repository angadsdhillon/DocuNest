import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * All direct AWS SDK usage for R2 is kept in this one module, so both
 * `apps/web` and (in later phases) `apps/worker` only ever call these small,
 * intention-revealing functions instead of importing the S3 SDK themselves.
 */

export async function createPresignedPutUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresInSeconds: number,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export type ObjectHead = {
  contentLengthBytes: number;
  metadata: Record<string, string>;
};

/** Returns `null` if the object does not exist, rather than throwing. */
export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<ObjectHead | null> {
  try {
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );

    return {
      contentLengthBytes: result.ContentLength ?? 0,
      metadata: result.Metadata ?? {},
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export type ByteRange = { startInclusive: number; endInclusive: number };

/**
 * Reads an object's bytes into memory, optionally only a byte range (used to
 * sniff a file's type from just its first few KB without downloading the
 * whole object twice). Documents are capped at 25MB, so buffering the full
 * object for encryption is an acceptable, simple tradeoff at this size.
 */
export async function getObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
  range?: ByteRange,
): Promise<Buffer> {
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: range
        ? `bytes=${range.startInclusive}-${range.endInclusive}`
        : undefined,
    }),
  );

  if (!result.Body) {
    return Buffer.alloc(0);
  }

  const byteArray = await result.Body.transformToByteArray();
  return Buffer.from(byteArray);
}

export type PutObjectOptions = {
  contentType?: string;
  metadata?: Record<string, string>;
};

export async function putObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  options: PutObjectOptions = {},
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      Metadata: options.metadata,
    }),
  );
}

/**
 * Deletes an object, treating "already gone" as success. Used for cleanup
 * paths (removing a staging object, rolling back a failed final write) where
 * the object may legitimately already be absent and that must never be
 * treated as a cleanup failure.
 */
export async function deleteObjectIgnoringNotFound(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return (
      error.name === 'NotFound' ||
      error.$metadata.httpStatusCode === 404
    );
  }
  return false;
}

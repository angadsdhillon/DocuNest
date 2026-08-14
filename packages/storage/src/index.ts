export { createR2Client, type R2Config, type S3Client } from './r2-client';

export {
  buildDocumentStorageKey,
  buildStagingStorageKey,
  sanitizeFilenameForStorageKey,
} from './storage-keys';

export {
  decryptFileBuffer,
  encryptFileBuffer,
  parseMasterKey,
  ENCRYPTION_METADATA_KEYS,
  type EncryptedFile,
} from './encryption';

export {
  looksLikePlainText,
  sniffFileType,
  type SniffedFileType,
} from './file-sniffing';

export {
  createPresignedPutUrl,
  deleteObjectIgnoringNotFound,
  getObjectBuffer,
  headObject,
  putObject,
  type ByteRange,
  type ObjectHead,
  type PutObjectOptions,
} from './object-operations';

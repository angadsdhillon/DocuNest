'use client';

/**
 * Browser-side upload orchestration: request a presigned URL, PUT the file
 * bytes directly to R2 (never through our own server), then tell the API
 * the upload finished. Every function here only performs *convenience*
 * validation — the server re-checks everything that actually matters.
 */

export type UploadUrlResponse = {
  documentId: string;
  uploadUrl: string;
  originalFilename: string;
  expiresInSeconds: number;
};

export type UploadedDocumentSummary = {
  id: string;
  original_filename: string;
  file_size_bytes: number;
  status: string;
};

export class UploadRequestError extends Error {}

export async function requestUploadUrl(file: File): Promise<UploadUrlResponse> {
  const response = await fetch('/api/documents/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      declaredMimeType: file.type || 'application/octet-stream',
      declaredSizeBytes: file.size,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & Partial<UploadUrlResponse>;

  if (!response.ok || !body.documentId || !body.uploadUrl) {
    throw new UploadRequestError(body.error ?? 'Could not start the upload.');
  }

  return {
    documentId: body.documentId,
    uploadUrl: body.uploadUrl,
    originalFilename: body.originalFilename ?? file.name,
    expiresInSeconds: body.expiresInSeconds ?? 0,
  };
}

/**
 * Uploads directly to R2 via XHR (not `fetch`) because only `XHR` exposes
 * upload progress events in browsers today.
 */
export function putFileToUploadUrl(
  file: File,
  uploadUrl: string,
  onProgress: (fractionComplete: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new UploadRequestError(`Upload failed (status ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      reject(new UploadRequestError('Upload failed due to a network error.'));
    };

    xhr.onabort = () => {
      reject(new UploadRequestError('Upload was cancelled.'));
    };

    xhr.send(file);
  });
}

export async function confirmUploadComplete(
  documentId: string,
  originalFilename: string,
): Promise<UploadedDocumentSummary> {
  const response = await fetch('/api/documents/upload-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, originalFilename }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    document?: UploadedDocumentSummary;
  };

  if (!response.ok || !body.document) {
    throw new UploadRequestError(
      body.error ?? 'Could not finish processing the upload.',
    );
  }

  return body.document;
}

'use client';

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react';

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  formatAllowedExtensionsList,
  formatMegabytes,
  getFileExtension,
  isAllowedDocumentExtension,
  MAX_UPLOAD_SIZE_BYTES,
} from '@/lib/documents/upload-constraints';
import {
  confirmUploadComplete,
  putFileToUploadUrl,
  requestUploadUrl,
  type UploadedDocumentSummary,
} from '@/lib/documents/upload-client';

type UploadJobStatus =
  | 'validating'
  | 'requesting-url'
  | 'uploading'
  | 'finalizing'
  | 'done'
  | 'error';

type UploadJob = {
  id: string;
  filename: string;
  status: UploadJobStatus;
  progressFraction: number;
  errorMessage: string | null;
  document: UploadedDocumentSummary | null;
};

/**
 * A convenience-only pass matching the server's real checks (type
 * allow-list, size cap). Never treat this as the security boundary — see
 * `lib/storage/upload-service.ts` for the checks that actually matter.
 */
function validateFileClientSide(file: File): string | null {
  const extension = getFileExtension(file.name);

  if (!isAllowedDocumentExtension(extension)) {
    return `"${file.name}" is a ${extension ? `.${extension}` : 'unrecognized'} file. Allowed types: ${formatAllowedExtensionsList()}.`;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `"${file.name}" is larger than the ${formatMegabytes(MAX_UPLOAD_SIZE_BYTES)} upload limit.`;
  }

  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }

  return null;
}

function createJobId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function UploadZone(): ReactElement {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updateJob = useCallback((jobId: string, patch: Partial<UploadJob>) => {
    setJobs((current) =>
      current.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
    );
  }, []);

  const uploadOneFile = useCallback(
    async (file: File) => {
      const jobId = createJobId();

      setJobs((current) => [
        {
          id: jobId,
          filename: file.name,
          status: 'validating',
          progressFraction: 0,
          errorMessage: null,
          document: null,
        },
        ...current,
      ]);

      const clientError = validateFileClientSide(file);

      if (clientError) {
        updateJob(jobId, { status: 'error', errorMessage: clientError });
        return;
      }

      try {
        updateJob(jobId, { status: 'requesting-url' });
        const ticket = await requestUploadUrl(file);

        updateJob(jobId, { status: 'uploading' });
        await putFileToUploadUrl(file, ticket.uploadUrl, (fraction) => {
          updateJob(jobId, { progressFraction: fraction });
        });

        updateJob(jobId, { status: 'finalizing', progressFraction: 1 });
        const document = await confirmUploadComplete(
          ticket.documentId,
          ticket.originalFilename,
        );

        updateJob(jobId, { status: 'done', document });
      } catch (error) {
        updateJob(jobId, {
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Upload failed.',
        });
      }
    },
    [updateJob],
  );

  const uploadFiles = useCallback(
    (fileList: FileList | File[]) => {
      // Every file uploads and validates independently — one bad file in a
      // batch must never block or cancel the others.
      Array.from(fileList).forEach((file) => {
        void uploadOneFile(file);
      });
    },
    [uploadOneFile],
  );

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files && event.target.files.length > 0) {
      uploadFiles(event.target.files);
    }
    // Reset so selecting the same file again re-triggers onChange.
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDraggingOver(false);

    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      uploadFiles(event.dataTransfer.files);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDraggingOver(false);
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Upload documents
        </h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={ALLOWED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
          onChange={handleInputChange}
        />
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`mt-3 flex min-h-32 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
          isDraggingOver
            ? 'border-neutral-900 bg-neutral-50'
            : 'border-neutral-300'
        }`}
      >
        <p className="text-sm text-neutral-600">
          Drag and drop files here, or use the Upload button above.
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {formatAllowedExtensionsList()} — up to{' '}
          {formatMegabytes(MAX_UPLOAD_SIZE_BYTES)} each
        </p>
      </div>

      {jobs.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {jobs.map((job) => (
            <UploadJobRow key={job.id} job={job} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function UploadJobRow({ job }: { job: UploadJob }): ReactElement {
  return (
    <li className="rounded-xl border border-neutral-200 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium">{job.filename}</span>
        <span className="shrink-0 text-xs text-neutral-500">
          {statusLabel(job)}
        </span>
      </div>

      {job.status === 'uploading' || job.status === 'finalizing' ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-neutral-900 transition-all"
            style={{ width: `${Math.round(job.progressFraction * 100)}%` }}
          />
        </div>
      ) : null}

      {job.status === 'error' && job.errorMessage ? (
        <p className="mt-1 text-xs text-red-700">{job.errorMessage}</p>
      ) : null}
    </li>
  );
}

function statusLabel(job: UploadJob): string {
  switch (job.status) {
    case 'validating':
      return 'Checking…';
    case 'requesting-url':
      return 'Starting…';
    case 'uploading':
      return `Uploading… ${Math.round(job.progressFraction * 100)}%`;
    case 'finalizing':
      return 'Finishing…';
    case 'done':
      return 'Uploaded';
    case 'error':
      return 'Failed';
  }
}

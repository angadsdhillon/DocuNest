import { deleteObjectIgnoringNotFound } from '@docunest/storage';

import { logInfo, logWarn } from '../logger';
import { getR2BucketName, getR2Client } from '../storage/r2-client';
import { decryptDocumentBuffer } from '../storage/decrypt-document';
import { classifyDocument } from './classification';
import {
  fetchCategoriesForUser,
  fetchDocumentForProcessing,
  findNeedsReviewCategorySlug,
  markDocumentClassified,
  markDocumentQuarantined,
  resolveCategoryIdBySlug,
} from './document-repository';
import { extractDocumentText } from './extraction';
import { scanBufferForViruses } from './virus-scan';

/** Below this, a document is filed under "Needs Review" instead of trusting the AI's category guess. */
const MIN_CONFIDENCE_FOR_AUTO_FILING = 0.55;

/**
 * Terminal statuses this pipeline itself produces. If a document already
 * has one of these when a job starts, the earlier attempt already finished
 * — reprocessing it would be redundant (and, for the quarantine path,
 * would try to delete an object that's already gone). `processing` is the
 * only status a job may act on.
 */
const ALREADY_HANDLED_STATUSES = new Set([
  'ready',
  'needs_review',
  'failed',
  'quarantined',
]);

export async function processDocumentJob(documentId: string): Promise<void> {
  const document = await fetchDocumentForProcessing(documentId);

  if (!document) {
    logWarn('Document no longer exists — skipping', { documentId });
    return;
  }

  if (ALREADY_HANDLED_STATUSES.has(document.status)) {
    logInfo('Document already processed — skipping (idempotent no-op)', {
      documentId,
      status: document.status,
    });
    return;
  }

  logInfo('Processing document', { documentId, mimeType: document.mimeType });

  const plaintext = await decryptDocumentBuffer(document.storageKey);

  const scanResult = await scanBufferForViruses(plaintext);

  if (scanResult.scanned && scanResult.infected) {
    logWarn('Virus scan found a threat — quarantining document', {
      documentId,
      virusCount: scanResult.viruses.length,
    });
    await quarantineDocument(documentId, document.storageKey);
    return;
  }

  if (!scanResult.scanned) {
    logWarn('Proceeding without a virus scan result (see prior warning)', {
      documentId,
    });
  }

  const extractedText = await extractDocumentText(plaintext, document.mimeType);

  const categories = await fetchCategoriesForUser(document.userId);
  const classification = await classifyDocument({
    filename: document.originalFilename,
    extractedText,
    categories,
  });

  const needsReviewSlug = findNeedsReviewCategorySlug(categories);
  const resolvedCategoryId = await resolveCategoryIdBySlug(
    document.userId,
    classification.categorySlug,
  );

  const isLowConfidence =
    classification.confidence < MIN_CONFIDENCE_FOR_AUTO_FILING;

  // A model-proposed slug that doesn't resolve to a real category of this
  // user's (e.g. it answered "uncategorized", which is a valid schema value
  // but not an actual folder) has nowhere sensible to land other than
  // Needs Review — there is no "Uncategorized" folder in the taxonomy.
  const useNeedsReview = isLowConfidence || resolvedCategoryId === null;

  if (useNeedsReview && !needsReviewSlug) {
    throw new Error(
      "This user has no 'needs-review' category — cannot file a low-confidence/unresolved document.",
    );
  }

  const finalCategoryId = useNeedsReview
    ? await resolveCategoryIdBySlug(document.userId, needsReviewSlug as string)
    : resolvedCategoryId;

  if (!finalCategoryId) {
    throw new Error('Could not resolve a category id to file this document under.');
  }

  await markDocumentClassified(documentId, {
    status: useNeedsReview ? 'needs_review' : 'ready',
    categoryId: finalCategoryId,
    summary: classification.summary,
    confidence: classification.confidence,
    entities: classification.entities,
    suggestedNewCategory: classification.suggestedNewCategory,
  });

  logInfo('Document processed', {
    documentId,
    status: useNeedsReview ? 'needs_review' : 'ready',
    confidence: classification.confidence,
  });
}

async function quarantineDocument(
  documentId: string,
  storageKey: string,
): Promise<void> {
  // Delete first, mark quarantined second — both steps are individually
  // idempotent (deleting an already-deleted object is a no-op; setting an
  // already-quarantined status again is a no-op), so if the process
  // crashes between them, a retry safely re-runs from a document that is
  // still 'processing' and repeats both steps rather than getting stuck
  // with the file still accessible.
  await deleteObjectIgnoringNotFound(getR2Client(), getR2BucketName(), storageKey);
  await markDocumentQuarantined(documentId);
}

import {
  NEEDS_REVIEW_CATEGORY_SLUG,
  type Database,
  type DocumentAiEntities,
} from '@docunest/shared-types';

import { getSupabaseServiceClient } from '../supabase-client';
import { logError } from '../logger';
import type { CategoryOption } from './classification';

type DocumentsUpdate = Database['public']['Tables']['documents']['Update'];

export type ProcessableDocument = {
  id: string;
  userId: string;
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  status: string;
};

/** Returns `null` if the document no longer exists (e.g. deleted mid-flight). */
export async function fetchDocumentForProcessing(
  documentId: string,
): Promise<ProcessableDocument | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('documents')
    .select('id, user_id, storage_key, mime_type, original_filename, status')
    .eq('id', documentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load document row: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    userId: data.user_id,
    storageKey: data.storage_key,
    mimeType: data.mime_type,
    originalFilename: data.original_filename,
    status: data.status,
  };
}

export async function fetchCategoriesForUser(
  userId: string,
): Promise<CategoryOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('categories')
    .select('slug, name')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to load categories: ${error.message}`);
  }

  return data ?? [];
}

/** Found by slug, per Phase 3's instructions — never assumed to have a fixed id. */
export function findNeedsReviewCategorySlug(
  categories: CategoryOption[],
): string | null {
  const match = categories.find(
    (category) => category.slug === NEEDS_REVIEW_CATEGORY_SLUG,
  );
  return match ? match.slug : null;
}

async function updateDocumentStatus(
  documentId: string,
  patch: DocumentsUpdate,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from('documents')
    .update(patch)
    .eq('id', documentId);

  if (error) {
    throw new Error(`Failed to update document status: ${error.message}`);
  }
}

export async function markDocumentQuarantined(
  documentId: string,
): Promise<void> {
  await updateDocumentStatus(documentId, { status: 'quarantined' });
}

export async function markDocumentFailed(documentId: string): Promise<void> {
  await updateDocumentStatus(documentId, { status: 'failed' });
}

export async function markDocumentClassified(
  documentId: string,
  params: {
    status: 'ready' | 'needs_review';
    categoryId: string;
    summary: string;
    confidence: number;
    entities: DocumentAiEntities;
    suggestedNewCategory: string | null;
  },
): Promise<void> {
  await updateDocumentStatus(documentId, {
    status: params.status,
    category_id: params.categoryId,
    ai_summary: params.summary,
    ai_confidence: params.confidence,
    ai_entities: params.entities,
    ai_suggested_category: params.suggestedNewCategory,
  });
}

export async function resolveCategoryIdBySlug(
  userId: string,
  slug: string,
): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    logError('Failed to resolve category id by slug', error, {
      documentUserId: userId,
    });
    return null;
  }

  return data?.id ?? null;
}

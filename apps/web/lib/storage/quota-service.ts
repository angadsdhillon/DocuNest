import 'server-only';

import type { DocuNestSupabaseClient } from '@/lib/supabase/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type StorageUsage = {
  usedBytes: number;
  limitBytes: number;
};

/**
 * Sums a user's active (non-deleted) documents against their plan's storage
 * allowance. Defaults to the request-scoped, RLS-bound client (the normal
 * case: a signed-in user checking their own quota during manual upload), but
 * accepts an explicit client so server-to-server callers with no user
 * session — the inbound-email webhook, which authenticates via a shared
 * secret instead of a Supabase session and must check an arbitrary user's
 * quota by id — can pass in the service-role client instead. Row Level
 * Security (for the default client) or the explicit `userId` filter (for
 * the service-role client) both ensure this can never see or count another
 * user's bytes.
 *
 * Reads every row's `file_size_bytes` and sums client-side rather than
 * using a database aggregate — simplest option at v1's scale. If document
 * counts per user grow large enough for this to matter, replace with a
 * Postgres function (or a running counter column) rather than changing this
 * function's signature.
 */
export async function getStorageUsage(
  userId: string,
  supabase: DocuNestSupabaseClient = createSupabaseServerClient(),
): Promise<StorageUsage | null> {
  const [profileResult, documentsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('storage_limit_bytes')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('documents')
      .select('file_size_bytes')
      .eq('user_id', userId)
      .is('deleted_at', null),
  ]);

  if (profileResult.error || !profileResult.data) {
    console.error(
      `[storage] failed to load profile for quota check (code=${profileResult.error?.code ?? 'not_found'})`,
    );
    return null;
  }

  if (documentsResult.error) {
    console.error(
      `[storage] failed to load documents for quota check (code=${documentsResult.error.code})`,
    );
    return null;
  }

  const usedBytes = documentsResult.data.reduce(
    (sum, row) => sum + row.file_size_bytes,
    0,
  );

  return {
    usedBytes,
    limitBytes: profileResult.data.storage_limit_bytes,
  };
}

export function wouldExceedQuota(
  usage: StorageUsage,
  additionalBytes: number,
): boolean {
  return usage.usedBytes + additionalBytes > usage.limitBytes;
}

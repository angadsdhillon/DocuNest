import type {
  Category,
  Profile,
  SubscriptionTier,
} from '@docunest/shared-types';
import { SUBSCRIPTION_TIERS } from '@docunest/shared-types';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AccountOverview = {
  profile: Profile;
  categories: Category[];
};

/**
 * Loads the signed-in user's profile and categories.
 *
 * Row Level Security is what guarantees these queries can only see this user's
 * rows; the explicit `user_id` filter is belt-and-braces and lets Postgres use
 * the per-user indexes.
 */
export async function getAccountOverview(
  userId: string,
): Promise<AccountOverview | null> {
  const supabase = createSupabaseServerClient();

  const [profileResult, categoriesResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true }),
  ]);

  if (profileResult.error) {
    console.error(
      `[profile] failed to load profile (code=${profileResult.error.code})`,
    );
    return null;
  }

  if (categoriesResult.error) {
    console.error(
      `[profile] failed to load categories (code=${categoriesResult.error.code})`,
    );
    return null;
  }

  if (!profileResult.data) {
    return null;
  }

  return {
    profile: {
      ...profileResult.data,
      subscription_tier: toSubscriptionTier(
        profileResult.data.subscription_tier,
      ),
    },
    categories: categoriesResult.data,
  };
}

function toSubscriptionTier(value: string): SubscriptionTier {
  const match = SUBSCRIPTION_TIERS.find((tier) => tier === value);
  return match ?? 'free';
}

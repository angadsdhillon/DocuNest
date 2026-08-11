import { createSupabaseServerClient } from '@/lib/supabase/server';

export type VerifiedUser = {
  id: string;
  email: string | null;
};

/**
 * Returns the signed-in user, or null. Identity comes from `getClaims()`, which
 * verifies the access token's signature — never from `getSession()`, whose user
 * object is only as trustworthy as the cookie it came from.
 */
export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data) {
    return null;
  }

  const { sub, email } = data.claims;

  if (typeof sub !== 'string') {
    return null;
  }

  return {
    id: sub,
    email: typeof email === 'string' ? email : null,
  };
}

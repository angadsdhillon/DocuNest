import 'server-only';

import { getSupabaseServiceClient } from '@/lib/supabase/service-client';

/**
 * Resolves the profile `id` behind an `inbound_address_token`, or `null` if
 * no profile has that token — which happens for a typo'd address, a
 * probing spammer, or a token that was regenerated after this email was
 * sent. Callers must treat `null` exactly the same as any other "don't
 * process this" outcome (see the route handlers): never let it produce a
 * different response than, say, "this attachment was too large", or an
 * outside observer could use response differences to enumerate valid
 * tokens.
 */
export async function resolveUserIdByInboundToken(
  token: string,
): Promise<string | null> {
  if (!token) {
    return null;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('inbound_address_token', token)
    .maybeSingle();

  if (error) {
    console.error(
      `[inbound-email] failed to look up inbound token (code=${error.code})`,
    );
    return null;
  }

  return data?.id ?? null;
}

import 'server-only';

import { z } from 'zod';

/**
 * Environment for the Phase 4 inbound-email webhook, kept in its own module
 * for the same reason `lib/storage/env.ts` and `lib/queue/env.ts` are
 * separate from `lib/env.ts`: the `server-only` import makes it a build
 * error, not just a convention, for any of this to reach client code — and
 * `SUPABASE_SERVICE_ROLE_KEY` in particular must never be importable from
 * anything a browser bundle could pull in. See `lib/supabase/service-client.ts`
 * for why this one route needs it.
 */
const inboundEmailEnvironmentSchema = z.object({
  // The domain the Cloudflare Worker's Email Routing rule is bound to, e.g.
  // "inbound.example.com" for addresses like "{token}@inbound.example.com".
  // Not secret, but validated here so a missing value fails loudly instead
  // of quietly accepting mail sent to the wrong domain.
  INBOUND_EMAIL_DOMAIN: z.string().min(1, 'INBOUND_EMAIL_DOMAIN is required'),

  // Shared secret the Cloudflare Worker sends in the
  // `x-inbound-worker-secret` header on every call to this webhook. Minted
  // by us (not a third-party credential), so it can and should be a long
  // random value with no meaning beyond "this call really came from our
  // Worker" — see the deployment notes for how to generate and set it.
  INBOUND_WORKER_SHARED_SECRET: z
    .string()
    .min(32, 'INBOUND_WORKER_SHARED_SECRET must be at least 32 characters'),

  // Service-role Supabase key — see lib/supabase/service-client.ts.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // Max accepted attachments per inbound token per rolling hour. A
  // configurable env var (not a literal) so it can be tightened or loosened
  // without a code change if real usage patterns turn out different from
  // this guess.
  INBOUND_EMAIL_MAX_ATTACHMENTS_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
});

export type InboundEmailEnvironment = z.infer<
  typeof inboundEmailEnvironmentSchema
>;

let cachedEnvironment: InboundEmailEnvironment | null = null;

export function getInboundEmailEnvironment(): InboundEmailEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  const parsed = inboundEmailEnvironmentSchema.safeParse({
    INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN,
    INBOUND_WORKER_SHARED_SECRET: process.env.INBOUND_WORKER_SHARED_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    INBOUND_EMAIL_MAX_ATTACHMENTS_PER_HOUR:
      process.env.INBOUND_EMAIL_MAX_ATTACHMENTS_PER_HOUR,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(
      `Missing or invalid inbound-email environment variables in apps/web/.env.local — ${problems}`,
    );
  }

  cachedEnvironment = parsed.data;
  return cachedEnvironment;
}

# Cloudflare Worker (inbound email) — Phase 4

Receives mail forwarded to a user's personal inbound address
(`{token}@INBOUND_EMAIL_DOMAIN`) via Cloudflare Email Routing, pulls out
qualifying attachments, and hands each one off to `apps/web`'s
`/api/v1/webhooks/inbound-email/*` routes, which run the exact same
verification, encryption, storage and AI-processing pipeline as manual
upload. This Worker never talks to R2, Supabase, or OpenAI directly, and
never duplicates the encryption/extraction logic that lives in `apps/web`
and `apps/worker` — see `src/index.ts` for why.

Deployed separately from the rest of the monorepo, via Wrangler, onto
Cloudflare's platform — not part of the root npm workspaces or `turbo`
pipeline.

## Why two backend calls per attachment, not one

Vercel's serverless Functions (what a Next.js Route Handler becomes) have a
**hard 4.5MB request-body limit that cannot be raised**. A single POST
carrying attachment bytes — base64 or raw — would reject any attachment
anywhere close to the 25MB cap this needs to support. So each qualifying
attachment goes through two small, bytes-free JSON calls to the backend,
with the actual file bytes going straight to Cloudflare R2 in between,
bypassing the Vercel function entirely:

1. `POST /api/v1/webhooks/inbound-email/attachment-url` — backend validates
   the token, rate limit, extension and declared size, then returns a
   presigned R2 PUT URL (same mechanism manual upload's `upload-url` route
   uses for its staging step).
2. This Worker `PUT`s the attachment's bytes straight to that URL.
3. `POST /api/v1/webhooks/inbound-email/attachment-complete` — backend
   re-verifies the real bytes (magic-byte type check, real size, quota),
   encrypts, stores, inserts the `documents` row, and enqueues the same
   `process_document` job Phase 3 built.

This Worker never holds R2 credentials and never calls R2's API directly —
it only follows a URL the backend already generated, the same as a
browser's manual upload does.

## Local development

```bash
cd cloudflare-worker
npm install
cp .dev.vars.example .dev.vars   # fill in INBOUND_WORKER_SHARED_SECRET
npm run dev
```

`wrangler dev` prints a local endpoint you can POST a raw RFC822 message to
without sending real email — see [Cloudflare's docs on testing Email
Workers locally](https://developers.cloudflare.com/email-routing/email-workers/).
Example, with a small test PDF attached:

```bash
curl -X POST 'http://localhost:8787/cdn-cgi/handler/email' \
  --url-query 'from=someone@example.com' \
  --url-query 'to=<a-real-token-from-your-profiles-table>@inbound.example.com' \
  --header 'Content-Type: message/rfc822' \
  --data-binary @path/to/test-email.eml
```

## Deploying

```bash
cd cloudflare-worker
npm install
npx wrangler login                                    # once, if not already
npx wrangler secret put INBOUND_WORKER_SHARED_SECRET   # paste the same value apps/web uses
npx wrangler deploy
```

Before deploying for real, edit `wrangler.toml`'s `[vars]`:

- `INBOUND_EMAIL_DOMAIN` — the exact domain your Email Routing rule is
  bound to (see the dashboard step below).
- `BACKEND_BASE_URL` — the deployed `apps/web` URL, e.g.
  `https://your-app.vercel.app`.

## What still has to be clicked by hand in the Cloudflare dashboard

Everything above is expressible in code — this one step isn't, because
Email Routing address rules are account/zone configuration, not something
`wrangler deploy` can express:

1. **Email → Email Routing** on the zone `INBOUND_EMAIL_DOMAIN` belongs to.
2. Add a route: **Custom address** for a specific address, or (more likely,
   since tokens are generated per-user and there's no fixed list) a
   **Catch-all address** rule matching `*@INBOUND_EMAIL_DOMAIN` — this is
   why `INBOUND_EMAIL_DOMAIN` should be its own subdomain dedicated to
   inbound document mail (e.g. `inbound.yourdomain.com`), separate from any
   normal mailbox on the root domain, so a catch-all here can't swallow
   unrelated mail.
3. Set the rule's action to **Send to a Worker**, and select
   `docunest-inbound-email` (or whatever `name` is in `wrangler.toml`) from
   the dropdown — it must already be deployed once (`wrangler deploy`) to
   appear here.
4. Cloudflare Email Routing itself (enabling it, verifying DNS/MX records)
   is already done, per the founder.

## Testing end-to-end once deployed

1. Find your own inbound token: it's `profiles.inbound_address_token` for
   your user row (also shown on the dashboard's account settings once
   that's built). Your test address is
   `{that token}@INBOUND_EMAIL_DOMAIN`.
2. Send a real email from any mail client to that address with a small PDF
   (or any allow-listed file type) attached.
3. Within a few seconds, check the `documents` table (Supabase Studio, or
   `select * from documents where source_type = 'forwarded_email' order by
   created_at desc limit 5;`) — a row should appear with `status =
   'processing'`, then transition to `'ready'` (or `'needs_review'`) once
   `apps/worker` finishes classifying it — same as a manual upload.
4. Check the Worker's logs with:

   ```bash
   npx wrangler tail
   ```

   Every log line here is one of `[inbound-email] ...` with only a reason
   code, a redacted 8-character token prefix, byte sizes and IDs — never
   attachment content, never the email body/subject/sender in full, and
   never the complete token. If anything in `wrangler tail` output looks
   like it contains file content or a full email address, that's a bug —
   report it rather than shipping past it.
5. To confirm deduplication: forward (or manually redeliver, if your mail
   provider supports it) the exact same email a second time. A second
   `documents` row must NOT appear — `wrangler tail` should show
   `duplicate: true` in the "attachment processed" log line, and the
   `documents` table should still show only the one row from step 3.

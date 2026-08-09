# DocuNest

Personal document vault SaaS: documents arrive via upload or email
forwarding, get classified by AI, and live in a searchable offline-capable
vault.

## Monorepo layout

Turborepo workspace managed with npm:

- `apps/web` — Next.js (App Router) web app
- `apps/worker` — standalone Node.js background worker
- `packages/shared-types` — shared TypeScript types
- `packages/api-client` — typed API client (filled in later)
- `supabase/migrations` — Postgres/RLS migrations
- `cloudflare-worker` — inbound-email Worker (Phase 4)

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` as you add integrations in later phases. Phase 0 needs none
of them yet.

## Run locally

Web app (http://localhost:3000):

```bash
npm run dev --workspace=@docunest/web
```

Background worker:

```bash
npm run dev --workspace=@docunest/worker
```

Or start every workspace that defines a `dev` script:

```bash
npm run dev
```

## Other scripts

```bash
npm run lint
npm run typecheck
npm run build
```

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
- Docker Desktop (or Docker Engine + Compose v2) — required for local
  virus scanning in Phase 3+

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` as you add integrations in later phases. Phase 0 needs none
of them yet.

## Run locally

### 1. Start ClamAV (Phase 3+)

The worker scans every uploaded document through a `clamd` daemon before
extraction or classification. For local development, run the official ClamAV
image as a sidecar:

```bash
docker compose up -d
```

**Wait until it is healthy before starting the worker.** On first boot,
`freshclam` downloads virus definitions into a named Docker volume — this
often takes one to two minutes (longer on a slow connection). While that
download is in progress the container is `starting`, not `healthy`.

Check status:

```bash
docker compose ps
```

You want `STATUS` to show `healthy`, not merely `Up` or `starting`:

```
NAME              STATUS
docunest-clamav   Up ... (healthy)
```

Follow startup progress if it is taking a while:

```bash
docker compose logs -f clamav
```

Look for `Clamd is up` from the healthcheck script, or log lines showing
`freshclam` finishing its initial database download. Do not restart the
container during `starting` — that cancels the download and starts over.

The worker connects to `127.0.0.1:3310` via `CLAMAV_HOST` /
`CLAMAV_PORT` (already set in `.env.example`). No worker code changes are
needed when this compose file is running.

To stop ClamAV (definitions stay in the `clamav_virus_db` volume for next
time):

```bash
docker compose down
```

### 2. Web app and worker

Web app (http://localhost:3000):

```bash
npm run dev --workspace=@docunest/web
```

Background worker — **start only after ClamAV reports healthy**:

```bash
npm run dev --workspace=@docunest/worker
```

Or start every workspace that defines a `dev` script (still start ClamAV
first):

```bash
npm run dev
```

## Other scripts

```bash
npm run lint
npm run typecheck
npm run build
```

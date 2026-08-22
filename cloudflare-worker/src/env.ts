export interface Env {
  /** Domain the Email Routing catch-all rule is bound to, e.g. "inbound.example.com". */
  INBOUND_EMAIL_DOMAIN: string;
  /** Base URL of the deployed apps/web app, e.g. "https://your-app.vercel.app". */
  BACKEND_BASE_URL: string;
  /** Set via `wrangler secret put INBOUND_WORKER_SHARED_SECRET` — see README.md. */
  INBOUND_WORKER_SHARED_SECRET: string;
}

-- ============================================================================
-- DocuNest — Phase 3: AI entity/suggestion columns, and locking `documents`
-- column-level writes down to what a user's own session should ever touch
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- WHAT THIS FILE DOES, IN PLAIN ENGLISH
-- ----------------------------------------------------------------------------
--
-- Part 1 adds two columns the background worker writes after AI
-- classification:
--   ai_entities            — vendor/amount/date the model pulled out, jsonb.
--   ai_suggested_category  — a free-text category name the model proposed
--                             that doesn't match any of the user's existing
--                             categories yet. Never auto-created; stored so a
--                             future UI phase can offer "create this
--                             category?" instead of silently growing the
--                             user's category list or dropping the signal.
--
-- Part 2 closes a gap that predates this migration: the Phase 1 grant
-- ("explicit_table_grants") gave `authenticated` blanket UPDATE on every
-- column of `documents`. Row Level Security already stopped a user from
-- touching another user's row, but nothing stopped a user from directly
-- PATCHing their *own* row's `status`, `ai_summary`, `ai_confidence`, or
-- `category_id` through the API and, for example, marking a still-processing
-- or quarantined document as `ready`, or writing a fake AI summary. Those
-- columns are system-owned facts — only the worker (via the service role
-- key) should ever set them. This migration narrows `authenticated`'s
-- UPDATE grant to just `category_id` (manual re-filing) and `deleted_at`
-- (soft delete), which are the only columns a user's own session has any
-- legitimate reason to write.
-- ----------------------------------------------------------------------------

alter table public.documents
  add column ai_entities jsonb,
  add column ai_suggested_category text;

comment on column public.documents.ai_entities is
  'Vendor/amount/date extracted by the AI classifier, or null. Written only by the worker (service role).';
comment on column public.documents.ai_suggested_category is
  'Free-text category name the AI proposed when none of the user''s existing categories fit well. Never auto-created into public.categories.';

-- Re-stated narrower than the Phase 1 grant: a user's session may re-file a
-- document into a different category or soft-delete it, but every AI/status
-- column below is written only by trusted server-side code running as
-- service_role (the worker), never by a user's own session.
revoke update on public.documents from authenticated;
grant update (category_id, deleted_at) on public.documents to authenticated;

-- ============================================================================
-- DocuNest — Phase 1: core schema, Row Level Security, signup provisioning
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- WHAT THE SECURITY RULES IN THIS FILE ALLOW AND DENY, IN PLAIN ENGLISH
-- ----------------------------------------------------------------------------
--
-- Every table created below has Row Level Security ("RLS") turned on. With RLS
-- on, Postgres refuses to return or change ANY row unless one of the policies
-- listed below explicitly allows it. There is no "allow everything" policy
-- anywhere in this file, so anything not described here is denied by default.
--
-- Every policy applies only to the `authenticated` role — a signed-in user.
-- Visitors who are not signed in (the `anon` role) get no policies at all and,
-- on top of that, have had every table permission revoked. They can read and
-- write nothing in these three tables, ever.
--
-- profiles — one row per user account
--   ALLOWS  a signed-in user to read, insert, update and delete only the row
--           whose `id` equals their own user id (`auth.uid()`).
--   DENIES  reading or changing anybody else's profile row, including merely
--           discovering that another account exists.
--   EXTRA LOCK: even on their own row, a signed-in user may only change
--           `display_name`. `subscription_tier`, `storage_limit_bytes`,
--           `stripe_customer_id` and `inbound_address_token` cannot be written
--           from a user's session at all — Postgres rejects the attempt at the
--           permission level, before RLS is even consulted. Those are billing
--           and identity facts, so only trusted server-side code (the Stripe
--           webhook handler and the worker, which use the service role key)
--           may set them. This is deliberately stricter than "a user can
--           update their own row": if a user could edit their own tier or
--           storage limit, they could grant themselves a paid plan.
--   ON DELETE: the delete policy does let a user delete their own profile row,
--           which cascades to all of their categories and documents. The app
--           never exposes that. Real account deletion will be a server-side
--           flow in a later phase that also removes the `auth.users` row and
--           the stored files.
--
-- categories — each user's own filing folders
--   ALLOWS  a signed-in user to read, create, rename, reorder and delete only
--           categories where `user_id` equals their own user id.
--   DENIES  seeing or touching another user's categories, and creating a
--           category that claims to belong to somebody else (the insert check
--           forces `user_id` to be the caller's own id).
--
-- documents — one row per stored document; the file itself lives in R2
--   ALLOWS  a signed-in user to read, create, update and delete only rows
--           where `user_id` equals their own user id.
--   DENIES  everything about every other user's documents, including the
--           file's storage key — so one user's session can never be used to
--           locate or fetch another user's file.
--
-- Two more things this file locks down that are not RLS but matter just as
-- much:
--   * The two functions that run at signup live in a private `internal`
--     schema that Supabase does not expose through its API, so no browser or
--     API client can call them directly.
--   * `inbound_address_token` — the secret part of a user's personal
--     forwarding email address — is generated from Postgres's cryptographic
--     random source. It is never derived from the user's id, email address or
--     signup time, so knowing somebody's email address tells an attacker
--     nothing about where to send mail into their vault.
-- ----------------------------------------------------------------------------

-- Private schema for privileged database code. Supabase only exposes `public`
-- (and `graphql_public`) through its API, so nothing in here is reachable from
-- a browser even if a permission is misconfigured later.
create schema if not exists internal;

revoke all on schema internal from public;

-- ----------------------------------------------------------------------------
-- Random token generation for inbound email addresses
-- ----------------------------------------------------------------------------

-- Returns a 22-character URL-safe token with ~122 bits of entropy, taken from
-- `gen_random_uuid()`, which Postgres seeds from the operating system's
-- cryptographic random source. Kept as its own function because Phase 5's
-- account settings screen lets a user regenerate their inbound address.
create or replace function internal.generate_inbound_address_token()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select rtrim(
    translate(
      encode(
        decode(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex'),
        'base64'
      ),
      '+/',
      '-_'
    ),
    '='
  );
$$;

revoke all on function internal.generate_inbound_address_token() from public;

-- ----------------------------------------------------------------------------
-- profiles
--
-- One row per user account, created automatically at signup. Holds everything
-- about a user that is not authentication itself: their display name, their
-- billing tier and storage allowance, and the secret token that forms their
-- personal inbound email address.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  stripe_customer_id text unique,
  subscription_tier text not null default 'free',
  storage_limit_bytes bigint not null default 209715200,
  inbound_address_token text not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_subscription_tier_check
    check (subscription_tier in ('free', 'pro', 'business'))
);

comment on table public.profiles is
  'One row per user account: display name, billing tier, storage allowance, and the secret token behind the user''s personal inbound email address. Created automatically by the signup trigger.';
comment on column public.profiles.inbound_address_token is
  'Secret, cryptographically random URL-safe token forming the local part of the user''s inbound forwarding address. Not writable from a user session.';
comment on column public.profiles.subscription_tier is
  'Resolved server-side from Stripe only. Never trust a client-supplied value.';
comment on column public.profiles.storage_limit_bytes is
  'Plan storage allowance, enforced server-side on every upload. Defaults to 200 MiB (the free tier).';

-- ----------------------------------------------------------------------------
-- categories
--
-- Each user's filing folders. Seeded with the twelve default categories at
-- signup, and editable by the user afterwards.
-- ----------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  slug text not null,
  icon text,
  is_system_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

comment on table public.categories is
  'Per-user filing folders shown as the dashboard category grid. Seeded with twelve defaults at signup, user-editable afterwards.';
comment on column public.categories.slug is
  'URL-safe identifier, unique per user. Used in dashboard routes.';

-- ----------------------------------------------------------------------------
-- documents
--
-- One row per stored document. The file's bytes live in Cloudflare R2 under
-- `storage_key`; this table holds only metadata, the AI summary, and the
-- processing state.
-- ----------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  source_type text not null,
  source_message_id text,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  storage_key text not null,
  checksum_sha256 text not null,
  ai_summary text,
  ai_confidence numeric(3, 2),
  status text not null default 'processing',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Filename is weighted above the AI summary so that searching for a
  -- remembered filename ranks that document first.
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(original_filename, '')), 'A')
    || setweight(to_tsvector('english', coalesce(ai_summary, '')), 'B')
  ) stored,
  constraint documents_source_type_check
    check (source_type in ('manual_upload', 'forwarded_email')),
  constraint documents_status_check
    check (status in ('processing', 'ready', 'needs_review', 'failed', 'quarantined')),
  -- NULLS NOT DISTINCT so this constraint also de-duplicates manual uploads,
  -- which have no source_message_id. Under Postgres's default NULLS DISTINCT
  -- two NULL message ids never collide, which would let a retried upload job
  -- insert the same file twice.
  constraint documents_source_dedupe_key
    unique nulls not distinct (user_id, source_message_id, storage_key)
);

comment on table public.documents is
  'One row per stored document. File bytes live in Cloudflare R2 under storage_key; this table holds metadata, the AI summary and processing state. Deletes are soft (deleted_at).';
comment on column public.documents.status is
  'processing = queued or being worked on; ready = classified and viewable; needs_review = low AI confidence, filed under Needs Review; failed = processing gave up; quarantined = rejected as unsafe input.';
comment on column public.documents.search_vector is
  'Generated full-text index over original_filename (weight A) and ai_summary (weight B).';
comment on column public.documents.file_size_bytes is
  'Recorded server-side from the bytes actually written to R2, never from a client-declared size, because storage quota is enforced against the sum of this column.';

create index documents_user_category_created_at_idx
  on public.documents (user_id, category_id, created_at desc);

create index documents_user_status_active_idx
  on public.documents (user_id, status)
  where deleted_at is null;

create index documents_search_vector_idx
  on public.documents using gin (search_vector);

-- Supports the `on delete set null` back-reference from categories, which
-- otherwise has to scan the whole table when a category is deleted.
create index documents_category_id_idx
  on public.documents (category_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- `(select auth.uid())` rather than a bare `auth.uid()` so Postgres evaluates
-- the current user id once per statement instead of once per row.
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.documents enable row level security;

-- profiles
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Users can delete their own profile"
  on public.profiles for delete to authenticated
  using (id = (select auth.uid()));

-- categories
create policy "Users can read their own categories"
  on public.categories for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can create their own categories"
  on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can update their own categories"
  on public.categories for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can delete their own categories"
  on public.categories for delete to authenticated
  using (user_id = (select auth.uid()));

-- documents
create policy "Users can read their own documents"
  on public.documents for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can create their own documents"
  on public.documents for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can update their own documents"
  on public.documents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can delete their own documents"
  on public.documents for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Table permissions, layered underneath RLS
-- ----------------------------------------------------------------------------

-- Signed-out visitors have no business touching user data at all. RLS already
-- denies them because no policy names the `anon` role; revoking the grants as
-- well means a future stray policy cannot accidentally open them up.
revoke all on public.profiles from anon;
revoke all on public.categories from anon;
revoke all on public.documents from anon;

-- A user's session may only ever write `display_name` on their own profile.
-- Billing and identity columns fall back to their defaults on insert and are
-- writable only by the service role. See the plain-English notes at the top.
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- Signup provisioning
--
-- Runs inside the same transaction as the `auth.users` insert, so a new user
-- either gets a profile plus all twelve categories, or is not created at all.
-- ----------------------------------------------------------------------------
create or replace function internal.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  address_token text;
begin
  -- Retry on the (astronomically unlikely) chance of a token collision, so a
  -- unique-constraint violation can never block somebody's signup.
  for _attempt in 1..5 loop
    address_token := internal.generate_inbound_address_token();
    exit when not exists (
      select 1 from public.profiles p where p.inbound_address_token = address_token
    );
  end loop;

  insert into public.profiles (id, display_name, inbound_address_token)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    address_token
  )
  on conflict (id) do nothing;

  -- The default taxonomy, in display order. "Needs Review" is where
  -- low-confidence AI results land instead of being silently misfiled.
  --
  -- FUTURE PHASES: "Needs Review" (slug 'needs-review') must not be
  -- deletable or renameable by the user. That rule is enforced in the app
  -- layer, not here, so any code path that deletes or updates a category has
  -- to check for this slug first.
  insert into public.categories (user_id, name, slug, icon, is_system_default, sort_order)
  values
    (new.id, 'Receipts & Purchases',          'receipts-purchases',          'receipt',        true,  1),
    (new.id, 'Travel & Tickets',              'travel-tickets',              'plane',          true,  2),
    (new.id, 'Bills & Utilities',             'bills-utilities',             'zap',            true,  3),
    (new.id, 'Subscriptions & Memberships',   'subscriptions-memberships',   'repeat',         true,  4),
    (new.id, 'Work & Business',               'work-business',               'briefcase',      true,  5),
    (new.id, 'School & Education',            'school-education',            'graduation-cap', true,  6),
    (new.id, 'Insurance',                     'insurance',                   'umbrella',       true,  7),
    (new.id, 'Taxes & Finance',               'taxes-finance',               'landmark',       true,  8),
    (new.id, 'Medical & Health',              'medical-health',              'heart-pulse',    true,  9),
    (new.id, 'Legal & Contracts',             'legal-contracts',             'scale',          true, 10),
    (new.id, 'Identification & Personal Docs', 'identification-personal-docs', 'id-card',      true, 11),
    (new.id, 'Needs Review',                  'needs-review',                'inbox',          true, 12)
  on conflict (user_id, slug) do nothing;

  return new;
end;
$$;

revoke all on function internal.handle_new_user() from public;

-- Supabase Auth inserts the `auth.users` row as `supabase_auth_admin`, so that
-- role needs to be able to reach and run the trigger function. It runs as the
-- function's owner regardless, because the function is SECURITY DEFINER.
grant usage on schema internal to supabase_auth_admin;
grant execute on function internal.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function internal.handle_new_user();

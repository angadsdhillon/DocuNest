-- ============================================================================
-- DocuNest — Phase 1 follow-up: explicit table privileges for the API roles
-- ============================================================================
--
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- ----------------------------------------------------------------------------
--
-- Most Supabase projects automatically hand every new table in `public` full
-- read/write permission for the `anon`, `authenticated` and `service_role` API
-- roles, which leaves Row Level Security as the only thing deciding who sees
-- what. This project is configured more strictly: its default privileges give
-- those roles no SELECT, INSERT, UPDATE or DELETE at all.
--
-- That was confirmed, not assumed. Immediately after the previous migration
-- was applied, a query run as a signed-in user failed with "permission denied
-- for table profiles" before any policy was even consulted. Left alone, the
-- app would have been unable to read anything.
--
-- Permissions are therefore stated explicitly here instead of inherited. Two
-- independent layers now have to agree before a row can be touched: the role
-- must hold the privilege (this file), and a policy must allow that specific
-- row (the previous file).
--
-- ----------------------------------------------------------------------------
-- WHAT EACH ROLE ENDS UP WITH, IN PLAIN ENGLISH
-- ----------------------------------------------------------------------------
--
--   anon — a visitor who is not signed in
--     Nothing whatsoever, on any of the three tables.
--
--   authenticated — a signed-in user
--     Read and write their own categories and documents. Read and delete their
--     own profile row. Of the profile's columns they may write only
--     `display_name`; their billing tier, storage limit, Stripe customer id
--     and inbound address token stay out of reach. Row Level Security still
--     restricts every one of those to their own rows.
--
--   service_role — the background worker and the Stripe webhook handler
--     Full read/write on all three tables. This key lives only on the server
--     and never reaches a browser.
--
--   Nobody except the table owner may TRUNCATE. This matters more than it
--   looks: TRUNCATE ignores Row Level Security completely, so a signed-in user
--   holding it could have emptied every user's documents in a single
--   statement. It was granted by default, and it is taken away here.
-- ----------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated, service_role;
revoke all on public.categories from anon, authenticated, service_role;
revoke all on public.documents from anon, authenticated, service_role;

grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.documents to authenticated;

grant select, delete on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.categories to service_role;
grant select, insert, update, delete on public.documents to service_role;

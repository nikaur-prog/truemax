-- Staff accounts: unlimited depth, no subscription, no Stripe.
--
-- Needed for the owner and for testers, who have to be able to scan
-- repeatedly to check the product without paying themselves for it or
-- burning a trial every time.
--
-- Why a table rather than a list of emails in the code: this repository is
-- PUBLIC. An email in the bundle would publish a personal address to anybody
-- who opened the source, and it would be a client-side check anyone could flip
-- in devtools anyway. A row here keeps the identity in the database, out of
-- the repo, and readable only by its owner.
--
-- What this is NOT: a way to see anyone else's data. There is no such
-- capability anywhere in the product — scans are on-device and analytics has
-- no identity columns by construction. "Admin" here means exactly one thing,
-- unlimited scan depth for yourself, and the schema is deliberately shaped so
-- it cannot quietly grow into more.
--
-- Kept separate from `entitlements` on purpose: that table is the Stripe read
-- model, and the webhook rewrites rows in it. A staff grant living there would
-- be silently erased the first time that account touched Stripe, and it would
-- also count as a paying customer in every revenue query.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- Owners may check their own flag; that is the whole client-facing surface.
-- Nobody can list the table, so staff accounts are not enumerable.
drop policy if exists "read own admin flag" on public.app_admins;
create policy "read own admin flag"
  on public.app_admins for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.app_admins from anon;
revoke insert, update, delete on public.app_admins from authenticated;
grant select on public.app_admins to authenticated;

-- Grants are made by hand in the SQL editor (service role), deliberately:
-- there is no API route, no admin panel and no self-serve path, so the only
-- way to become staff is direct database access.
--
--   insert into public.app_admins (user_id, note)
--   select id, 'owner' from auth.users where email = 'you@example.com'
--   on conflict (user_id) do nothing;
--
-- and to revoke:
--
--   delete from public.app_admins
--   where user_id in (select id from auth.users where email = 'you@example.com');

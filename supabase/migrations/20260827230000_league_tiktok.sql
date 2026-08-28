-- TikTok account links for League creators — Phase 2 of post tracking.
--
-- A creator connects their own TikTok through Login Kit on /league; the
-- tokens land here and the server uses them to read that creator's OWN
-- videos through the Display API (video.list), replacing manual count
-- entry. Nothing about anyone else's account is ever readable: the scopes
-- are user.info.basic + video.list, both scoped by TikTok to the account
-- that authorised them.
--
-- TOKENS ARE SERVER-ONLY. The row is readable by its owner (and staff) so
-- the dashboard can show "linked as @handle" — but through COLUMN grants
-- that exclude the token columns, so even the owner's own browser can never
-- read an access token out of this table. Writes come only from the service
-- role during the OAuth exchange.

create table public.league_tiktok_accounts (
  user_id uuid primary key references public.league_creators (user_id) on delete cascade,
  open_id text not null,
  display_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.league_tiktok_accounts enable row level security;

create policy tiktok_self_select on public.league_tiktok_accounts
  for select using (auth.uid() = user_id or public.league_is_staff());

revoke all on table public.league_tiktok_accounts from anon;
revoke all on table public.league_tiktok_accounts from authenticated;
-- The display columns only. The token columns have no grant, so a select on
-- them fails regardless of what any future policy allows.
grant select (user_id, open_id, display_name, created_at)
  on public.league_tiktok_accounts to authenticated;

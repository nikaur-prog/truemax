-- TikTok links belong to authenticated TrueMax accounts, not only rows in the
-- creator application table. Approved creators have both, but staff are
-- deliberately admitted to /league without applying to their own programme.
-- The API already authorizes exactly those two audiences before every TikTok
-- action; the narrower foreign key made a valid staff OAuth exchange fail only
-- when its tokens were saved.

alter table public.league_tiktok_accounts
  drop constraint if exists league_tiktok_accounts_user_id_fkey;

alter table public.league_tiktok_accounts
  add constraint league_tiktok_accounts_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade
  not valid;

alter table public.league_tiktok_accounts
  validate constraint league_tiktok_accounts_user_id_fkey;

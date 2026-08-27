-- Render metering for Creator League pillar tools.
--
-- League membership now opens /quick, and /quick reaches endpoints that cost
-- real money per call (voiceover synthesis today; anything billable that the
-- pillars grow later). league_creators.monthly_render_quota is the budget the
-- owner set at approval; this table is the ledger it is enforced against.
--
-- One row per billable render, written by the SERVER (service role) after the
-- render actually succeeded — never by the client, because a meter the caller
-- writes is not a meter. The month window is computed by the endpoint at
-- check time (count of own rows since the first of the current UTC month),
-- so there is no state to reset and nothing to get stuck.

create table public.league_render_log (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.league_creators (user_id) on delete cascade,
  -- What was rendered ("tts" today). A plain text tag rather than an enum so
  -- adding a pillar endpoint never needs a migration.
  kind text not null,
  created_at timestamptz not null default now()
);

create index league_render_log_creator_month
  on public.league_render_log (creator_id, created_at);

alter table public.league_render_log enable row level security;

-- Reads: a creator sees their own usage (the Tools page draws the quota bar
-- from it); staff see everyone's. No insert/update/delete policies at all —
-- writes come only from the service role, which bypasses RLS. Staff renders
-- are deliberately not logged: the quota exists to bound spending the owner
-- did not budget, and the owner spending their own money is not that.
create policy render_log_read on public.league_render_log
  for select using (auth.uid() = creator_id or public.league_is_staff());

revoke all on table public.league_render_log from anon;
revoke insert, update, delete on table public.league_render_log from authenticated;

-- Voiced analysis exports for Max-plan members — the growth loop.
--
-- A Max member can export their own scan as the narrated analysis video and
-- post it; every export costs a real ElevenLabs call, so it is metered the
-- same way League renders are: one row per delivered voiceover, written by
-- the SERVER after the audio actually came back, counted against a monthly
-- allowance at check time. No state to reset, nothing to get stuck.
--
-- Separate from league_render_log on purpose: that ledger references
-- league_creators and answers "what did this creator spend of the owner's
-- budget"; this one references auth.users and answers "what did this member
-- use of their plan". Same shape, different question, different foreign key.

create table public.voice_export_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index voice_export_log_user_month
  on public.voice_export_log (user_id, created_at);

alter table public.voice_export_log enable row level security;

-- Owners read their own usage (so the button can say how many are left);
-- writes come only from the service role, which bypasses RLS — a meter the
-- caller writes is not a meter.
create policy voice_export_read on public.voice_export_log
  for select using (auth.uid() = user_id);

revoke all on table public.voice_export_log from anon;
revoke insert, update, delete on table public.voice_export_log from authenticated;

-- Repair and future-proof the Creator League API surface.
--
-- Production received the later integrity migration before every earlier
-- League migration was reflected in the exposed schema. Keep this repair
-- idempotent so it is safe whether league_formula already ran or not.

alter table public.league_sprints
  add column if not exists formula jsonb;

-- Staff must be able to enter a platform's FINAL manual counts after ends_at
-- and before closing the sprint. The prior time-window check made that safe
-- two-step impossible. Closed sprints remain immutable.
drop policy if exists snapshots_staff_write on public.league_stat_snapshots;
create policy snapshots_staff_write on public.league_stat_snapshots
  for insert to authenticated
  with check (
    public.league_is_staff()
    and exists (
      select 1
      from public.league_submissions submission
      join public.league_sprints sprint on sprint.id = submission.sprint_id
      where submission.id = league_stat_snapshots.submission_id
        and sprint.status = 'active'
    )
  );

-- New Supabase projects no longer expose public-schema tables implicitly.
-- State every browser grant explicitly, while RLS remains the row boundary.
revoke all on table public.league_creators from public, anon, authenticated;
revoke all on table public.league_sprints from public, anon, authenticated;
revoke all on table public.league_submissions from public, anon, authenticated;
revoke all on table public.league_stat_snapshots from public, anon, authenticated;
revoke all on table public.league_payouts from public, anon, authenticated;
revoke all on table public.league_render_log from public, anon, authenticated;
revoke all on table public.league_tiktok_accounts from public, anon, authenticated;

grant select, insert, update on table public.league_creators to authenticated;
grant select, insert, update on table public.league_sprints to authenticated;
grant select, insert, update on table public.league_submissions to authenticated;
grant select, insert on table public.league_stat_snapshots to authenticated;
grant select on table public.league_payouts to authenticated;
grant select on table public.league_render_log to authenticated;
grant select (user_id, open_id, display_name, created_at)
  on table public.league_tiktok_accounts to authenticated;
grant usage, select on sequence public.league_stat_snapshots_id_seq to authenticated;

-- The policy helpers were originally SECURITY DEFINER with public on the
-- search path. Pin every referenced schema, then expose execution only to the
-- authenticated role that needs the policies and leaderboard.
create or replace function public.league_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.league_is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_creators
    where user_id = (select auth.uid()) and status = 'approved'
  );
$$;

create or replace function public.league_leaderboard()
returns table (user_id uuid, display_name text, handle text, earned_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id, c.display_name, c.handle,
         coalesce(sum(p.amount_cents), 0)::bigint as earned_cents
  from public.league_creators c
  left join public.league_payouts p
    on p.creator_id = c.user_id and p.status = 'paid'
  where c.status = 'approved'
    and (public.league_is_approved() or public.league_is_staff())
  group by c.user_id, c.display_name, c.handle
  order by earned_cents desc;
$$;

revoke all on function public.league_is_staff() from public, anon, authenticated;
revoke all on function public.league_is_approved() from public, anon, authenticated;
revoke all on function public.league_leaderboard() from public, anon, authenticated;
grant execute on function public.league_is_staff() to authenticated;
grant execute on function public.league_is_approved() to authenticated;
grant execute on function public.league_leaderboard() to authenticated;

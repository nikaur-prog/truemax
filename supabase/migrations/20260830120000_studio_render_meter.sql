-- ---------------------------------------------------------------------------
-- The Studio meter: AI image pairs, reserved the same way narration is.
--
-- WHY THIS IS A MIGRATION AND NOT A COUPLE OF LINES IN THE ROUTE.
--
-- The obvious shape was leagueRenderBudget() to check the quota, then the two
-- OpenAI calls, then recordLeagueRender() to log it. That is a check-then-spend
-- with two slow network calls in the middle: two pairs requested at once both
-- read the same remaining count, both pass, and both spend the last slot. The
-- narration route does not work that way, and the comment above its claim says
-- exactly why — "the SQL claim serializes requests for this account, so two
-- simultaneous renders cannot both pass the last credit or the last League
-- slot". An image pair costs more per call than a narration does, so it gets
-- the same treatment rather than a weaker one.
--
-- So `studio` becomes a third meter on the existing reserve / finalize / refund
-- path. Nothing new is invented: the advisory lock, the stale-claim sweep and
-- the reservation row all already exist and are already tested in production.
--
-- ON THE NAMES. These functions and `tts_render_reservations` will now hold
-- image reservations, which reads oddly. Renaming them is a migration touching
-- every caller for no behavioural gain, so the names stay and this comment is
-- the explanation. The table is a RENDER reservation ledger; tts was merely
-- the first thing to render.
--
-- ONE SHARED MONTHLY QUOTA, deliberately. A creator has a number of renders a
-- month and can spend them on voice or on faces. If that turns out to be the
-- wrong economics, league_render_log already carries `kind`, so the two can be
-- split later by reading history rather than by guessing now.
-- ---------------------------------------------------------------------------

-- THE COLUMN HAS TO ADMIT THE VALUE BEFORE THE FUNCTION CAN INSERT IT.
--
-- The table was created with `check (meter in ('league', 'voice'))`, so
-- teaching claim_tts_render about a third meter without widening this raises
-- 23514 on the insert at the very bottom of the function: the whole feature
-- fails on its first real call, with a green test suite behind it.
--
-- It got that far because the tests asserted the TEXT of this migration and
-- never executed it, and never looked at the table it inserts into. There is
-- now a test that loads both files into a real Postgres and performs a claim
-- (api/_studio-meter.db.test.ts), which reproduces the failure above in a
-- second and would not have let this through.
--
-- Dropped by name and re-added rather than altered, because a check constraint
-- cannot be modified in place. The name is Postgres's own default for this
-- column, confirmed against the created table.
alter table public.tts_render_reservations
  drop constraint if exists tts_render_reservations_meter_check;
alter table public.tts_render_reservations
  add constraint tts_render_reservations_meter_check
  check (meter in ('league', 'voice', 'studio'));

create or replace function public.claim_tts_render(p_user_id uuid, p_meter text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation uuid;
  quota_limit integer;
  used integer;
  stale_voice integer;
  required_grant text;
begin
  if p_user_id is null or p_meter not in ('league', 'voice', 'studio') then
    raise exception 'Invalid render claim' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- A function crash must not strand a paid credit forever. Claims older than
  -- the route's maximum useful lifetime are refunded on the next attempt.
  -- Meter-agnostic: a stranded studio claim would otherwise hold a quota slot
  -- for the rest of the month.
  with stale as (
    update public.tts_render_reservations
      set status = 'refunded', finished_at = now()
      where user_id = p_user_id
        and status = 'reserved'
        and created_at < now() - interval '15 minutes'
      returning meter
  ) select count(*) filter (where meter = 'voice') into stale_voice from stale;

  if stale_voice > 0 then
    insert into public.voice_credits as credits (user_id, balance, updated_at)
    values (p_user_id, stale_voice, now())
    on conflict (user_id) do update
      set balance = credits.balance + excluded.balance,
          updated_at = now();
  end if;

  if p_meter = 'voice' then
    update public.voice_credits
      set balance = balance - 1, updated_at = now()
      where user_id = p_user_id and balance > 0
      returning user_id into reservation;
    if reservation is null then return null; end if;
  else
    -- The grant that opens the meter. Both are League doors on the same quota;
    -- they differ only in which pillar the owner ticked.
    required_grant := case when p_meter = 'studio' then 'studio' else 'cta' end;

    select monthly_render_quota into quota_limit
    from public.league_creators
    where user_id = p_user_id
      and status = 'approved'
      and coalesce((pillar_grants ->> required_grant)::boolean, false);
    if quota_limit is null then return null; end if;

    -- BOTH metered kinds count against the one pool, spent and reserved alike.
    -- Counting only this meter's own reservations would hand a creator a full
    -- quota of each, which is not what a shared quota means.
    select
      (select count(*) from public.league_render_log
       where creator_id = p_user_id
         and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc')
      +
      (select count(*) from public.tts_render_reservations
       where user_id = p_user_id and meter in ('league', 'studio') and status = 'reserved'
         and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc')
    into used;
    if used >= greatest(0, quota_limit) then return null; end if;
  end if;

  insert into public.tts_render_reservations (user_id, meter)
  values (p_user_id, p_meter)
  returning id into reservation;
  return reservation;
end;
$$;

create or replace function public.finalize_tts_render(p_reservation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_meter text;
begin
  update public.tts_render_reservations
    set status = 'consumed', finished_at = now()
    where id = p_reservation_id and user_id = p_user_id and status = 'reserved'
    returning meter into claimed_meter;

  if claimed_meter is null then
    return exists (
      select 1 from public.tts_render_reservations
      where id = p_reservation_id and user_id = p_user_id and status = 'consumed'
    );
  end if;

  -- The ledger the Tools page reads. `kind` is what lets the two meters be
  -- told apart later without a schema change.
  if claimed_meter in ('league', 'studio') then
    insert into public.league_render_log (creator_id, kind, reservation_id)
    values (p_user_id, case when claimed_meter = 'studio' then 'ai-pair' else 'tts' end, p_reservation_id)
    on conflict (reservation_id) do nothing;
  end if;
  return true;
end;
$$;

-- Unchanged in behaviour and restated so the grants below are unambiguous
-- after the signature-compatible replacements above.
revoke all on function public.claim_tts_render(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_tts_render(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_tts_render(uuid, text) to service_role;
grant execute on function public.finalize_tts_render(uuid, uuid) to service_role;

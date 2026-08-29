-- Idempotent one-time purchases and completed-scan credit use.
--
-- Stripe retries webhook events, sometimes concurrently. A purchase event is
-- therefore the primary key of the grant, and the ledger insert plus balance
-- increment happen in one transaction inside this function.

create table if not exists public.billing_credit_events (
  event_id text primary key,
  checkout_session_id text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  credit_kind text not null check (credit_kind in ('scan', 'voice')),
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now()
);

alter table public.billing_credit_events enable row level security;
revoke all on table public.billing_credit_events from public, anon, authenticated;

create or replace function public.apply_one_time_credit(
  p_event_id text,
  p_checkout_session_id text,
  p_user_id uuid,
  p_credit_kind text,
  p_credits integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  if p_event_id is null or btrim(p_event_id) = ''
     or p_checkout_session_id is null or btrim(p_checkout_session_id) = ''
     or p_user_id is null
     or p_credit_kind not in ('scan', 'voice')
     or p_credits < 1 then
    raise exception 'Invalid credit event' using errcode = '22023';
  end if;

  insert into public.billing_credit_events (
    event_id, checkout_session_id, user_id, credit_kind, credits
  ) values (
    p_event_id, p_checkout_session_id, p_user_id, p_credit_kind, p_credits
  )
  on conflict do nothing;
  get diagnostics inserted = row_count;

  if inserted = 0 then
    return false;
  end if;

  if p_credit_kind = 'scan' then
    insert into public.scan_credits as balance (user_id, balance, updated_at)
    values (p_user_id, p_credits, now())
    on conflict (user_id) do update
      set balance = balance.balance + excluded.balance,
          updated_at = now();
  else
    insert into public.voice_credits as balance (user_id, balance, updated_at)
    values (p_user_id, p_credits, now())
    on conflict (user_id) do update
      set balance = balance.balance + excluded.balance,
          updated_at = now();
  end if;

  return true;
end;
$$;

revoke all on function public.apply_one_time_credit(text, text, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.apply_one_time_credit(text, text, uuid, text, integer)
  to service_role;

-- A completed scan is its own spend idempotency key. The balance decrement and
-- use row are atomic, so a correction/re-render cannot charge twice and two
-- concurrent scans cannot both spend the final credit.
create table if not exists public.scan_credit_uses (
  user_id uuid not null references auth.users (id) on delete cascade,
  scan_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, scan_id)
);

alter table public.scan_credit_uses enable row level security;
revoke all on table public.scan_credit_uses from public, anon, authenticated;

create or replace function public.consume_scan_credit_for_scan(p_scan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  remaining integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_scan_id is null then
    raise exception 'Scan ID is required' using errcode = '22023';
  end if;

  -- Identical completion requests must serialize before the existence check.
  -- Without this lock, two requests against an account holding two credits can
  -- both decrement before one loses the unique scan-use insert and rolls back,
  -- turning an idempotent retry into a transient database error.
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || p_scan_id::text, 0));

  if exists (
    select 1 from public.scan_credit_uses
    where user_id = caller_id and scan_id = p_scan_id
  ) then
    select balance into remaining
    from public.scan_credits
    where user_id = caller_id;
    return jsonb_build_object('consumed', true, 'remaining', coalesce(remaining, 0));
  end if;

  update public.scan_credits
    set balance = balance - 1,
        updated_at = now()
    where user_id = caller_id and balance > 0
    returning balance into remaining;

  if remaining is null then
    return jsonb_build_object('consumed', false, 'remaining', -1);
  end if;

  insert into public.scan_credit_uses (user_id, scan_id)
  values (caller_id, p_scan_id);

  return jsonb_build_object('consumed', true, 'remaining', remaining);
end;
$$;

revoke all on function public.consume_scan_credit_for_scan(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_scan_credit_for_scan(uuid)
  to authenticated;

-- The legacy no-idempotency spend is no longer callable by a browser.
revoke all on function public.consume_scan_credit() from public, anon, authenticated, service_role;

-- Billable narration is reserved before contacting a provider. A failed or
-- corrupt render refunds the same reservation; a successful render finalizes
-- it exactly once. This closes both check-then-spend races (voice credits and
-- monthly League quota).
alter table public.league_render_log
  add column if not exists reservation_id uuid unique;

create table if not exists public.tts_render_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meter text not null check (meter in ('league', 'voice')),
  kind text not null default 'tts',
  status text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'refunded')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists tts_render_reservations_user_month
  on public.tts_render_reservations (user_id, created_at);
alter table public.tts_render_reservations enable row level security;
revoke all on table public.tts_render_reservations from public, anon, authenticated;

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
begin
  if p_user_id is null or p_meter not in ('league', 'voice') then
    raise exception 'Invalid narration claim' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- A function crash must not strand a paid credit forever. Claims older than
  -- the route's maximum useful lifetime are refunded on the next attempt.
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
    select monthly_render_quota into quota_limit
    from public.league_creators
    where user_id = p_user_id
      and status = 'approved'
      and coalesce((pillar_grants ->> 'cta')::boolean, false);
    if quota_limit is null then return null; end if;

    select
      (select count(*) from public.league_render_log
       where creator_id = p_user_id
         and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc')
      +
      (select count(*) from public.tts_render_reservations
       where user_id = p_user_id and meter = 'league' and status = 'reserved'
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

  if claimed_meter = 'league' then
    insert into public.league_render_log (creator_id, kind, reservation_id)
    values (p_user_id, 'tts', p_reservation_id)
    on conflict (reservation_id) do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.refund_tts_render(p_reservation_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_meter text;
begin
  update public.tts_render_reservations
    set status = 'refunded', finished_at = now()
    where id = p_reservation_id and user_id = p_user_id and status = 'reserved'
    returning meter into claimed_meter;
  if claimed_meter is null then return false; end if;

  if claimed_meter = 'voice' then
    insert into public.voice_credits as credits (user_id, balance, updated_at)
    values (p_user_id, 1, now())
    on conflict (user_id) do update
      set balance = credits.balance + 1,
          updated_at = now();
  end if;
  return true;
end;
$$;

revoke all on function public.claim_tts_render(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_tts_render(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refund_tts_render(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_tts_render(uuid, text) to service_role;
grant execute on function public.finalize_tts_render(uuid, uuid) to service_role;
grant execute on function public.refund_tts_render(uuid, uuid) to service_role;

-- Max claims are made by the server admin client, and provider failures may
-- return that claim. The original migration revoked the function from every
-- browser role but forgot to grant the service role that actually calls it.
grant execute on function public.claim_max_chat_turn(uuid, integer) to service_role;

create or replace function public.release_max_chat_turn(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released uuid;
begin
  update public.max_chat_usage
    set messages = messages - 1, updated_at = now()
    where user_id = p_user_id
      and day = (now() at time zone 'utc')::date
      and messages > 0
    returning user_id into released;
  return released is not null;
end;
$$;
revoke all on function public.release_max_chat_turn(uuid) from public, anon, authenticated;
grant execute on function public.release_max_chat_turn(uuid) to service_role;

-- Self-score uniqueness and the rolling cap are decided under one per-user
-- advisory lock. The API no longer performs a racy count followed by insert.
create or replace function public.submit_self_score_feedback(
  p_user_id uuid,
  p_scan_id uuid,
  p_our_score numeric,
  p_self_score numeric,
  p_sex text,
  p_consent_version text,
  p_app_commit text,
  p_limit integer default 10
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));
  if exists (
    select 1 from public.self_score_feedback
    where user_id = p_user_id and scan_id = p_scan_id
  ) then return 'duplicate'; end if;

  select count(*) into recent
  from public.self_score_feedback
  where user_id = p_user_id and created_at >= now() - interval '24 hours';
  if recent >= greatest(1, p_limit) then return 'rate_limited'; end if;

  insert into public.self_score_feedback (
    user_id, scan_id, our_score, self_score, sex, consent_version, app_commit
  ) values (
    p_user_id, p_scan_id, p_our_score, p_self_score, p_sex, p_consent_version, p_app_commit
  );
  return 'inserted';
end;
$$;
revoke all on function public.submit_self_score_feedback(uuid, uuid, numeric, numeric, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.submit_self_score_feedback(uuid, uuid, numeric, numeric, text, text, text, integer)
  to service_role;

-- Side-photo uploads reserve a place in the rolling cap before object storage
-- is written. Reserved slots are counted; failed uploads release them; stale
-- reservations are reclaimed automatically.
create table if not exists public.side_feedback_upload_claims (
  submission_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved', 'consumed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.side_feedback_upload_claims enable row level security;
revoke all on table public.side_feedback_upload_claims from public, anon, authenticated;

create or replace function public.claim_side_feedback_upload(
  p_user_id uuid, p_submission_id uuid, p_limit integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 2));
  delete from public.side_feedback_upload_claims
    where user_id = p_user_id and status = 'reserved'
      and created_at < now() - interval '15 minutes';

  if exists (select 1 from public.side_feedback_upload_claims where submission_id = p_submission_id) then
    return 'in_progress';
  end if;

  select
    (select count(*) from public.side_landmark_feedback
      where user_id = p_user_id and created_at >= now() - interval '24 hours')
    +
    (select count(*) from public.side_feedback_upload_claims
      where user_id = p_user_id and status = 'reserved'
        and created_at >= now() - interval '24 hours')
  into recent;
  if recent >= greatest(1, p_limit) then return 'rate_limited'; end if;

  insert into public.side_feedback_upload_claims (submission_id, user_id)
  values (p_submission_id, p_user_id);
  return 'claimed';
end;
$$;

create or replace function public.finalize_side_feedback_upload(p_user_id uuid, p_submission_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.side_feedback_upload_claims
    set status = 'consumed', finished_at = now()
    where user_id = p_user_id and submission_id = p_submission_id and status = 'reserved'
  returning true;
$$;

create or replace function public.release_side_feedback_upload(p_user_id uuid, p_submission_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  delete from public.side_feedback_upload_claims
    where user_id = p_user_id and submission_id = p_submission_id and status = 'reserved'
  returning true;
$$;

revoke all on function public.claim_side_feedback_upload(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_side_feedback_upload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_side_feedback_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_side_feedback_upload(uuid, uuid, integer) to service_role;
grant execute on function public.finalize_side_feedback_upload(uuid, uuid) to service_role;
grant execute on function public.release_side_feedback_upload(uuid, uuid) to service_role;

-- TikTok identity must be real and must not be attached to two TrueMax
-- creators. Blank rows came only from failed user-info calls and are not valid
-- links, so remove them before enforcing the invariant.
delete from public.league_tiktok_accounts where btrim(open_id) = '';
-- Older OAuth retries could attach the same TikTok identity to more than one
-- TrueMax account. Keep the newest successful link and disconnect the stale
-- rows so the invariant can be installed without stranding the migration.
delete from public.league_tiktok_accounts as stale
using public.league_tiktok_accounts as current
where stale.open_id = current.open_id
  and (
    stale.created_at < current.created_at
    or (stale.created_at = current.created_at and stale.user_id::text < current.user_id::text)
  );
-- Guarded rather than a bare `add constraint`, which is the one statement in
-- this file that cannot be run twice. A hand-applied migration gets retried
-- after an unrelated failure, and a second run should be a no-op, not an
-- error that hides the real one.
do $$
begin
  alter table public.league_tiktok_accounts
    add constraint league_tiktok_accounts_open_id_not_blank check (btrim(open_id) <> '');
exception
  when duplicate_object then null;
end;
$$;
create unique index if not exists league_tiktok_accounts_open_id_unique
  on public.league_tiktok_accounts (open_id);

-- A creator may only submit to a sprint that is active NOW. The original RLS
-- policy checked membership and the literal 'pending' status but never joined
-- the sprint, so a crafted client could submit against drafts or closed pools.
drop policy if exists submissions_self_insert on public.league_submissions;
create policy submissions_self_insert on public.league_submissions
  for insert to authenticated
  with check (
    (select auth.uid()) = creator_id
    and status = 'pending'
    and public.league_is_approved()
    and exists (
      select 1 from public.league_sprints sprint
      where sprint.id = sprint_id
        and sprint.status = 'active'
        and now() between sprint.starts_at and sprint.ends_at
    )
  );

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
        and now() between sprint.starts_at and sprint.ends_at
    )
  );

-- One creator, one settlement row per sprint. Recording the payout and closing
-- that creator's eligible submissions happen in one transaction, so a network
-- retry cannot duplicate money or leave the dashboard half-settled.
alter table public.league_payouts
  add column if not exists sprint_id uuid references public.league_sprints (id);
create unique index if not exists league_payouts_sprint_creator_unique
  on public.league_payouts (sprint_id, creator_id)
  where sprint_id is not null;

create or replace function public.record_league_payout(
  p_sprint_id uuid,
  p_creator_id uuid,
  p_amount_cents integer,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  if not public.league_is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_amount_cents <= 0 then
    raise exception 'Payout must be positive' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.league_sprints
    where id = p_sprint_id and status = 'closed'
  ) then
    raise exception 'Sprint must be closed before settlement' using errcode = '22023';
  end if;

  insert into public.league_payouts (
    creator_id, sprint_id, amount_cents, note, status
  ) values (
    p_creator_id, p_sprint_id, p_amount_cents, p_note, 'paid'
  ) on conflict (sprint_id, creator_id) where sprint_id is not null do nothing;
  get diagnostics inserted = row_count;

  update public.league_submissions
    set status = 'paid_out'
    where creator_id = p_creator_id
      and sprint_id = p_sprint_id
      and status in ('approved', 'earning');

  return inserted = 1;
end;
$$;
revoke all on function public.record_league_payout(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_league_payout(uuid, uuid, integer, text)
  to authenticated;

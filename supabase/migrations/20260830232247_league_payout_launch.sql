-- Launch-safe Creator League settlement, Stripe Connect recipients and
-- one-time purchase reversals.
--
-- The browser no longer chooses payout amounts. Closing a sprint freezes the
-- latest eligible counts, computes every creator's amount, allocates an
-- oversubscribed pool to the cent and writes an immutable settlement ledger in
-- one database transaction. A separate, service-role-only claim is the only
-- path from an approved ledger row to a Stripe transfer.

-- -------------------------------------------------------------------------
-- Creator terms and Stripe recipient state
-- -------------------------------------------------------------------------

alter table public.league_creators
  add column if not exists league_terms_version text,
  add column if not exists league_terms_accepted_at timestamptz;

-- Never manufacture click-wrap acceptance for a legacy or staff-created row.
-- The application RPC below is the only path that stamps both fields.
alter table public.league_creators
  alter column league_terms_version drop default,
  alter column league_terms_version drop not null,
  alter column league_terms_accepted_at drop default,
  alter column league_terms_accepted_at drop not null;

create table if not exists public.league_payout_accounts (
  user_id uuid not null references public.league_creators (user_id) on delete cascade,
  livemode boolean not null,
  stripe_account_id text,
  country text,
  entity_type text,
  transfers_status text not null default 'unknown'
    check (transfers_status in ('unknown', 'active', 'pending', 'restricted', 'unsupported')),
  payouts_status text not null default 'unknown'
    check (payouts_status in ('unknown', 'active', 'pending', 'restricted', 'unsupported')),
  requirements_due integer not null default 0 check (requirements_due >= 0),
  setup_token uuid,
  setup_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, livemode),
  unique (stripe_account_id),
  check (country is null or country ~ '^[A-Z]{2}$'),
  check (entity_type is null or entity_type in ('individual', 'company', 'non_profit'))
);

alter table public.league_payout_accounts enable row level security;
revoke all on table public.league_payout_accounts from public, anon, authenticated;

-- Applications are click-wrap records, not arbitrary inserts. The function
-- requires the current terms version and explicit adult/terms confirmations;
-- its definer privileges do not make approval self-serve.
create or replace function public.apply_to_creator_league(
  p_handle text,
  p_display_name text,
  p_niche text,
  p_links jsonb,
  p_pitch text,
  p_adult boolean,
  p_accept_terms boolean,
  p_terms_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_adult is distinct from true or p_accept_terms is distinct from true
     or p_terms_version is distinct from '2026-08-31' then
    raise exception 'Adult eligibility and current Creator League terms are required'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_handle), '') is null
     or nullif(btrim(p_display_name), '') is null
     or length(p_handle) > 60 or length(p_display_name) > 60
     or jsonb_typeof(p_links) <> 'array'
     or jsonb_array_length(p_links) not between 2 and 3
     or coalesce(length(p_pitch), 0) > 500 then
    raise exception 'Invalid Creator League application' using errcode = '22023';
  end if;

  insert into public.league_creators (
    user_id, handle, display_name, niche, links, pitch, status,
    league_terms_version, league_terms_accepted_at
  ) values (
    caller_id, btrim(p_handle), btrim(p_display_name), nullif(btrim(p_niche), ''),
    p_links, nullif(btrim(p_pitch), ''), 'applied',
    '2026-08-31', now()
  );
  return true;
end;
$$;

revoke insert on table public.league_creators from authenticated;
revoke update on table public.league_creators from authenticated;
grant update (
  handle, display_name, niche, links, pitch, status,
  pillar_grants, monthly_render_quota, approved_at
) on public.league_creators to authenticated;
revoke all on function public.apply_to_creator_league(text, text, text, jsonb, text, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.apply_to_creator_league(text, text, text, jsonb, text, boolean, boolean, text)
  to authenticated;

-- Account creation crosses a network boundary. This claim serializes two
-- simultaneous onboarding clicks; the Stripe request uses its own stable
-- idempotency key as the second line of defence.
create or replace function public.claim_league_payout_account_setup(
  p_user_id uuid,
  p_livemode boolean,
  p_country text,
  p_entity_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim uuid := gen_random_uuid();
  account_id text;
  held_token uuid;
  held_at timestamptz;
begin
  if p_user_id is null or p_livemode is null
     or p_country !~ '^[A-Z]{2}$'
     or p_entity_type not in ('individual', 'company', 'non_profit') then
    raise exception 'Invalid payout account setup' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.league_creators
    where user_id = p_user_id and status = 'approved'
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_livemode::text, 0));
  insert into public.league_payout_accounts (user_id, livemode, country, entity_type)
  values (p_user_id, p_livemode, p_country, p_entity_type)
  on conflict (user_id, livemode) do nothing;

  select stripe_account_id, setup_token, setup_started_at
    into account_id, held_token, held_at
  from public.league_payout_accounts
  where user_id = p_user_id and livemode = p_livemode
  for update;

  if account_id is not null then return null; end if;
  if held_token is not null and held_at > now() - interval '15 minutes' then return null; end if;

  update public.league_payout_accounts
    set setup_token = claim,
        setup_started_at = now(),
        country = p_country,
        entity_type = p_entity_type,
        updated_at = now()
    where user_id = p_user_id and livemode = p_livemode;
  return claim;
end;
$$;

create or replace function public.complete_league_payout_account_setup(
  p_user_id uuid,
  p_livemode boolean,
  p_claim uuid,
  p_stripe_account_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if nullif(btrim(p_stripe_account_id), '') is null then
    raise exception 'Stripe account ID is required' using errcode = '22023';
  end if;
  update public.league_payout_accounts
    set stripe_account_id = p_stripe_account_id,
        setup_token = null,
        setup_started_at = null,
        updated_at = now()
    where user_id = p_user_id and livemode = p_livemode and setup_token = p_claim;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.release_league_payout_account_setup(
  p_user_id uuid,
  p_livemode boolean,
  p_claim uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.league_payout_accounts
    set setup_token = null, setup_started_at = null, updated_at = now()
    where user_id = p_user_id and livemode = p_livemode and setup_token = p_claim;
$$;

revoke all on function public.claim_league_payout_account_setup(uuid, boolean, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_league_payout_account_setup(uuid, boolean, uuid, text)
  from public, anon, authenticated;
revoke all on function public.release_league_payout_account_setup(uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_league_payout_account_setup(uuid, boolean, text, text) to service_role;
grant execute on function public.complete_league_payout_account_setup(uuid, boolean, uuid, text) to service_role;
grant execute on function public.release_league_payout_account_setup(uuid, boolean, uuid) to service_role;

-- -------------------------------------------------------------------------
-- Canonical sprint settlement
-- -------------------------------------------------------------------------

alter table public.league_sprints
  add column if not exists currency text not null default 'usd',
  add column if not exists campaign_tag text not null default '#truemax',
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users (id) on delete set null,
  add column if not exists settlement_status text not null default 'open';

alter table public.league_sprints
  drop constraint if exists league_sprints_currency_check,
  add constraint league_sprints_currency_check check (currency = 'usd'),
  drop constraint if exists league_sprints_campaign_tag_check,
  add constraint league_sprints_campaign_tag_check
    check (campaign_tag ~ '^#[a-z0-9_]{3,32}$'),
  drop constraint if exists league_sprints_settlement_status_check,
  add constraint league_sprints_settlement_status_check
    check (settlement_status in ('open', 'frozen', 'complete'));

-- Existing payout rows are historical transfers. Preserve them while moving
-- the live workflow to explicit computed, approved, processing and transferred
-- states.
alter table public.league_payouts drop constraint if exists league_payouts_status_check;
update public.league_payouts set status = 'transferred' where status = 'paid';
update public.league_payouts set status = 'computed' where status = 'pending';

alter table public.league_payouts
  alter column creator_id drop not null,
  add column if not exists creator_display_name text,
  add column if not exists creator_handle text,
  add column if not exists currency text not null default 'usd',
  add column if not exists accrued_cents integer,
  add column if not exists final_views bigint not null default 0,
  add column if not exists final_comments bigint not null default 0,
  add column if not exists calculation jsonb not null default '{}'::jsonb,
  add column if not exists formula_version text not null default 'league-v1',
  add column if not exists formula_hash text,
  add column if not exists due_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists transfer_attempt_id uuid,
  add column if not exists transfer_requested_at timestamptz,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_transfer_id text,
  add column if not exists transferred_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.league_payouts
  drop constraint if exists league_payouts_creator_id_fkey,
  add constraint league_payouts_creator_id_fkey
    foreign key (creator_id) references public.league_creators (user_id) on delete set null,
  add constraint league_payouts_status_check
    check (status in ('computed', 'approved', 'processing', 'transferred', 'failed', 'cancelled')),
  add constraint league_payouts_currency_check check (currency ~ '^[a-z]{3}$'),
  add constraint league_payouts_accrued_check check (accrued_cents is null or accrued_cents >= amount_cents),
  add constraint league_payouts_transfer_id_unique unique (stripe_transfer_id);

update public.league_payouts p
set creator_display_name = coalesce(p.creator_display_name, c.display_name),
    creator_handle = coalesce(p.creator_handle, c.handle),
    transferred_at = coalesce(p.transferred_at, case when p.status = 'transferred' then p.created_at end),
    due_at = coalesce(p.due_at, p.created_at),
    updated_at = now()
from public.league_creators c
where p.creator_id = c.user_id;

create index if not exists league_payouts_due_status_idx
  on public.league_payouts (status, due_at)
  where status <> 'transferred';

-- A connected TikTok account proves who posted a video, not what is in it.
-- The caption tag is checked from TikTok's API; the actual final frames and
-- commercial-content disclosure stay a human review. All four facts are
-- stored separately so no generic "approved" click can accidentally make an
-- unrelated viral post payable.
alter table public.league_submissions
  add column if not exists caption_snapshot text,
  add column if not exists caption_checked_at timestamptz,
  add column if not exists caption_compliant boolean not null default false,
  add column if not exists compliance_hold_reason text,
  add column if not exists creator_cta_attested_at timestamptz,
  add column if not exists creator_disclosure_attested_at timestamptz,
  add column if not exists cta_variant text,
  add column if not exists cta_verified_at timestamptz,
  add column if not exists cta_verified_by uuid references auth.users (id) on delete set null,
  add column if not exists disclosure_verified_at timestamptz,
  add column if not exists review_note text;

alter table public.league_submissions
  drop constraint if exists league_submissions_cta_variant_check,
  add constraint league_submissions_cta_variant_check
    check (cta_variant is null or cta_variant in ('short', 'long', 'custom')),
  drop constraint if exists league_submissions_caption_snapshot_check,
  add constraint league_submissions_caption_snapshot_check
    check (caption_snapshot is null or length(caption_snapshot) <= 4000),
  drop constraint if exists league_submissions_compliance_hold_check,
  add constraint league_submissions_compliance_hold_check
    check (compliance_hold_reason is null or length(compliance_hold_reason) <= 500),
  drop constraint if exists league_submissions_review_note_check,
  add constraint league_submissions_review_note_check
    check (review_note is null or length(review_note) <= 1000);

-- A creator can attest to what they posted, but cannot pre-fill ownership,
-- caption verification or staff-review fields in a crafted insert. Staff also
-- lose direct UPDATE; the review RPC below is the only browser write path.
drop policy if exists submissions_self_insert on public.league_submissions;
create policy submissions_self_insert on public.league_submissions
  for insert to authenticated
  with check (
    (select auth.uid()) = creator_id
    and status = 'pending'
    and public.league_is_approved()
    and creator_cta_attested_at is not null
    and creator_disclosure_attested_at is not null
    and tiktok_video_id is null
    and caption_snapshot is null
    and caption_checked_at is null
    and caption_compliant = false
    and compliance_hold_reason is null
    and cta_variant is null
    and cta_verified_at is null
    and cta_verified_by is null
    and disclosure_verified_at is null
    and review_note is null
    and exists (
      select 1 from public.league_sprints sprint
      where sprint.id = sprint_id
        and sprint.status = 'active'
        and now() between sprint.starts_at and sprint.ends_at
    )
  );

drop policy if exists submissions_staff_write on public.league_submissions;
revoke update, delete on table public.league_submissions from authenticated;
grant select, insert on table public.league_submissions to authenticated;

create or replace function public.review_league_submission(
  p_submission_id uuid,
  p_approved boolean,
  p_cta_variant text default null,
  p_disclosure_verified boolean default false,
  p_caption_verified boolean default false,
  p_content_viewed boolean default false,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.league_submissions%rowtype;
  sprint public.league_sprints%rowtype;
begin
  if not public.league_is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into submission from public.league_submissions
  where id = p_submission_id for update;
  if submission.id is null then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if submission.status not in ('pending', 'approved', 'earning') then
    raise exception 'Submission is not reviewable' using errcode = '22023';
  end if;
  select * into sprint from public.league_sprints where id = submission.sprint_id;

  if not p_approved then
    update public.league_submissions
      set status = 'rejected',
          review_note = left(coalesce(nullif(btrim(p_note), ''), 'The video did not meet this sprint''s content requirements.'), 1000),
          cta_variant = null,
          cta_verified_at = null,
          cta_verified_by = null,
          disclosure_verified_at = null
      where id = p_submission_id;
    return true;
  end if;

  if p_content_viewed is not true
     or submission.creator_cta_attested_at is null
     or submission.creator_disclosure_attested_at is null
     or p_cta_variant is null
     or p_cta_variant not in ('short', 'long', 'custom')
     or p_disclosure_verified is not true then
    raise exception 'CTA and disclosure review is incomplete' using errcode = '22023';
  end if;

  if submission.platform = 'tiktok' then
    if submission.tiktok_video_id is null or submission.caption_compliant is not true then
      raise exception 'TikTok ownership and campaign tag must be verified first' using errcode = '22023';
    end if;
    if now() >= sprint.ends_at
       and (submission.caption_checked_at is null or submission.caption_checked_at < sprint.ends_at) then
      raise exception 'Run the final TikTok caption check before settlement review' using errcode = '22023';
    end if;
  elsif p_caption_verified is not true then
    raise exception 'Campaign tag must be verified first' using errcode = '22023';
  end if;

  update public.league_submissions
    set status = 'approved',
        caption_compliant = case when platform = 'tiktok' then caption_compliant else true end,
        caption_checked_at = case when platform = 'tiktok' then caption_checked_at else now() end,
        compliance_hold_reason = null,
        cta_variant = p_cta_variant,
        cta_verified_at = now(),
        cta_verified_by = (select auth.uid()),
        disclosure_verified_at = now(),
        review_note = left(nullif(btrim(p_note), ''), 1000)
    where id = p_submission_id;
  return true;
end;
$$;

-- Rows submitted before this launch migration need an honest way to collect
-- the same per-post declaration; never fabricate it from created_at.
create or replace function public.attest_league_submission(
  p_submission_id uuid,
  p_cta_attested boolean,
  p_disclosure_attested boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_cta_attested is not true or p_disclosure_attested is not true then
    raise exception 'Both declarations are required' using errcode = '22023';
  end if;
  update public.league_submissions
    set creator_cta_attested_at = now(), creator_disclosure_attested_at = now()
    where id = p_submission_id
      and creator_id = (select auth.uid())
      and status in ('pending', 'approved', 'earning');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- RLS is still owner-or-staff read. Browser writes are removed entirely;
-- settlement and transfer state only move through the functions below.
drop policy if exists payouts_staff_write on public.league_payouts;
revoke all on table public.league_payouts from anon, authenticated;
grant select (
  id, creator_id, sprint_id, creator_display_name, creator_handle,
  amount_cents, accrued_cents, currency, note, status,
  final_views, final_comments, calculation, formula_version, formula_hash,
  due_at, approved_at, transferred_at, created_at, updated_at
) on public.league_payouts to authenticated;

-- A trigger applies even when the service role writes. It closes the cron race
-- where the tracker selected an active sprint, the sprint closed, and the
-- delayed network response inserted a newer count after settlement.
create or replace function public.guard_league_snapshot_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sprint public.league_sprints%rowtype;
  submission public.league_submissions%rowtype;
begin
  select sp.* into sprint
  from public.league_submissions sub
  join public.league_sprints sp on sp.id = sub.sprint_id
  where sub.id = new.submission_id;
  select * into submission from public.league_submissions
  where id = new.submission_id;

  if sprint.id is null or sprint.status <> 'active'
     or now() < sprint.starts_at or now() > sprint.ends_at then
    raise exception 'Counts can only be recorded during an active sprint'
      using errcode = '55000';
  end if;
  if submission.status not in ('approved', 'earning')
     or submission.caption_compliant is not true
     or submission.cta_verified_at is null
     or submission.disclosure_verified_at is null then
    raise exception 'Counts require verified ownership, CTA, caption and disclosure'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists league_snapshot_insert_guard on public.league_stat_snapshots;
create trigger league_snapshot_insert_guard
before insert on public.league_stat_snapshots
for each row execute function public.guard_league_snapshot_insert();

-- Sprints are created and moved through their lifecycle by narrow RPCs. This
-- prevents a staff browser from bypassing the close transaction with a direct
-- status update.
revoke insert, update, delete on table public.league_sprints from authenticated;
grant select on table public.league_sprints to authenticated;

create or replace function public.create_league_sprint(
  p_name text,
  p_pool_cents integer,
  p_currency text,
  p_campaign_tag text,
  p_formula jsonb,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sprint_id uuid;
begin
  if not public.league_is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null or length(p_name) > 60
     or p_pool_cents < 0 or coalesce(lower(p_currency), '') <> 'usd'
     or coalesce(lower(btrim(p_campaign_tag)), '') !~ '^#[a-z0-9_]{3,32}$'
     or jsonb_typeof(p_formula) <> 'object'
     or p_ends_at <= p_starts_at then
    raise exception 'Invalid sprint' using errcode = '22023';
  end if;
  insert into public.league_sprints (
    name, pool_cents, currency, campaign_tag, tiers, formula, starts_at, ends_at, status
  ) values (
    btrim(p_name), p_pool_cents, 'usd', lower(btrim(p_campaign_tag)), '[]'::jsonb, p_formula,
    p_starts_at, p_ends_at, 'draft'
  ) returning id into sprint_id;
  return sprint_id;
end;
$$;

create or replace function public.activate_league_sprint(p_sprint_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if not public.league_is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.league_sprints
    set status = 'active', settlement_status = 'open'
    where id = p_sprint_id and status = 'draft' and ends_at > now();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.finalize_league_sprint(p_sprint_id uuid)
returns setof public.league_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  sprint public.league_sprints%rowtype;
  formula jsonb;
  rpm numeric;
  par_comments numeric;
  e_min numeric;
  e_max numeric;
  threshold_views bigint;
  threshold_comments bigint;
  video_cap bigint;
  creator_cap bigint;
begin
  if not public.league_is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into sprint from public.league_sprints
  where id = p_sprint_id for update;
  if sprint.id is null then
    raise exception 'Sprint not found' using errcode = 'P0002';
  end if;
  if sprint.status = 'closed' and sprint.settlement_status in ('frozen', 'complete') then
    return query select * from public.league_payouts where sprint_id = p_sprint_id order by amount_cents desc, id;
    return;
  end if;
  if sprint.status not in ('active', 'closed') or (sprint.status = 'closed' and sprint.settlement_status <> 'open') then
    raise exception 'Only an active sprint can be finalized' using errcode = '22023';
  end if;
  if sprint.ends_at > now() then
    raise exception 'A sprint cannot close before its published end' using errcode = '22023';
  end if;
  if jsonb_typeof(sprint.formula) <> 'object' then
    raise exception 'A payout formula is required' using errcode = '22023';
  end if;

  -- A creator can remove a hashtag, disclosure or CTA after the first review.
  -- Closing therefore requires a second, post-deadline check for every post
  -- that could earn. Missing review is an error, never a silent exclusion.
  if exists (
    select 1 from public.league_submissions sub
    where sub.sprint_id = p_sprint_id
      and sub.status in ('approved', 'earning')
      and (
        sub.caption_compliant is not true
        or sub.caption_checked_at is null or sub.caption_checked_at < sprint.ends_at
        or sub.cta_verified_at is null or sub.cta_verified_at < sprint.ends_at
        or sub.disclosure_verified_at is null or sub.disclosure_verified_at < sprint.ends_at
      )
  ) then
    raise exception 'Every earning post needs a final caption, CTA and disclosure review'
      using errcode = '55000';
  end if;

  formula := sprint.formula;
  rpm := coalesce((formula ->> 'rpmCents')::numeric, 200);
  par_comments := coalesce((formula ->> 'parCommentsPer1k')::numeric, 0.4);
  e_min := coalesce((formula ->> 'eMin')::numeric, 0.5);
  e_max := coalesce((formula ->> 'eMax')::numeric, 1.3);
  threshold_views := coalesce((formula ->> 'thresholdViews')::bigint, 25000);
  threshold_comments := coalesce((formula ->> 'thresholdComments')::bigint, 25);
  video_cap := coalesce((formula ->> 'videoCapCents')::bigint, 60000);
  creator_cap := coalesce((formula ->> 'creatorCapCents')::bigint, 250000);
  if rpm < 0 or par_comments <= 0 or e_min < 0 or e_max < e_min
     or threshold_views < 0 or threshold_comments < 0
     or video_cap < 0 or creator_cap < 0 then
    raise exception 'The sprint payout formula is invalid' using errcode = '22023';
  end if;

  update public.league_sprints
    set status = 'closed', closed_at = now(), closed_by = (select auth.uid()),
        settlement_status = 'frozen'
    where id = p_sprint_id;

  with latest as (
    select sub.creator_id, sub.id as submission_id, snap.views, snap.comments, snap.at
    from public.league_submissions sub
    join lateral (
      select s.views, s.comments, s.at
      from public.league_stat_snapshots s
      where s.submission_id = sub.id
      order by s.at desc, s.id desc
      limit 1
    ) snap on true
    where sub.sprint_id = p_sprint_id
      and sub.status in ('approved', 'earning')
      and sub.caption_compliant is true
      and sub.caption_checked_at >= sprint.ends_at
      and sub.cta_verified_at >= sprint.ends_at
      and sub.disclosure_verified_at >= sprint.ends_at
  ), video_values as (
    select creator_id, submission_id, views, comments, at,
      least(
        video_cap,
        round(rpm * (views::numeric / 1000) *
          case when views <= 0 then e_min else
            least(e_max, greatest(e_min,
              (comments::numeric / (views::numeric / 1000)) / par_comments))
          end
        )::bigint
      ) as video_cents
    from latest
  ), creator_values as (
    select creator_id,
      sum(views)::bigint as final_views,
      sum(comments)::bigint as final_comments,
      jsonb_agg(jsonb_build_object(
        'submissionId', submission_id,
        'views', views,
        'comments', comments,
        'snapshotAt', at,
        'videoCents', video_cents
      ) order by submission_id) as final_snapshots,
      case when sum(views) >= threshold_views and sum(comments) >= threshold_comments
        then least(creator_cap, sum(video_cents)::bigint)
        else 0
      end as accrued_cents
    from video_values
    group by creator_id
  ), positive as (
    select *, sum(accrued_cents) over ()::bigint as total_accrued
    from creator_values where accrued_cents > 0
  ), base as (
    select *,
      case when total_accrued <= sprint.pool_cents then accrued_cents
        else floor(accrued_cents::numeric * sprint.pool_cents / total_accrued)::bigint
      end as base_cents,
      case when total_accrued <= sprint.pool_cents then 0
        else mod(accrued_cents * sprint.pool_cents::bigint, total_accrued)
      end as remainder
    from positive
  ), ranked as (
    select *,
      row_number() over (order by remainder desc, creator_id) as remainder_rank,
      case when total_accrued <= sprint.pool_cents then 0
        else sprint.pool_cents - sum(base_cents) over ()
      end as cents_left
    from base
  ), allocated as (
    select *, (base_cents + case when remainder_rank <= cents_left then 1 else 0 end)::integer as payout_cents
    from ranked
  )
  insert into public.league_payouts (
    creator_id, sprint_id, creator_display_name, creator_handle,
    amount_cents, accrued_cents, currency, note, status,
    final_views, final_comments, calculation, formula_version, formula_hash, due_at
  )
  select a.creator_id, p_sprint_id, c.display_name, c.handle,
    a.payout_cents, a.accrued_cents::integer, sprint.currency, sprint.name, 'computed',
    a.final_views, a.final_comments,
    jsonb_build_object(
      'formula', formula,
      'poolCents', sprint.pool_cents,
      'totalAccruedCents', a.total_accrued,
      'poolScale', case when a.total_accrued <= 0 then 1
        else least(1, sprint.pool_cents::numeric / a.total_accrued) end,
      'videos', a.final_snapshots
    ),
    'league-v1', md5(formula::text), now() + interval '7 days'
  from allocated a
  join public.league_creators c on c.user_id = a.creator_id
  where a.payout_cents > 0
  on conflict (sprint_id, creator_id) where sprint_id is not null do nothing;

  if not exists (
    select 1 from public.league_payouts
    where sprint_id = p_sprint_id and status <> 'transferred'
  ) then
    update public.league_sprints set settlement_status = 'complete'
    where id = p_sprint_id;
  end if;

  return query select * from public.league_payouts
    where sprint_id = p_sprint_id order by amount_cents desc, id;
end;
$$;

create or replace function public.approve_league_payout(p_payout_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if not public.league_is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.league_payouts
    set status = 'approved', approved_by = (select auth.uid()), approved_at = now(),
        failure_code = null, failure_message = null, updated_at = now()
    where id = p_payout_id and status = 'computed';
  get diagnostics changed = row_count;
  if changed = 1 then return true; end if;
  return exists (
    select 1 from public.league_payouts
    where id = p_payout_id and status in ('approved', 'processing', 'transferred', 'failed')
  );
end;
$$;

-- The endpoint cannot attach arbitrary Stripe destinations to a payout. It
-- chooses the account row for the current Stripe mode, then claims atomically.
create or replace function public.claim_league_transfer_for_mode(
  p_payout_id uuid,
  p_livemode boolean
)
returns table (
  payout_id uuid,
  creator_id uuid,
  amount_cents integer,
  currency text,
  stripe_account_id text,
  attempt_id uuid,
  sprint_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  payout public.league_payouts%rowtype;
  account_id text;
  attempt uuid := gen_random_uuid();
begin
  select * into payout from public.league_payouts where id = p_payout_id for update;
  if payout.id is null or payout.creator_id is null or payout.approved_at is null then return; end if;
  if payout.status = 'transferred' then return; end if;
  if payout.status = 'processing'
     and payout.transfer_requested_at > now() - interval '15 minutes' then return; end if;
  if payout.status not in ('approved', 'failed', 'processing') then return; end if;

  select a.stripe_account_id into account_id
  from public.league_payout_accounts a
  where a.user_id = payout.creator_id and a.livemode = p_livemode;
  if account_id is null then return; end if;

  update public.league_payouts
    set status = 'processing', transfer_attempt_id = attempt,
        transfer_requested_at = now(), stripe_account_id = account_id,
        failure_code = null, failure_message = null, updated_at = now()
    where id = p_payout_id;
  return query select payout.id, payout.creator_id, payout.amount_cents, payout.currency,
    account_id, attempt, payout.sprint_id;
end;
$$;

create or replace function public.complete_league_transfer(
  p_payout_id uuid,
  p_attempt_id uuid,
  p_stripe_transfer_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payout public.league_payouts%rowtype;
begin
  select * into payout from public.league_payouts where id = p_payout_id for update;
  if payout.status = 'transferred' then
    return payout.stripe_transfer_id = p_stripe_transfer_id;
  end if;
  if payout.status <> 'processing' or payout.transfer_attempt_id is distinct from p_attempt_id then
    return false;
  end if;
  update public.league_payouts
    set status = 'transferred', stripe_transfer_id = p_stripe_transfer_id,
        transferred_at = now(), failure_code = null, failure_message = null, updated_at = now()
    where id = p_payout_id;
  update public.league_submissions
    set status = 'paid_out'
    where creator_id = payout.creator_id and sprint_id = payout.sprint_id
      and status in ('approved', 'earning')
      and caption_compliant is true
      and cta_verified_at is not null
      and disclosure_verified_at is not null;
  if not exists (
    select 1 from public.league_payouts
    where sprint_id = payout.sprint_id and status <> 'transferred'
  ) then
    update public.league_sprints set settlement_status = 'complete'
    where id = payout.sprint_id;
  end if;
  return true;
end;
$$;

create or replace function public.fail_league_transfer(
  p_payout_id uuid,
  p_attempt_id uuid,
  p_code text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.league_payouts
    set status = 'failed', failure_code = left(coalesce(p_code, 'transfer_failed'), 80),
        failure_message = left(coalesce(p_message, 'Stripe transfer failed'), 500), updated_at = now()
    where id = p_payout_id and status = 'processing' and transfer_attempt_id = p_attempt_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.create_league_sprint(text, integer, text, text, jsonb, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.review_league_submission(uuid, boolean, text, boolean, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.attest_league_submission(uuid, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.activate_league_sprint(uuid) from public, anon, authenticated;
revoke all on function public.finalize_league_sprint(uuid) from public, anon, authenticated;
revoke all on function public.approve_league_payout(uuid) from public, anon, authenticated;
grant execute on function public.create_league_sprint(text, integer, text, text, jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.review_league_submission(uuid, boolean, text, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.attest_league_submission(uuid, boolean, boolean) to authenticated;
grant execute on function public.activate_league_sprint(uuid) to authenticated;
grant execute on function public.finalize_league_sprint(uuid) to authenticated;
grant execute on function public.approve_league_payout(uuid) to authenticated;

revoke all on function public.claim_league_transfer_for_mode(uuid, boolean) from public, anon, authenticated;
revoke all on function public.complete_league_transfer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_league_transfer(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_league_transfer_for_mode(uuid, boolean) to service_role;
grant execute on function public.complete_league_transfer(uuid, uuid, text) to service_role;
grant execute on function public.fail_league_transfer(uuid, uuid, text, text) to service_role;

-- The old arbitrary-amount path is no longer callable.
revoke all on function public.record_league_payout(uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;

create or replace function public.league_leaderboard()
returns table (user_id uuid, display_name text, handle text, earned_cents bigint)
language sql stable security definer set search_path = '' as $$
  select c.user_id, c.display_name, c.handle,
         coalesce(sum(p.amount_cents), 0)::bigint as earned_cents
  from public.league_creators c
  left join public.league_payouts p
    on p.creator_id = c.user_id and p.status = 'transferred'
  where c.status = 'approved'
    and (public.league_is_approved() or public.league_is_staff())
  group by c.user_id, c.display_name, c.handle
  order by earned_cents desc;
$$;
revoke all on function public.league_leaderboard() from public, anon, authenticated;
grant execute on function public.league_leaderboard() to authenticated;

-- -------------------------------------------------------------------------
-- Refund and dispute reconciliation for one-time credits
-- -------------------------------------------------------------------------

alter table public.scan_credits add column if not exists debt integer not null default 0 check (debt >= 0);
alter table public.voice_credits add column if not exists debt integer not null default 0 check (debt >= 0);

alter table public.billing_credit_events
  drop constraint if exists billing_credit_events_user_id_fkey,
  alter column user_id drop not null,
  add constraint billing_credit_events_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null;

create table if not exists public.billing_credit_reversals (
  checkout_session_id text primary key references public.billing_credit_events (checkout_session_id) on delete cascade,
  credit_kind text not null check (credit_kind in ('scan', 'voice')),
  credits integer not null check (credits > 0),
  refund_active boolean not null default false,
  dispute_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_credit_adjustment_events (
  event_id text primary key,
  checkout_session_id text not null references public.billing_credit_events (checkout_session_id) on delete cascade,
  action text not null check (action in ('refund_full', 'dispute_open', 'dispute_won')),
  created_at timestamptz not null default now()
);

alter table public.billing_credit_reversals enable row level security;
alter table public.billing_credit_adjustment_events enable row level security;
revoke all on table public.billing_credit_reversals from public, anon, authenticated;
revoke all on table public.billing_credit_adjustment_events from public, anon, authenticated;

create or replace function public.apply_credit_delta(
  p_user_id uuid,
  p_credit_kind text,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_balance integer;
  current_debt integer;
  n integer := abs(p_delta);
begin
  if p_user_id is null or p_credit_kind not in ('scan', 'voice') or p_delta = 0 then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_credit_kind, 0));

  if p_credit_kind = 'scan' then
    insert into public.scan_credits (user_id) values (p_user_id) on conflict do nothing;
    select balance, debt into current_balance, current_debt
      from public.scan_credits where user_id = p_user_id for update;
    if p_delta < 0 then
      update public.scan_credits set
        balance = greatest(0, current_balance - n),
        debt = current_debt + greatest(0, n - current_balance),
        updated_at = now()
      where user_id = p_user_id;
    else
      update public.scan_credits set
        debt = greatest(0, current_debt - n),
        balance = current_balance + greatest(0, n - current_debt),
        updated_at = now()
      where user_id = p_user_id;
    end if;
  else
    insert into public.voice_credits (user_id) values (p_user_id) on conflict do nothing;
    select balance, debt into current_balance, current_debt
      from public.voice_credits where user_id = p_user_id for update;
    if p_delta < 0 then
      update public.voice_credits set
        balance = greatest(0, current_balance - n),
        debt = current_debt + greatest(0, n - current_balance),
        updated_at = now()
      where user_id = p_user_id;
    else
      update public.voice_credits set
        debt = greatest(0, current_debt - n),
        balance = current_balance + greatest(0, n - current_debt),
        updated_at = now()
      where user_id = p_user_id;
    end if;
  end if;
end;
$$;

-- Replace the grant so a customer cannot refund a consumed credit, buy again
-- and keep both. A new grant first clears any debt created by a prior reversal.
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
     or p_user_id is null or p_credit_kind not in ('scan', 'voice') or p_credits < 1 then
    raise exception 'Invalid credit event' using errcode = '22023';
  end if;
  insert into public.billing_credit_events (
    event_id, checkout_session_id, user_id, credit_kind, credits
  ) values (p_event_id, p_checkout_session_id, p_user_id, p_credit_kind, p_credits)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return false; end if;
  perform public.apply_credit_delta(p_user_id, p_credit_kind, p_credits);
  return true;
end;
$$;

create or replace function public.reconcile_one_time_credit(
  p_event_id text,
  p_checkout_session_id text,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase public.billing_credit_events%rowtype;
  state public.billing_credit_reversals%rowtype;
  was_blocked boolean;
  is_blocked boolean;
  inserted integer;
begin
  if nullif(btrim(p_event_id), '') is null
     or nullif(btrim(p_checkout_session_id), '') is null
     or p_action not in ('refund_full', 'dispute_open', 'dispute_won') then
    raise exception 'Invalid credit adjustment' using errcode = '22023';
  end if;
  select * into purchase from public.billing_credit_events
    where checkout_session_id = p_checkout_session_id for update;
  if purchase.event_id is null then return false; end if;

  insert into public.billing_credit_adjustment_events (event_id, checkout_session_id, action)
  values (p_event_id, p_checkout_session_id, p_action)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return true; end if;

  insert into public.billing_credit_reversals (
    checkout_session_id, credit_kind, credits
  ) values (p_checkout_session_id, purchase.credit_kind, purchase.credits)
  on conflict (checkout_session_id) do nothing;
  select * into state from public.billing_credit_reversals
    where checkout_session_id = p_checkout_session_id for update;

  was_blocked := state.refund_active or state.dispute_active;
  update public.billing_credit_reversals set
    refund_active = case when p_action = 'refund_full' then true else refund_active end,
    dispute_active = case
      when p_action = 'dispute_open' then true
      when p_action = 'dispute_won' then false
      else dispute_active end,
    updated_at = now()
  where checkout_session_id = p_checkout_session_id
  returning (refund_active or dispute_active) into is_blocked;

  if not was_blocked and is_blocked then
    perform public.apply_credit_delta(purchase.user_id, purchase.credit_kind, -purchase.credits);
  elsif was_blocked and not is_blocked then
    perform public.apply_credit_delta(purchase.user_id, purchase.credit_kind, purchase.credits);
  end if;
  return true;
end;
$$;

revoke all on function public.apply_credit_delta(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.apply_one_time_credit(text, text, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.reconcile_one_time_credit(text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_one_time_credit(text, text, uuid, text, integer) to service_role;
grant execute on function public.reconcile_one_time_credit(text, text, text) to service_role;

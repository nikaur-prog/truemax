-- A pseudonymous consent trail for optional side-landmark feedback.
--
-- This deliberately has no user_id or foreign key back to auth.users. The
-- submission and scan UUIDs prove which consented payload changed state
-- without keeping an account identifier after the source row/account is gone.
-- Browser roles have no privileges; the authenticated Vercel route is the
-- only caller and binds every operation to the verified Supabase user.

create table public.side_feedback_consent_events (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null,
  scan_id           uuid not null,
  event_type        text not null,
  consent_version   text not null,
  occurred_at       timestamptz not null default now(),
  retain_until      timestamptz not null default (now() + interval '365 days'),
  details           jsonb not null default '{}'::jsonb,
  constraint side_feedback_consent_event_type
    check (event_type in ('granted', 'revoked', 'expired', 'deleted')),
  constraint side_feedback_consent_event_version
    check (consent_version = 'side-landmark-feedback-v1'),
  constraint side_feedback_consent_event_retention
    check (retain_until > occurred_at),
  constraint side_feedback_consent_event_details
    check (jsonb_typeof(details) = 'object'),
  constraint side_feedback_consent_event_once
    unique (submission_id, event_type)
);

comment on table public.side_feedback_consent_events is
  'Service-only, pseudonymous consent lifecycle events retained for at most 365 days.';

alter table public.side_feedback_consent_events enable row level security;
revoke all on table public.side_feedback_consent_events from public, anon, authenticated;
grant select, insert, delete on table public.side_feedback_consent_events to service_role;

create index side_feedback_consent_retain_idx
  on public.side_feedback_consent_events (retain_until);
create index side_feedback_consent_submission_idx
  on public.side_feedback_consent_events (submission_id, occurred_at desc);

-- Preserve a grant record for feedback accepted before this migration. The
-- event outlives the 90-day photo/landmark row but still expires on its own.
insert into public.side_feedback_consent_events (
  submission_id,
  scan_id,
  event_type,
  consent_version,
  occurred_at,
  retain_until,
  details
)
select
  id,
  scan_id,
  'granted',
  consent_version,
  created_at,
  created_at + interval '365 days',
  jsonb_build_object('source', 'migration_backfill')
from public.side_landmark_feedback
on conflict (submission_id, event_type) do nothing;

-- Every row deletion queues its private object and records why the source row
-- disappeared. Expiry is detected from the row itself, so the daily cleanup
-- cannot delete expired feedback without producing the matching audit event.
create or replace function private.queue_side_feedback_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion_event text;
begin
  insert into public.side_feedback_storage_cleanup (storage_path)
  values (old.storage_path)
  on conflict (storage_path) do nothing;

  deletion_event := case
    when old.expires_at <= now() then 'expired'
    else 'deleted'
  end;

  insert into public.side_feedback_consent_events (
    submission_id,
    scan_id,
    event_type,
    consent_version,
    details
  ) values (
    old.id,
    old.scan_id,
    deletion_event,
    old.consent_version,
    jsonb_build_object('source', 'row_delete_trigger')
  )
  on conflict (submission_id, event_type) do nothing;

  return old;
end;
$$;

revoke all on function private.queue_side_feedback_storage_cleanup()
  from public, anon, authenticated;

-- The service route calls one security-invoker function so ownership checking,
-- deletion and the explicit revocation event commit (or roll back) together.
-- It is in the exposed schema only so PostgREST can call it; browser roles are
-- explicitly denied EXECUTE and it does not use SECURITY DEFINER.
create or replace function public.revoke_side_feedback(
  p_submission_id uuid,
  p_scan_id uuid,
  p_user_id uuid
)
returns table(storage_path text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed_storage_path text;
  removed_consent_version text;
begin
  delete from public.side_landmark_feedback as feedback
  where feedback.id = p_submission_id
    and feedback.scan_id = p_scan_id
    and feedback.user_id = p_user_id
  returning feedback.storage_path, feedback.consent_version
  into removed_storage_path, removed_consent_version;

  if not found then
    return;
  end if;

  insert into public.side_feedback_consent_events (
    submission_id,
    scan_id,
    event_type,
    consent_version,
    details
  ) values (
    p_submission_id,
    p_scan_id,
    'revoked',
    removed_consent_version,
    jsonb_build_object('source', 'authenticated_user')
  )
  on conflict (submission_id, event_type) do nothing;

  return query select removed_storage_path;
end;
$$;

revoke all on function public.revoke_side_feedback(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_side_feedback(uuid, uuid, uuid)
  to service_role;

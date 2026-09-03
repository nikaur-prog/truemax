-- Goal previews: consent, rendered output, quota, deletion, retention.
--
-- The first product surface that sends a person's own front and side
-- photographs off the device for rendering. Source photographs are never
-- stored by TrueMax: the route forwards them to the provider in memory and
-- drops them, as the side pass does. What is stored is the rendered output,
-- in a private bucket with no policies and no signed URLs, under a row that
-- expires. Consent is its own version, asked once, remembered here as an
-- event, revocable from Settings. The daily allowance is the same shape as
-- max_chat_usage and side_landmark_usage: a count and a date per account,
-- claimed atomically before the provider is called, released only when the
-- provider produced nothing. See docs/FACIAL_MORPH_PLAN.md section 5.

-- ---------------------------------------------------------------------------
-- Consent, pseudonymous, the same shape as side_feedback_consent_events. The
-- live answer lives in goal_preview_consents (one row per user, service-only
-- writes, owner-readable so Settings can show it); the trail lives here with
-- no user id and a 365-day retention.
-- ---------------------------------------------------------------------------

create table if not exists public.goal_preview_consents (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  consent_version  text not null,
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  updated_at       timestamptz not null default now(),
  constraint goal_preview_consent_version check (consent_version = 'goal-preview-v1')
);

alter table public.goal_preview_consents enable row level security;
revoke all on table public.goal_preview_consents from public, anon, authenticated;
grant select, insert, update, delete on table public.goal_preview_consents to service_role;

drop policy if exists "read own goal preview consent" on public.goal_preview_consents;
create policy "read own goal preview consent"
  on public.goal_preview_consents for select
  to authenticated
  using ((select auth.uid()) = user_id);
grant select on table public.goal_preview_consents to authenticated;

create table if not exists public.goal_preview_consent_events (
  id               uuid primary key default gen_random_uuid(),
  subject_id       uuid not null,
  event_type       text not null,
  consent_version  text not null,
  occurred_at      timestamptz not null default now(),
  retain_until     timestamptz not null default (now() + interval '365 days'),
  details          jsonb not null default '{}'::jsonb,
  constraint goal_preview_consent_event_type
    check (event_type in ('granted', 'revoked', 'expired', 'deleted', 'rendered', 'rejected')),
  constraint goal_preview_consent_event_version
    check (consent_version = 'goal-preview-v1'),
  constraint goal_preview_consent_event_retention
    check (retain_until > occurred_at),
  constraint goal_preview_consent_event_details
    check (jsonb_typeof(details) = 'object')
);

comment on table public.goal_preview_consent_events is
  'Service-only, pseudonymous goal-preview consent lifecycle events retained for at most 365 days. subject_id is a preview id or a consent id, never a user id.';

alter table public.goal_preview_consent_events enable row level security;
revoke all on table public.goal_preview_consent_events from public, anon, authenticated;
grant select, insert, delete on table public.goal_preview_consent_events to service_role;

create index if not exists goal_preview_consent_events_retain_idx
  on public.goal_preview_consent_events (retain_until);

-- ---------------------------------------------------------------------------
-- The previews. The row holds the spec and the contract the render was
-- allowed to do, where the two rendered views sit in the private bucket, the
-- client's re-measurement verdict when it posts one, and an expiry. It holds
-- no source photograph and no landmark of the person's own face.
-- ---------------------------------------------------------------------------

create table if not exists public.goal_previews (
  id                 uuid primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  scan_id            uuid not null,
  spec               jsonb not null,
  catalogue_version  text not null,
  consent_version    text not null,
  status             text not null default 'generating',
  provider           text not null,
  provider_job_ref   text,
  front_path         text,
  side_path          text,
  validation         jsonb,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default (now() + interval '30 days'),
  kept_until         timestamptz,
  constraint goal_preview_status
    check (status in ('generating', 'ready', 'rejected', 'failed')),
  constraint goal_preview_spec_object check (jsonb_typeof(spec) = 'object'),
  constraint goal_preview_validation_object
    check (validation is null or jsonb_typeof(validation) = 'object'),
  constraint goal_preview_consent_version check (consent_version = 'goal-preview-v1'),
  constraint goal_preview_catalogue_version check (catalogue_version ~ '^catalogue-[0-9]+$'),
  constraint goal_preview_provider check (provider in ('higgsfield', 'openai')),
  constraint goal_preview_paths
    check (front_path is null or (char_length(front_path) between 42 and 200)),
  constraint goal_preview_side_paths
    check (side_path is null or (char_length(side_path) between 42 and 200)),
  constraint goal_preview_expiry check (expires_at > created_at),
  constraint goal_preview_kept check (kept_until is null or kept_until <= created_at + interval '366 days')
);

comment on table public.goal_previews is
  'Rendered goal previews: spec, contract, output paths in the private goal-previews bucket, validation verdict, expiry. Source photographs are never stored.';

alter table public.goal_previews enable row level security;
revoke all on table public.goal_previews from public, anon, authenticated;
grant select, insert, update, delete on table public.goal_previews to service_role;

-- The owner may see their own rows' metadata (never a path), so Settings can
-- list previews with their expiry and offer deletion. Column-level grant.
drop policy if exists "read own goal previews" on public.goal_previews;
create policy "read own goal previews"
  on public.goal_previews for select
  to authenticated
  using ((select auth.uid()) = user_id);
grant select (id, scan_id, status, catalogue_version, consent_version, created_at, expires_at, kept_until)
  on table public.goal_previews to authenticated;

create index if not exists goal_previews_expires_idx
  on public.goal_previews (expires_at);
-- A render killed mid-flight leaves a 'generating' row; the sweep finds them.
create index if not exists goal_previews_generating_idx
  on public.goal_previews (created_at) where status = 'generating';
create index if not exists goal_previews_user_idx
  on public.goal_previews (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Storage cleanup queue and the trigger that feeds it. A deleted row, from a
-- revoke, an expiry sweep or an account deletion cascading from auth.users,
-- leaves its two objects in the queue for the daily cron to remove.
-- ---------------------------------------------------------------------------

create table if not exists public.goal_preview_storage_cleanup (
  storage_path  text primary key,
  queued_at     timestamptz not null default now()
);

alter table public.goal_preview_storage_cleanup enable row level security;
revoke all on table public.goal_preview_storage_cleanup from public, anon, authenticated;
grant select, insert, delete on table public.goal_preview_storage_cleanup to service_role;

create schema if not exists private;

create or replace function private.queue_goal_preview_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.front_path is not null then
    insert into public.goal_preview_storage_cleanup (storage_path)
    values (old.front_path)
    on conflict (storage_path) do nothing;
  end if;
  if old.side_path is not null then
    insert into public.goal_preview_storage_cleanup (storage_path)
    values (old.side_path)
    on conflict (storage_path) do nothing;
  end if;
  insert into public.goal_preview_consent_events (subject_id, event_type, consent_version, details)
  values (
    old.id,
    case when old.expires_at <= now() and old.kept_until is null then 'expired' else 'deleted' end,
    old.consent_version,
    jsonb_build_object('status', old.status)
  );
  return old;
end;
$$;

revoke all on function private.queue_goal_preview_storage_cleanup() from public, anon, authenticated;

drop trigger if exists queue_goal_preview_storage_cleanup on public.goal_previews;
create trigger queue_goal_preview_storage_cleanup
  before delete on public.goal_previews
  for each row execute function private.queue_goal_preview_storage_cleanup();

-- ---------------------------------------------------------------------------
-- The bucket. Private, JPEG only, no storage policies: only the server-side
-- secret role can put or get these objects, and no signed URL is ever issued.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('goal-previews', 'goal-previews', false, 4000000, array['image/jpeg']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- The daily allowance. Same shape as claim_side_landmark_pass: one row per
-- account, a count and a date, claimed atomically, released only when the
-- provider produced nothing. This table protects a budget and that is all
-- it is allowed to know.
-- ---------------------------------------------------------------------------

create table if not exists public.goal_preview_usage (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  day         date not null default (now() at time zone 'utc')::date,
  renders     integer not null default 0 check (renders >= 0),
  updated_at  timestamptz not null default now()
);

alter table public.goal_preview_usage enable row level security;
revoke all on table public.goal_preview_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.goal_preview_usage to service_role;

drop policy if exists "read own goal preview usage" on public.goal_preview_usage;
create policy "read own goal preview usage"
  on public.goal_preview_usage for select
  to authenticated
  using ((select auth.uid()) = user_id);
grant select on table public.goal_preview_usage to authenticated;

create or replace function public.claim_goal_preview_render(p_user_id uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  ceiling integer := greatest(1, p_limit);
  used integer;
begin
  insert into public.goal_preview_usage (user_id, day, renders, updated_at)
  values (p_user_id, today, 1, now())
  on conflict (user_id) do update
    set renders = case when public.goal_preview_usage.day = today
                       then public.goal_preview_usage.renders + 1
                       else 1 end,
        day = today,
        updated_at = now()
    where public.goal_preview_usage.day <> today
       or public.goal_preview_usage.renders < ceiling
  returning renders into used;

  if used is null then
    return -1;
  end if;
  return greatest(0, ceiling - used);
end;
$$;

create or replace function public.release_goal_preview_render(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  update public.goal_preview_usage
    set renders = greatest(0, renders - 1),
        updated_at = now()
    where user_id = p_user_id
      and day = today
      and renders > 0;
end;
$$;

revoke all on function public.claim_goal_preview_render(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_goal_preview_render(uuid) from public, anon, authenticated;
grant execute on function public.claim_goal_preview_render(uuid, integer) to service_role;
grant execute on function public.release_goal_preview_render(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Revocation. Security invoker, bound to the caller's own row: the browser
-- may ask for its own preview to go, and the route does the storage work
-- from the queue the trigger fills.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_goal_preview(p_preview_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  delete from public.goal_previews
    where id = p_preview_id
      and user_id = (select auth.uid());
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.revoke_goal_preview(uuid) from public, anon;
grant execute on function public.revoke_goal_preview(uuid) to authenticated, service_role;
grant delete on table public.goal_previews to authenticated;
drop policy if exists "delete own goal previews" on public.goal_previews;
create policy "delete own goal previews"
  on public.goal_previews for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Granting and revoking consent go through the route (api/goal-preview-consent.ts),
-- which runs as the service role and can write the pseudonymous trail the
-- browser cannot. The browser keeps read access to its own row so Settings
-- can show the state.

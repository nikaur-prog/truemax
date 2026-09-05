-- Height and weight, server-backed.
--
-- Until now these lived in the browser only (truemax.body). They become a
-- row a person can read and update for themselves, and nobody else can read
-- at all, so a diet or body-composition plan follows them across devices.
-- Canonical centimetres and kilograms, whichever units they typed; the
-- bounds match the calculator's own plausibility bounds so a stored body is
-- always one the calculator would accept. Nothing here ever reaches facial
-- scoring: the engine's scoring modules do not read this table, and a test
-- pins that. See docs/FACIAL_MORPH_PLAN.md section 2 for why the collection
-- was already on the device and only the server side was missing.

create table if not exists public.body_profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  height_cm        numeric(5,1) check (height_cm is null or (height_cm between 120 and 230)),
  weight_kg        numeric(5,1) check (weight_kg is null or (weight_kg between 35 and 300)),
  unit_preference  text not null default 'metric' check (unit_preference in ('metric', 'imperial')),
  source           text not null default 'dialog' check (source in ('signup', 'dialog', 'settings', 'device_migration')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.body_profiles is
  'Self-entered height and weight in canonical cm and kg. Read and written only by the owner and the service. Never an input to facial scoring.';

alter table public.body_profiles enable row level security;

drop policy if exists "own body profile - read" on public.body_profiles;
create policy "own body profile - read"
  on public.body_profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own body profile - insert" on public.body_profiles;
create policy "own body profile - insert"
  on public.body_profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "own body profile - update" on public.body_profiles;
create policy "own body profile - update"
  on public.body_profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.body_profiles from anon;
revoke delete on public.body_profiles from authenticated;
grant select, insert, update on public.body_profiles to authenticated;
grant select, insert, update, delete on public.body_profiles to service_role;

-- updated_at keeps itself.
create or replace function public.touch_body_profile()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_body_profile on public.body_profiles;
create trigger touch_body_profile
  before update on public.body_profiles
  for each row execute function public.touch_body_profile();

-- The optional signup fields. The client sends height_cm and weight_kg in
-- the sign-up metadata when the person filled them in; this copies them
-- into the row at account creation and ignores anything out of bounds, so
-- a skipped or malformed field never blocks a signup. Security definer
-- because the auth schema fires it, with an empty search_path so nothing
-- unqualified can be resolved.
create schema if not exists private;

create or replace function private.body_profile_from_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h numeric;
  w numeric;
begin
  begin
    h := nullif(new.raw_user_meta_data ->> 'height_cm', '')::numeric;
    w := nullif(new.raw_user_meta_data ->> 'weight_kg', '')::numeric;
  exception when others then
    return new;
  end;
  if h is null or w is null then
    return new;
  end if;
  if h < 120 or h > 230 or w < 35 or w > 300 then
    return new;
  end if;
  -- Whatever goes wrong here, the account is still created: the fields
  -- are optional and can be entered again in Settings.
  begin
    insert into public.body_profiles (user_id, height_cm, weight_kg, unit_preference, source)
    values (
      new.id,
      round(h, 1),
      round(w, 1),
      case when new.raw_user_meta_data ->> 'unit_preference' = 'imperial' then 'imperial' else 'metric' end,
      'signup'
    )
    on conflict (user_id) do nothing;
  exception when others then
    return new;
  end;
  return new;
end;
$$;

revoke all on function private.body_profile_from_signup() from public, anon, authenticated;

drop trigger if exists body_profile_from_signup on auth.users;
create trigger body_profile_from_signup
  after insert on auth.users
  for each row execute function private.body_profile_from_signup();

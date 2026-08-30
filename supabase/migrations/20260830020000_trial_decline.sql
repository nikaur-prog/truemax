-- Declining the trial is a consequence, so it has to outlive the device.
--
-- The sheet under "Not now" tells somebody they will not be able to scan
-- themselves again. That sentence needs a fact behind it, and the fact cannot
-- live in localStorage: clearing site data would undo it, which makes the
-- promise decoration.
--
-- One nullable stamp on the profile. Null means "has not declined", and the
-- first decline wins — a second press must not move the date, or the record of
-- when someone chose becomes the record of when they last pressed a button.

alter table public.profiles
  add column if not exists trial_declined_at timestamptz;

-- The client may READ its own stamp (the existing own-profile select policy
-- already covers it) and may never write one directly.
--
-- Row-level security is not enough on its own here: the own-profile UPDATE
-- policy lets an account write any column of its own row, so without this a
-- declined user could clear the stamp from the browser console and the
-- enforcement would be cosmetic. Column privileges are checked per column
-- actually touched, so revoking this one leaves the onboarding upsert — which
-- names its columns explicitly and does not name this one — working unchanged.
revoke update (trial_declined_at) on public.profiles from authenticated;
revoke update (trial_declined_at) on public.profiles from anon;

-- The only way the stamp is ever set.
--
-- security definer so it can write a column the caller cannot, and
-- `where trial_declined_at is null` so it is idempotent: pressing decline
-- twice returns the original date rather than overwriting it.
--
-- search_path is pinned. A security definer function that resolves its own
-- table name through a caller-controlled search_path is the classic way this
-- pattern turns into privilege escalation.
create or replace function public.record_trial_decline()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stamped timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles
     set trial_declined_at = now()
   where user_id = auth.uid()
     and trial_declined_at is null;

  select trial_declined_at into stamped
    from public.profiles
   where user_id = auth.uid();

  return stamped;
end;
$$;

revoke all on function public.record_trial_decline() from public;
grant execute on function public.record_trial_decline() to authenticated;

-- CORRECTIVE, and the reason the revoke above is not enough on its own.
--
-- 20260812040016 ends with `grant select, insert, update on public.profiles to
-- authenticated`, a TABLE-level grant. PostgreSQL does not let a column-level
-- REVOKE subtract from one: a grantee's privilege on a column is the union of
-- the column-level and table-level grants, so revoking the column while the
-- table grant stands changes nothing. The stamp was writable — and therefore
-- CLEARABLE — from the browser, which makes the decline a suggestion.
--
-- So the table-level UPDATE goes, and comes back as a column list. The list is
-- every column the onboarding upsert names, and nothing else. user_id is on it
-- deliberately: supabase-js builds its ON CONFLICT SET from every key it was
-- given, so leaving it out would break profile saves, and granting it is safe
-- because the row policy's WITH CHECK still requires auth.uid() = user_id —
-- a row cannot be reassigned to somebody else.
--
-- created_at is NOT on the list. Nothing writes it and it is not the client's
-- to move.
revoke update on public.profiles from authenticated;
grant update (
  user_id,
  first_name,
  last_name,
  mobile,
  date_of_birth,
  discovery_source,
  primary_objectives,
  success_outcome,
  expectations,
  strengths,
  support_areas,
  quiet_topics,
  consent_version,
  completed_at,
  updated_at
) on public.profiles to authenticated;

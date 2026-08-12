-- Capture the account schema in migration history and repair the permissions
-- from the original dashboard SQL. In particular, the live function inherited
-- an explicit anon EXECUTE grant and the policies targeted PUBLIC rather than
-- the authenticated role.

create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  sex         text not null check (sex in ('male', 'female')),
  overall     numeric not null,
  payload     jsonb not null
);

create index if not exists scans_user_created
  on public.scans (user_id, created_at desc);

alter table public.scans enable row level security;

revoke all on table public.scans from anon;
revoke all on table public.scans from authenticated;
grant select, insert, update, delete on table public.scans to authenticated;

drop policy if exists "own scans - read" on public.scans;
drop policy if exists "own scans - insert" on public.scans;
drop policy if exists "own scans - update" on public.scans;
drop policy if exists "own scans - delete" on public.scans;

create policy "own scans - read"
  on public.scans for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "own scans - insert"
  on public.scans for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "own scans - update"
  on public.scans for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own scans - delete"
  on public.scans for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.delete_own_account()
returns void
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

  delete from auth.users where id = caller_id;
end;
$$;

revoke all on function public.delete_own_account() from public, anon, service_role;
grant execute on function public.delete_own_account() to authenticated;

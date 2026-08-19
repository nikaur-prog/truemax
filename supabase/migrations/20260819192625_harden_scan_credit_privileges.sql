-- Lock scan-credit state to its narrow API surface.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC unless it is revoked.
-- The original consume function granted the authenticated role explicitly but
-- did not remove that inherited PUBLIC grant. Its auth.uid() predicate kept an
-- anonymous call from spending a user's balance, but the endpoint itself still
-- existed for roles that should never be able to invoke it.

revoke all on table public.scan_credits from public, anon, authenticated;
grant select on table public.scan_credits to authenticated;

drop policy if exists "read own scan credits" on public.scan_credits;
create policy "read own scan credits"
  on public.scan_credits
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Only the Stripe webhook's service-role client may grant credits. An empty
-- search path prevents objects in writable schemas from shadowing references
-- inside this SECURITY DEFINER function.
create or replace function public.grant_scan_credit(p_user_id uuid, p_credits integer default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.scan_credits as credits (user_id, balance, updated_at)
  values (p_user_id, greatest(1, p_credits), now())
  on conflict (user_id)
  do update
    set balance = credits.balance + greatest(1, p_credits),
        updated_at = now();
$$;

revoke all on function public.grant_scan_credit(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.grant_scan_credit(uuid, integer)
  to service_role;

-- Signed-in users can only spend their own balance. Resolve the caller once,
-- fail closed when there is no authenticated identity, and keep all object
-- references schema-qualified.
create or replace function public.consume_scan_credit()
returns integer
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

  update public.scan_credits
    set balance = balance - 1,
        updated_at = now()
    where user_id = caller_id and balance > 0
    returning balance into remaining;

  if remaining is null then
    return -1;
  end if;
  return remaining;
end;
$$;

revoke all on function public.consume_scan_credit()
  from public, anon, authenticated, service_role;
grant execute on function public.consume_scan_credit()
  to authenticated;

-- The RPC bypassed the policy that was written to guard the same table.
--
-- 20260830060000 added a membership test to audience_tiers_staff_insert, so a
-- tier could only be granted to somebody with a creator row. 20260830070000
-- then moved the insert inside a SECURITY DEFINER function, which runs as the
-- function owner and therefore does not have row level security applied to it
-- at all. The policy is still there and still correct; it simply is not on the
-- path any more. Every tier now granted through the admin page skips it.
--
-- That is the standing hazard with SECURITY DEFINER and it is worth naming: a
-- policy is not a guarantee about a table, it is a guarantee about statements
-- that RLS is enforced on. Moving a statement into a definer function moves it
-- out from under every policy on every table it touches, so each check those
-- policies were making has to be restated in the body.
--
-- The staff check inside the function was already doing this for
-- league_is_staff(). This is the other half.

create or replace function public.league_review_audience_proof(
  p_proof_id uuid,
  p_accept boolean,
  p_tier text default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_status text;
begin
  -- Staff only, and the refusal says "not found" rather than "forbidden",
  -- which is how every other League surface answers somebody who should not
  -- know the thing exists.
  if not public.league_is_staff() then
    raise exception 'Not found.';
  end if;

  -- Locked for the length of the transaction, so two reviewers pressing at the
  -- same moment cannot both pass the pending test and write two decisions.
  select user_id, status into v_user, v_status
  from public.league_audience_proofs
  where id = p_proof_id
  for update;

  if v_user is null then
    raise exception 'Not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'That proof has already been reviewed.';
  end if;

  if p_accept then
    if p_tier is null or p_tier not in ('unrated', 'basic', 'elite') then
      raise exception 'That is not a tier.';
    end if;
    -- The membership test that audience_tiers_staff_insert makes, restated
    -- here because RLS does not run against this function. Same rule: a
    -- creator row that was not rejected, so a paused creator can still be
    -- rated for the first time and an account that never applied cannot.
    if not exists (
      select 1 from public.league_creators c
      where c.user_id = v_user and c.status <> 'rejected'
    ) then
      raise exception 'That account is not in the programme.';
    end if;
    insert into public.league_audience_tiers (user_id, tier, proof_id, note, decided_by, decided_at)
    values (v_user, p_tier, p_proof_id, p_note, auth.uid(), now())
    on conflict (user_id) do update
      set tier = excluded.tier,
          proof_id = excluded.proof_id,
          note = excluded.note,
          decided_by = excluded.decided_by,
          decided_at = excluded.decided_at;

    update public.league_audience_proofs
      set status = 'accepted', note = p_note, reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_proof_id;
  else
    -- A reason, always. A rejection with no note is what makes a creator
    -- programme feel arbitrary, and the creator reads this back on their own
    -- Offers page. The default is a sentence rather than a blank.
    update public.league_audience_proofs
      set status = 'rejected',
          note = coalesce(nullif(btrim(p_note), ''), 'The recording did not match the numbers submitted.'),
          reviewed_by = auth.uid(),
          reviewed_at = now()
      where id = p_proof_id;
  end if;
end;
$$;

revoke all on function public.league_review_audience_proof(uuid, boolean, text, text) from public, anon;
grant execute on function public.league_review_audience_proof(uuid, boolean, text, text) to authenticated;

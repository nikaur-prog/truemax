-- Placing a tier was two writes from the browser, and only the first one was
-- checked.
--
-- The comment above them said "they have to both land". They did not. The
-- tier upsert reported its error; the proof update that follows it did not,
-- and the rejection path checked nothing at all. A dropped second request left
-- a creator rated with their proof still sitting in the queue as pending --
-- which, now that one pending proof per platform is a unique index, is a state
-- the creator cannot submit their way out of. The reviewer sees a row they
-- have already decided and no sign that anything went wrong.
--
-- Two writes that have to both land are one transaction. This is that
-- transaction, and moving it to the server also takes the reviewer's identity
-- and the decision's timestamp out of the client's hands: both were being
-- posted by the browser, where "who reviewed this" is a field anybody can
-- type into.

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
    -- Upsert rather than insert: a creator re-submitting after growing their
    -- account is the normal case, and their tier moves rather than duplicating.
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

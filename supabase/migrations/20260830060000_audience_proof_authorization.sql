-- The audience-proof insert policy asked the wrong question.
--
-- It checked `auth.uid() = user_id and status = 'pending'`: you may file a
-- proof about yourself, and you may only file it pending. Both are true and
-- neither is the gate. Every other creator-writable table in the League also
-- asks whether the caller is an APPROVED creator --
--
--   create policy submissions_self_insert on public.league_submissions
--     for insert with check (
--       auth.uid() = creator_id and status = 'pending' and public.league_is_approved()
--     )
--
-- -- and this one did not. So any signed-in account, including one that never
-- applied, could write rows into the review queue. The client never offers the
-- form to them (the League router returns the status page for anything but
-- 'approved'), but the client is not the boundary. Nothing leaked: the select
-- policy is still own-row-or-staff, so the hole was writes into a queue, not
-- reads out of one. It is a P1 because a queue anybody can write to is a queue
-- the reviewer stops trusting.
--
-- Three changes, all forward. The table is not dropped and no row is touched.

-- 1. Only an approved creator may file a proof.
drop policy if exists audience_proofs_self_insert on public.league_audience_proofs;
create policy audience_proofs_self_insert on public.league_audience_proofs
  for insert with check (
    auth.uid() = user_id and status = 'pending' and public.league_is_approved()
  );

-- 2. One pending proof per creator per platform.
--
-- Approval alone still leaves the queue floodable by an approved creator with
-- a loop, and the honest submission pattern never needs a second pending row:
-- a creator files, waits, and files again once they have been told why. This
-- says that in the schema rather than in a comment on the form.
--
-- Reviewed rows are outside the index, so a rejected creator can resubmit
-- immediately and the history of what they claimed each time is kept whole.
create unique index if not exists league_audience_proofs_one_pending
  on public.league_audience_proofs (user_id, platform)
  where status = 'pending';

-- 3. A tier may only be granted to somebody who is in the programme.
--
-- Staff-only already, so this is not a hole in the same sense -- it is a
-- misclick guard on a table whose whole job is to decide what somebody gets
-- paid. Rating an account that never applied has no meaning, and the row
-- would sit there being wrong until somebody noticed.
--
-- The test is "has a creator row that was not rejected" rather than "is
-- approved", on purpose. A paused creator is still in the programme, and
-- demanding 'approved' here would make the first rating of a paused account
-- impossible while leaving every existing rating editable -- a rule that
-- depends on the order two unrelated things happened in.
drop policy if exists audience_tiers_staff_insert on public.league_audience_tiers;
create policy audience_tiers_staff_insert on public.league_audience_tiers
  for insert with check (
    public.league_is_staff()
    and exists (
      select 1 from public.league_creators c
      where c.user_id = league_audience_tiers.user_id and c.status <> 'rejected'
    )
  );

-- The update policy is left alone, and deliberately carries no creator test.
-- Somebody rated and later removed from the programme keeps the tier they
-- were rated at until staff change it, and staff must be able to change it --
-- which is exactly what a membership test on the update would prevent.

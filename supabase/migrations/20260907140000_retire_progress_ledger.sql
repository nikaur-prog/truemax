-- Retire the verified-progress ledger.
--
-- It was designed to pay once per goal when the catalogue's completion rule
-- was met by a follow-up read, and it was never awarded: award_progress had
-- no caller in any shipped build. Retiring it rather than wiring it is the
-- owner's decision, on the ground that the product cannot presently perform
-- the verification the ledger's name claims.
--
-- The reason is structural, not a missing feature. public.scans grants
-- insert and update to authenticated and its payload is written by the
-- browser, so the server holds no independently trustworthy reading to check
-- a progress claim against. Awarding from one would mint points from
-- client-supplied numbers and undo the reason points_events is service-only
-- and append-only. src/engine/goalTargets.ts reached the same conclusion in
-- its own words: assessTargetProgress is "a pure evaluator for a future
-- reviewed evidence rule" and "never awards points". That evaluator stays,
-- unused and honest, for whenever the repeatability work makes a real rule
-- possible.
--
-- Consistency is now the only ledger. It pays for what the server can see
-- for itself: a day counted by an action, which needs no measurement to be
-- true.

-- No shipped code ever called award_progress, so a row here would mean
-- somebody wrote one by hand. Say so plainly rather than failing later on a
-- constraint nobody can read.
do $$
declare stray integer;
begin
  select count(*) into stray from public.points_events where ledger <> 'consistency';
  if stray > 0 then
    raise exception
      'points_events holds % row(s) outside the consistency ledger. Nothing in the app ever wrote one, so inspect them before retiring the ledger.', stray;
  end if;
end $$;

drop function if exists public.award_progress(uuid, text, date, integer);

-- Served the once-per-goal rule for progress awards only.
drop index if exists public.points_events_progress_once;

alter table public.points_events
  drop constraint if exists points_events_ledger_check;

alter table public.points_events
  add constraint points_events_ledger_check check (ledger = 'consistency');

comment on table public.points_events is
  'Append-only consistency points. Earned by counted days and multiplied by the streak tier (capped 1.50). The verified-progress ledger was retired in 20260907140000: see that migration for why.';

-- The Creator League pay formula.
--
-- A sprint can now carry a `formula` instead of relying on its tier ladder:
-- continuous pay per thousand views, engagement-adjusted, unlocking at a
-- combined threshold. The shape is src/league/earnings.ts's EarningsFormula
-- (rpmCents, parCommentsPer1k, eMin, eMax, thresholdViews,
-- thresholdComments, videoCapCents, creatorCapCents); missing fields fall
-- back to the client's defaults, junk is ignored.
--
-- NULL means the sprint still pays by its tier ladder — existing sprints keep
-- meaning exactly what they meant. The tiers column stays: it is the record
-- of what old sprints promised, and the fallback for any sprint that wants
-- the ladder back.
--
-- No RLS changes: the column rides on league_sprints' existing policies
-- (world-readable config, staff-only writes). The formula holds no secrets —
-- creators are shown the exact rate they earn under.

alter table public.league_sprints
  add column if not exists formula jsonb;

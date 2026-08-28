-- Phase 2 auto-tracking: the join between a submitted URL and a real video
-- on the creator's LINKED TikTok account.
--
-- The nightly job (/api/league-track) walks every linked account, lists that
-- account's own videos through the Display API, and matches submitted URLs
-- to video ids. A match is proof of ownership — the video demonstrably lives
-- on the account the creator authorised — and it is what makes automatic
-- count snapshots possible. The matched id is stored here so the dashboards
-- can say AUTO-TRACKED without calling TikTok, and so the join is computed
-- once rather than re-derived every night.
--
-- Deliberately NOT auto-approval. Ownership is one of the two things review
-- checks; the other is that the video is actually TrueMax content, and that
-- stays a human call — a creator's unrelated viral video must not be payable
-- just because it is verifiably theirs.

alter table public.league_submissions
  add column if not exists tiktok_video_id text;

-- "Do you think we scored you wrong?" submissions.
--
-- Two numbers per scan and the reference population used, nothing else: no
-- photo, no measurements, no free text. Collection only — nothing reads this
-- table to move a score. It exists for periodic calibration review by hand:
-- if accounts whose measured score sits in one range systematically place
-- themselves elsewhere, that range of the curve gets re-examined against the
-- reference data.
create table if not exists public.self_score_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scan_id uuid not null,
  our_score numeric(4, 2) not null check (our_score >= 1 and our_score <= 10),
  self_score numeric(4, 2) not null check (self_score >= 1 and self_score <= 10),
  sex text not null check (sex in ('male', 'female')),
  consent_version text not null,
  app_commit text,
  created_at timestamptz not null default now(),
  -- One opinion per scan. Retries are acknowledged by the API, not stored.
  unique (user_id, scan_id)
);

comment on table public.self_score_feedback is
  'Self-reported scores for calibration review. Never read by scoring.';

-- Service-role only, same posture as side_landmark_feedback: the API writes
-- through the admin client, and no client may read anyone''s self-assessment.
alter table public.self_score_feedback enable row level security;
revoke all on public.self_score_feedback from anon, authenticated;

create index if not exists self_score_feedback_user_recent
  on public.self_score_feedback (user_id, created_at desc);

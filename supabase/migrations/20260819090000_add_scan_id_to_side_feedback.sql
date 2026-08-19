-- Tie each consented correction to the immutable client scan that produced it.
-- Existing rows predate scan IDs, so their already-immutable submission ID is
-- used as a legacy surrogate before the column becomes required.

alter table public.side_landmark_feedback
  add column if not exists scan_id uuid;

update public.side_landmark_feedback
set scan_id = id
where scan_id is null;

alter table public.side_landmark_feedback
  alter column scan_id set not null;

create index if not exists side_feedback_user_scan_idx
  on public.side_landmark_feedback (user_id, scan_id);

comment on column public.side_landmark_feedback.scan_id is
  'Immutable TrueMax scan ID; legacy rows use their submission ID as a surrogate.';

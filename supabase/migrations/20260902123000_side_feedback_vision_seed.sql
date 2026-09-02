-- Identify feedback produced by the one-request profile placement pass.
-- The version is deliberately stored beside the seed method so calibration
-- can compare like with like after the pass changes.

alter table public.side_landmark_feedback
  add column if not exists seed_version text;

alter table public.side_landmark_feedback
  drop constraint if exists side_feedback_seed_method;

alter table public.side_landmark_feedback
  add constraint side_feedback_seed_method
  check (seed_method in ('mesh', 'silhouette', 'segmentation', 'vision', 'existing'));

alter table public.side_landmark_feedback
  drop constraint if exists side_landmark_feedback_seed_version_check;

alter table public.side_landmark_feedback
  add constraint side_landmark_feedback_seed_version_check
  check (seed_version is null or (length(seed_version) between 1 and 80 and seed_version ~ '^[A-Za-z0-9._-]+$'));

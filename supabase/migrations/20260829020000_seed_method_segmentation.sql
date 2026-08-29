-- The side seeder gained a segmentation-based placement path (the multiclass
-- selfie segmenter's face mask, read as a profile curve). Correction feedback
-- records which path produced the automatic points, so the check constraint
-- has to admit the new method name.
alter table public.side_landmark_feedback
  drop constraint if exists side_feedback_seed_method;
alter table public.side_landmark_feedback
  add constraint side_feedback_seed_method
  check (seed_method in ('mesh', 'silhouette', 'segmentation', 'existing'));

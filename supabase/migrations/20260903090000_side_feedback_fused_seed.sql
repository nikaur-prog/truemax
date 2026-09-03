-- A cloud pass is now a second opinion fused with the on-device placement.
-- Preserve that provenance on consented correction rows rather than calling
-- the final points either source alone.
alter table public.side_correction_feedback
  drop constraint if exists side_feedback_seed_method;

alter table public.side_correction_feedback
  add constraint side_feedback_seed_method
  check (seed_method in ('mesh', 'silhouette', 'segmentation', 'vision', 'fused', 'existing'));

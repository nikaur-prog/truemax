-- Explicitly consented training feedback for the thirteen side-profile
-- landmarks. Browser roles cannot read or write either table or the Storage
-- bucket; all access goes through authenticated Vercel Functions using the
-- server-only Supabase secret key.

create table public.side_landmark_feedback (
  id                uuid primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '90 days'),
  storage_path      text not null unique,
  image_sha256      text not null,
  image_width       integer not null,
  image_height      integer not null,
  face_dir          smallint not null,
  seed_method       text not null,
  automatic_points  jsonb not null,
  corrected_points  jsonb not null,
  moved_point_ids   text[] not null default '{}',
  consent_version   text not null,
  app_commit        text,
  review_status     text not null default 'new',
  reviewed_at       timestamptz,
  review_notes      text,
  constraint side_feedback_expiry_after_creation check (expires_at > created_at),
  constraint side_feedback_storage_path_length check (char_length(storage_path) between 42 and 160),
  constraint side_feedback_sha256_format check (image_sha256 ~ '^[0-9a-f]{64}$'),
  constraint side_feedback_image_width check (image_width between 1 and 1600),
  constraint side_feedback_image_height check (image_height between 1 and 1600),
  constraint side_feedback_face_dir check (face_dir in (-1, 1)),
  constraint side_feedback_seed_method check (seed_method in ('mesh', 'silhouette', 'existing')),
  constraint side_feedback_automatic_object check (jsonb_typeof(automatic_points) = 'object'),
  constraint side_feedback_corrected_object check (jsonb_typeof(corrected_points) = 'object'),
  constraint side_feedback_moved_count check (coalesce(cardinality(moved_point_ids), 0) <= 13),
  constraint side_feedback_consent_version check (consent_version = 'side-landmark-feedback-v1'),
  constraint side_feedback_review_status check (review_status in ('new', 'reviewed', 'incorporated', 'rejected'))
);

comment on table public.side_landmark_feedback is
  'Private, opt-in side-profile photo and automatic/corrected landmark pairs; expires after 90 days.';

alter table public.side_landmark_feedback enable row level security;
revoke all on table public.side_landmark_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.side_landmark_feedback to service_role;

create index side_feedback_expires_idx
  on public.side_landmark_feedback (expires_at);
create index side_feedback_review_queue_idx
  on public.side_landmark_feedback (review_status, created_at)
  where review_status = 'new';
create index side_feedback_user_created_idx
  on public.side_landmark_feedback (user_id, created_at desc);

-- Storage objects are not rows in the application table, so a cascaded account
-- deletion needs a small cleanup queue. The daily Vercel cron removes the
-- private object, then removes the queue row.
create table public.side_feedback_storage_cleanup (
  storage_path text primary key,
  queued_at    timestamptz not null default now()
);

alter table public.side_feedback_storage_cleanup enable row level security;
revoke all on table public.side_feedback_storage_cleanup from public, anon, authenticated;
grant select, insert, delete on table public.side_feedback_storage_cleanup to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.queue_side_feedback_storage_cleanup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.side_feedback_storage_cleanup (storage_path)
  values (old.storage_path)
  on conflict (storage_path) do nothing;
  return old;
end;
$$;

revoke all on function private.queue_side_feedback_storage_cleanup()
  from public, anon, authenticated;

create trigger queue_side_feedback_storage_cleanup
  before delete on public.side_landmark_feedback
  for each row execute function private.queue_side_feedback_storage_cleanup();

-- Private by default, JPEG-only, and capped below the route's multipart limit.
-- There are intentionally no storage.objects policies for this bucket: only
-- the server-side secret role can upload or download these face photos.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'side-correction-feedback',
  'side-correction-feedback',
  false,
  2000000,
  array['image/jpeg']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

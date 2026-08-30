-- Audience tiers: where a creator's views come from, not just how many.
--
-- The pay formula answers "how many people watched" and says nothing about
-- who. A million views from a country the product cannot take a subscription
-- in costs the same as a million from one it can, and the second is worth an
-- order of magnitude more. This adds the missing half.
--
-- TWO TABLES RATHER THAN A COLUMN ON league_creators, and the reason is a
-- policy that already exists:
--
--   create policy creators_self_update on public.league_creators
--     for update using (auth.uid() = user_id and status = 'applied')
--
-- An applied creator can update their own row, and an RLS `with check` is
-- row-level: it does not restrain WHICH columns move. A tier column on that
-- table would therefore be writable by the very person it rates, who could set
-- themselves to the top tier before approval and have it survive. So the tier
-- lives in its own table that no creator may write at all, and the evidence
-- lives in a second one where the creator may only ever insert a pending row.
--
-- Nothing here reads a face, a scan, or an ethnicity. It reads the country
-- breakdown of an ACCOUNT'S VIEWERS, self-reported by the creator from their
-- own platform analytics and checked by a person against a screen recording.
-- The scanner's rule that ethnicity is never inferred from a photograph is
-- untouched and unrelated.

-- The evidence a creator submits for review.
create table if not exists public.league_audience_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  -- A link to a screen recording of the creator's own analytics. A link
  -- rather than an upload: this is reviewed once by a person and then it is
  -- history, so it does not earn a storage bucket and a retention policy.
  proof_url text not null,
  -- What the creator read off that screen. Shares are 0 to 1. Checked here as
  -- well as in the client, because the client is not a security boundary and
  -- a typo reaching a reviewer as a plausible claim is the thing to prevent.
  -- The US is inside Tier 1, so its share can never be the larger of the two.
  tier1_share numeric not null check (tier1_share >= 0 and tier1_share <= 1),
  usa_share numeric not null check (usa_share >= 0 and usa_share <= 1),
  views_28d bigint not null check (views_28d >= 0),
  videos_28d integer not null check (videos_28d >= 0),
  constraint usa_within_tier1 check (usa_share <= tier1_share),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  note text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists league_audience_proofs_pending
  on public.league_audience_proofs (status, submitted_at)
  where status = 'pending';

-- The decision. One row per creator, written only by staff.
create table if not exists public.league_audience_tiers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null default 'unrated'
    check (tier in ('unrated', 'basic', 'elite')),
  -- The proof this decision was made from, so a tier can always be traced
  -- back to the recording somebody actually watched.
  proof_id uuid references public.league_audience_proofs (id) on delete set null,
  note text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now()
);

alter table public.league_audience_proofs enable row level security;
alter table public.league_audience_tiers enable row level security;

-- Proofs: a creator submits their own and may only ever create a PENDING one,
-- so "accepted" is a state only a reviewer can reach. They can read their own
-- back, including the reviewer's note, because being told why is the whole
-- difference between a programme that feels fair and one that feels arbitrary.
create policy audience_proofs_self_insert on public.league_audience_proofs
  for insert with check (auth.uid() = user_id and status = 'pending');
create policy audience_proofs_self_select on public.league_audience_proofs
  for select using (auth.uid() = user_id or public.league_is_staff());
create policy audience_proofs_staff_update on public.league_audience_proofs
  for update using (public.league_is_staff()) with check (public.league_is_staff());
create policy audience_proofs_staff_delete on public.league_audience_proofs
  for delete using (public.league_is_staff());

-- Tiers: read your own, and that is the entire creator surface. No insert and
-- no update policy for a creator exists, which is the point of the table.
create policy audience_tiers_self_select on public.league_audience_tiers
  for select using (auth.uid() = user_id or public.league_is_staff());
create policy audience_tiers_staff_insert on public.league_audience_tiers
  for insert with check (public.league_is_staff());
create policy audience_tiers_staff_update on public.league_audience_tiers
  for update using (public.league_is_staff()) with check (public.league_is_staff());

-- Grants, and the trap in them.
--
-- Staff authenticate as `authenticated` like everybody else: there is no
-- separate staff role. So revoking insert or update on the tiers table from
-- `authenticated` would not lock creators out of it, it would lock the
-- REVIEWER out of it, and the feature would be dead on arrival. What separates
-- staff from creators here is the RLS policy, which is checked per row and
-- calls league_is_staff(); the grant only decides whether the verb is
-- available to the role at all.
--
-- Start from nothing on both tables, then hand back exactly the verbs each
-- table needs, and let RLS decide who may use them.
revoke all on table public.league_audience_tiers from anon, authenticated;
revoke all on table public.league_audience_proofs from anon, authenticated;

-- Tiers: everyone may select (RLS narrows it to your own row), and insert and
-- update exist for the reviewer, gated by the staff policies above. No delete
-- for anyone: a tier decision is history, and it is superseded rather than
-- erased.
grant select, insert, update on public.league_audience_tiers to authenticated;

-- Proofs: a COLUMN grant on insert, which is the one place a column grant does
-- what it looks like it does, because there is no table-level insert grant
-- above it to be unioned with. `status` is deliberately absent, so a creator
-- cannot set it even to the value the policy would allow; the column default
-- supplies 'pending' and the policy then checks it. `note`, `reviewed_by` and
-- `reviewed_at` are absent for the same reason: they are the reviewer's, and a
-- creator writing their own review note is not a thing that should be possible
-- to express.
grant select on public.league_audience_proofs to authenticated;
grant insert (user_id, platform, proof_url, tier1_share, usa_share, views_28d, videos_28d)
  on public.league_audience_proofs to authenticated;
grant update on public.league_audience_proofs to authenticated;

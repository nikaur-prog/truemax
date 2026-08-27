-- The TrueMax Creator League: commission-based creator/clipper program.
--
-- Shape of the thing: a person applies, the owner approves them BY HAND from
-- the staff panel (staff = a row in app_admins, itself granted only in the SQL
-- editor — approval is never self-serve), and an approved creator submits
-- video links against a sprint's budget pool. Counts are recorded as
-- snapshots — manually at review time in phase one, by the TikTok Display API
-- later — and the tier engine turns recorded counts into earnings. Money rows
-- are written only by staff, after money has actually moved.
--
-- Privacy note, deliberate and narrow: the leaderboard exposes an approved
-- creator's display name, handle and earnings TO OTHER APPROVED CREATORS.
-- That is the product (a league has a table), it is stated on the application
-- form, and it is the only place this schema lets one user see anything about
-- another. Nothing here touches scans, photos, conversations or subscriptions.

create table public.league_creators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  display_name text not null,
  niche text,
  links jsonb not null default '[]'::jsonb,
  pitch text,
  status text not null default 'applied'
    check (status in ('applied', 'approved', 'rejected', 'paused')),
  -- Which pillars this creator sees, ticked by the owner at approval. Keys are
  -- pillar ids ("cta", "polisher", "clips"); absent means denied.
  pillar_grants jsonb not null default '{"cta": true, "clips": true}'::jsonb,
  -- Renders per calendar month across the granted pillars. The quota is the
  -- credit-protection: no creator can spend what the owner has not budgeted.
  monthly_render_quota integer not null default 30,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.league_sprints (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- The visible budget pool, in cents. Scarcity is part of the design.
  pool_cents integer not null check (pool_cents >= 0),
  -- [{"views": 100000, "comments": 50, "cents": 25000}, ...] — the commission
  -- ladder for this sprint. Stored per sprint so the ladder can change month
  -- to month without rewriting history.
  tiers jsonb not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'closed'))
);

create table public.league_submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.league_creators (user_id) on delete cascade,
  sprint_id uuid not null references public.league_sprints (id),
  url text not null,
  platform text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  caption text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'earning', 'paid_out')),
  created_at timestamptz not null default now(),
  -- One video counts once, ever.
  unique (creator_id, url)
);

create table public.league_stat_snapshots (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.league_submissions (id) on delete cascade,
  at timestamptz not null default now(),
  views bigint not null default 0 check (views >= 0),
  likes bigint not null default 0 check (likes >= 0),
  comments bigint not null default 0 check (comments >= 0),
  shares bigint not null default 0 check (shares >= 0),
  source text not null default 'manual' check (source in ('manual', 'api'))
);

create table public.league_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.league_creators (user_id),
  amount_cents integer not null check (amount_cents > 0),
  note text,
  status text not null default 'paid' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now()
);

alter table public.league_creators enable row level security;
alter table public.league_sprints enable row level security;
alter table public.league_submissions enable row level security;
alter table public.league_stat_snapshots enable row level security;
alter table public.league_payouts enable row level security;

-- Is the caller staff? Mirrors the existing app_admins convention.
create or replace function public.league_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- Is the caller an approved creator?
create or replace function public.league_is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.league_creators
    where user_id = auth.uid() and status = 'approved'
  );
$$;

-- creators: apply for yourself, read yourself; staff read and write everyone.
-- The application insert pins status to 'applied' — approval only ever comes
-- from a staff update.
create policy creators_self_insert on public.league_creators
  for insert with check (auth.uid() = user_id and status = 'applied');
create policy creators_self_select on public.league_creators
  for select using (auth.uid() = user_id or public.league_is_staff());
create policy creators_self_update on public.league_creators
  for update using (auth.uid() = user_id and status = 'applied')
  with check (auth.uid() = user_id and status = 'applied');
create policy creators_staff_update on public.league_creators
  for update using (public.league_is_staff()) with check (public.league_is_staff());

-- sprints: visible to approved creators and staff; written by staff only.
create policy sprints_read on public.league_sprints
  for select using (public.league_is_approved() or public.league_is_staff());
create policy sprints_staff_write on public.league_sprints
  for all using (public.league_is_staff()) with check (public.league_is_staff());

-- submissions: an approved creator files their own against an active sprint
-- and reads their own; staff read and write all (review, status moves).
create policy submissions_self_insert on public.league_submissions
  for insert with check (
    auth.uid() = creator_id and status = 'pending' and public.league_is_approved()
  );
create policy submissions_read on public.league_submissions
  for select using (auth.uid() = creator_id or public.league_is_staff());
create policy submissions_staff_write on public.league_submissions
  for update using (public.league_is_staff()) with check (public.league_is_staff());

-- snapshots: recorded by staff (phase one) or the API job (service role, which
-- bypasses RLS); a creator reads the snapshots of their own submissions.
create policy snapshots_read on public.league_stat_snapshots
  for select using (
    public.league_is_staff() or exists (
      select 1 from public.league_submissions s
      where s.id = submission_id and s.creator_id = auth.uid()
    )
  );
create policy snapshots_staff_write on public.league_stat_snapshots
  for insert with check (public.league_is_staff());

-- payouts: written by staff after money moved; read by their owner and staff.
create policy payouts_read on public.league_payouts
  for select using (auth.uid() = creator_id or public.league_is_staff());
create policy payouts_staff_write on public.league_payouts
  for all using (public.league_is_staff()) with check (public.league_is_staff());

-- The leaderboard: name, handle and paid-out totals, visible to the league.
-- An RPC rather than a view, so membership is checked at the door: only an
-- approved creator or staff can call it, and what it returns is the ENTIRE
-- cross-user surface of this schema — display name, handle, earned total,
-- nothing else. Stated on the application form.
create or replace function public.league_leaderboard()
returns table (user_id uuid, display_name text, handle text, earned_cents bigint)
language sql stable security definer set search_path = public as $$
  select c.user_id, c.display_name, c.handle,
         coalesce(sum(p.amount_cents), 0)::bigint as earned_cents
  from public.league_creators c
  left join public.league_payouts p on p.creator_id = c.user_id and p.status = 'paid'
  where c.status = 'approved'
    and (public.league_is_approved() or public.league_is_staff())
  group by c.user_id, c.display_name, c.handle
  order by earned_cents desc;
$$;

revoke all on function public.league_leaderboard() from anon;
grant execute on function public.league_leaderboard() to authenticated;

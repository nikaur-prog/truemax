# Accounts (Supabase) — setup

Accounts are **off by default**. The code ships dark: with no keys set, there is
no account button, no network call, and the app is byte-for-byte the on-device
product it was before. Everything below is what turns it on. You can do it once,
paste two keys, and redeploy — no code changes.

You already have a Supabase account, so this reuses it.

---

## 1. Create a project (2 min)

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name it `truemax`. Pick a region close to your users (US East or EU are safe).
3. Save the database password somewhere — you won't need it for the app, but
   you'll want it to log into the DB later.

## 2. Turn on email auth

1. **Authentication → Providers → Email**: make sure it's enabled.
2. **Authentication → Providers → Email → "Confirm email"**:
   - Leave **on** if you want people to click a link before their account is
     real (recommended — stops junk signups).
   - The app handles both cases: with confirm on, signup shows "check your
     email"; with it off, they're signed in immediately.
3. Magic-link sign-in ("email me a link") uses this same email provider, so
   nothing extra to enable.
4. **Authentication → URL Configuration → Site URL**: set to your live URL
   (`https://truemax.app`). This is where the email links send people back.
   Add `http://localhost:5173` under **Redirect URLs** so links work in dev too.

## 3. Run the SQL

Open **SQL Editor → New query**, paste all of this, and run it. It creates the
scans table, locks each row to its owner, and installs the delete-account
function the app calls (Apple requires in-app account deletion).

```sql
-- One row per saved scan. Only the numbers are stored — never a photo.
create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  sex         text not null check (sex in ('male','female')),
  overall     numeric not null,
  -- The full report as the app stores it in localStorage, so sync is a
  -- straight round-trip. jsonb, not columns, because the report shape is the
  -- app's to evolve.
  payload     jsonb not null
);

alter table public.scans enable row level security;

-- A signed-in user sees and writes only their own rows. auth.uid() is the
-- caller's id; there is no way to read another account's scans.
create policy "own scans - read"   on public.scans for select using (auth.uid() = user_id);
create policy "own scans - insert" on public.scans for insert with check (auth.uid() = user_id);
create policy "own scans - update" on public.scans for update using (auth.uid() = user_id);
create policy "own scans - delete" on public.scans for delete using (auth.uid() = user_id);

create index if not exists scans_user_created on public.scans (user_id, created_at desc);

-- App Store guideline 5.1.1(v): an account made in the app must be deletable in
-- the app. The client cannot delete an auth user directly, so it calls this.
-- security definer lets it run with the privilege to remove the row from
-- auth.users; it can only ever delete the caller's own account.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
```

## 4. Get the two keys

**Project Settings → API**:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public** key → `VITE_SUPABASE_ANON_KEY`

The anon key is safe to ship in a web app — that's its job. Row-level security
(step 3) is what actually protects the data, not the key. **Never** put the
`service_role` key in the app; it bypasses RLS.

## 5. Set the keys

**Local dev** — create `.env.local` in the project root (it's gitignored):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

**Vercel** — Project → Settings → Environment Variables, add the same two names
and values, then redeploy. The account button appears on the next deploy.

## 6. Check it

- No keys → no account button. That's the safe default; a broken key won't take
  the app down, it just stays dark.
- Keys set → **Sign in** appears top-right. Create an account, and after the
  email step (if confirm is on) the header shows your initial in a disc.
- **Delete my account** under the account panel removes the row from
  `auth.users`; confirm it's gone in **Authentication → Users**.

---

## What this does and does not do yet

**Does:** identity (sign up / in / magic link / sign out / delete), the table
and security for syncing scans, and the deletion path Apple requires.

**Not yet wired:** pushing local scans up and pulling them down. That's the next
step — `history.ts` already keeps the scan log locally, so sync is: on sign-in,
upload any local scans the account doesn't have and merge the account's scans
back into local. Left out here on purpose so identity can ship and be tested
first. When you want it, that's a focused follow-up.

**Subscriptions** (the $6.99 / $11.99 tiers) hang off this identity but are a
separate piece — RevenueCat for the app, Stripe for the web. An account is the
prerequisite, which is why it comes first.

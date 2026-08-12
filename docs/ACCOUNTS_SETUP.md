# Accounts and social login (Supabase)

The production app is connected to Supabase project `ruvgkrlfmixfnmnzqgap`.
Email/password, magic-link, Google and Apple UI are implemented in both the
post-scan modal and the dedicated `/auth` portal. The app always returns normal
auth flows to `/`, the scan screen; password recovery alone lands on
`/auth?mode=reset` long enough to accept a new password.

Face photographs remain on the device by default. A reduced copy of a completed
scan is usable locally for 30 minutes only when an email or OAuth redirect is
needed, then deleted after analysis resumes or on the first app open after it
expires. The sole upload exception is a side photo that the person separately
chooses to share with its automatic and corrected landmark positions; see
[`SIDE_CORRECTION_FEEDBACK.md`](SIDE_CORRECTION_FEEDBACK.md).

## Current verified state (12 August 2026)

- The project URL and publishable key are connected in production.
- Email signup is enabled and email confirmation is required.
- The `scans` table exists with RLS, but scan sync is not wired yet.
- Google is enabled in the live Supabase project. Apple is still disabled; its
  button activates automatically after Apple credentials are configured.
- The live account schema was created manually, so the repository now captures
  and hardens it in `supabase/migrations/20260812004415_harden_accounts.sql`.

## 1. Apply the account migration

Apply:

```text
supabase/migrations/20260812004415_harden_accounts.sql
```

It creates the table if needed, scopes every policy to `authenticated`, uses
the cached `(select auth.uid())` RLS form, adds the required update `WITH CHECK`,
and removes anonymous access to `delete_own_account()`.

Afterward, run the Supabase security and performance advisors. The deletion
function is intentionally `SECURITY DEFINER` because a browser user cannot
delete its own row in `auth.users`; it checks `auth.uid()` internally and only
the `authenticated` role receives execute permission.

## 2. Set auth URLs

In **Authentication → URL Configuration**:

- Site URL: `https://www.truemax.app/`
- Exact production redirects:
  - `https://www.truemax.app/`
  - `https://www.truemax.app/auth`
- Local development: `http://localhost:5173/**`
- Add a narrowly scoped Vercel preview wildcard only while testing previews.

The `www` host is canonical in production. Do not leave the Site URL at
`localhost`, because confirmation and reset emails will send customers there.

## 3. Configure email

Keep **Authentication → Providers → Email** enabled. Confirmation is currently
on, which is the safer launch setting and is supported by the post-scan flow.

Before a public launch, configure custom SMTP. Supabase's default sender is for
testing and has restrictive limits; it is not a dependable customer email
channel. New Free-plan projects also cannot customize the default sender's
templates, so SMTP is required for the branded set.

Production-ready HTML bodies and their exact subjects are in
[`supabase/email-templates/`](../supabase/email-templates/README.md). They use
inline styles for broad email-client compatibility, show no raw URLs, and put
Supabase's single-use `{{ .ConfirmationURL }}` behind a clean action button.
The signup confirmation is deliberately titled **Welcome to TrueMax**, so the
welcome and account-confirmation steps are one email instead of two.

Install and test at least these three templates on a real phone:

1. Confirm signup
2. Magic link
3. Reset password

Disable click/open tracking in the SMTP provider because rewritten links can
break single-use Supabase auth URLs. The password reset names `{{ .Email }}` and
clearly says that an unrequested message can be ignored without changing the
password. A public “find my email” lookup is intentionally absent because it
would reveal whether an address has a TrueMax account.

The complete copy-paste Resend SMTP values, template map, Google console fields
and Apple Developer fields are in
[`SUPABASE_AUTH_PROVIDER_SETUP.md`](SUPABASE_AUTH_PROVIDER_SETUP.md).

## 4. Enable Google

1. Create a Web OAuth client in Google Auth Platform.
2. Set the authorised callback URI to:

   ```text
   https://ruvgkrlfmixfnmnzqgap.supabase.co/auth/v1/callback
   ```

3. Configure the consent-screen branding and the minimum `openid`, email and
   profile scopes.
4. Paste the client ID and secret into **Supabase → Authentication → Providers
   → Google**, then enable the provider.
5. Verify `/auth/v1/settings` reports `external.google: true`, then complete a
   real signup from `https://www.truemax.app/auth`.

## 5. Enable Apple

Apple web login does not require a published App Store build. It does require an
active Apple Developer Program membership. Create an explicit App ID, enable
Sign in with Apple, create an associated Services ID, register the same
Supabase callback URL above, create a Sign in with Apple `.p8` key, and generate
the client-secret JWT. Enter the Services ID first under Client IDs and the
generated secret in **Supabase → Authentication → Providers → Apple**.

Apple client secrets expire, so record an owner and renewal date. Test Apple's
private-email relay as well as an ordinary address.

## 6. Environment and CSP

The browser uses only a Supabase publishable key. Never expose a secret or
`service_role` key in client code. Vercel currently has the public variables in
Preview and Production:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The opt-in side-correction route additionally needs server-only
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `CRON_SECRET`. These must never use a
`VITE_` prefix; the exact setup is in `SIDE_CORRECTION_FEEDBACK.md`.

`vercel.json` allows connections only to this exact Supabase project over HTTPS
and WSS. Do not replace that allowlist with a wildcard.

## 7. Verification checklist

- `/` opens the scan page whether signed in or out.
- `/auth` supports create account and sign in.
- A completed scan prompts for signup before analysis.
- Email confirmation returns to `/` and resumes the saved scan.
- Google and Apple each return to `/` and resume the saved scan.
- Forgot password sends an email; its link opens the new-password form; success
  returns to `/`.
- Sign out works.
- Delete account removes only the caller and anonymous RPC access is denied.
- No face image appears in Supabase tables or network requests.

## Still separate work

The database table exists, but local scan history is not yet uploaded or merged
across devices. The UI now says this plainly. Scan sync remains its own focused
PR after identity and payments are smoke-tested.

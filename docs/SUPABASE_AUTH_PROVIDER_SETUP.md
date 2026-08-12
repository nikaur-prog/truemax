# TrueMax Supabase email and social-provider setup

This is the copy-paste dashboard guide for Supabase project
`ruvgkrlfmixfnmnzqgap`. Never paste SMTP, Google, Apple or Supabase secrets into
source control or a chat message.

## 1. Custom SMTP with Resend

Resend is the simplest production SMTP option for this project. First add and
verify an authentication-only sending domain such as `auth.truemax.app` in
Resend and publish the DNS records it supplies. Then create a sending API key.

In **Supabase → Authentication → Emails → SMTP Settings**, enable custom SMTP
and enter:

```text
Sender email: account@auth.truemax.app
Sender name: TrueMax
Host: smtp.resend.com
Port: 465
Username: resend
Password: <the Resend API key beginning re_...>
```

Port 465 uses implicit TLS. Port 587 with STARTTLS is also supported if the
network blocks 465. Disable Resend click/open tracking for authentication
messages because URL rewriting can break single-use Supabase links.

Supabase starts custom SMTP at a conservative rate limit. In **Authentication
→ Rate Limits**, raise it only after real delivery tests, SPF/DKIM/DMARC checks
and CAPTCHA are in place.

## 2. Install the exact email templates

In **Supabase → Authentication → Emails → Templates**, paste the matching
subject and complete HTML body from each file:

| Supabase screen | Subject | HTML file |
| --- | --- | --- |
| Confirm signup | `Welcome to TrueMax — confirm your email` | `supabase/email-templates/confirm-signup.html` |
| Magic link | `Your secure TrueMax sign-in link` | `supabase/email-templates/magic-link.html` |
| Reset password | `Reset your TrueMax password` | `supabase/email-templates/reset-password.html` |
| Invite user | `You’re invited to TrueMax` | `supabase/email-templates/invite-user.html` |
| Change email address | `Confirm your new TrueMax email` | `supabase/email-templates/change-email.html` |
| Reauthentication | `Your TrueMax verification code` | `supabase/email-templates/reauthentication.html` |

The reset email already says which email address received the request, asks
whether the recipient requested it, and says to ignore it otherwise. There is
no public “find my account email” endpoint: such a lookup would expose whether
someone has a TrueMax account. Support can help a person who no longer knows
which address they used after verifying ownership through a private process.

## 3. Auth URL configuration

In **Authentication → URL Configuration**:

```text
Site URL: https://www.truemax.app/
Redirect URL: https://www.truemax.app/
Redirect URL: https://www.truemax.app/auth
Redirect URL: http://localhost:5173/**
```

Add a narrowly scoped Vercel preview wildcard only during preview testing.

## 4. Enable Google sign-in

In Google Cloud / Google Auth Platform:

1. Create or select the TrueMax project.
2. Configure Branding and Audience. Request only `openid`, `userinfo.email` and
   `userinfo.profile`.
3. Create an OAuth client of type **Web application**.
4. Add authorised JavaScript origin `https://www.truemax.app`.
5. Add this exact authorised redirect URI:

   ```text
   https://ruvgkrlfmixfnmnzqgap.supabase.co/auth/v1/callback
   ```

6. Copy the client ID and client secret into **Supabase → Authentication →
   Providers → Google**, then enable and save the provider.

Do not put the Google client secret in Vite or browser code.

## 5. Enable Apple sign-in

This requires an active Apple Developer Program membership. In Certificates,
Identifiers & Profiles:

1. Create the final TrueMax App ID/bundle ID and enable **Sign in with Apple**.
2. Create a Services ID for the web login and configure Sign in with Apple.
3. Use domain `ruvgkrlfmixfnmnzqgap.supabase.co` and return URL:

   ```text
   https://ruvgkrlfmixfnmnzqgap.supabase.co/auth/v1/callback
   ```

4. Create a Sign in with Apple key and download the `.p8` file once. Store it
   in a password manager or secrets vault.
5. Use Supabase's Apple secret generator with the Team ID, Key ID, Services ID
   and private key.
6. In **Supabase → Authentication → Providers → Apple**, put the Services ID
   first in Client IDs, paste the generated secret, enable and save.
7. Register TrueMax's sending domain with Apple's private email relay before
   emailing users who choose Hide My Email.

Apple web OAuth client secrets expire every six months. Record the owner and
renewal date when it is created. Apple may not return a person's name in the
web OAuth flow, so TrueMax correctly asks for first and last name in onboarding.

## 6. Real-device verification

- Confirm signup, magic link and reset password in Gmail and Apple Mail.
- Test both narrow mobile and desktop email layouts.
- Complete Google and Apple signup from `https://www.truemax.app/auth`.
- Confirm normal auth redirects return to `/`, while reset opens
  `/auth?mode=reset` and returns to `/` after success.
- Confirm `/auth/v1/settings` reports Google and Apple enabled.
- Verify no raw action URL is visible in the email body and the clean buttons
  remain clickable.

Official references:

- <https://supabase.com/docs/guides/auth/auth-smtp>
- <https://supabase.com/docs/guides/auth/auth-email-templates>
- <https://supabase.com/docs/guides/auth/social-login/auth-google>
- <https://supabase.com/docs/guides/auth/social-login/auth-apple>
- <https://resend.com/docs/send-with-smtp>

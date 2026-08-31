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

## 4. Replace the project ID on OAuth screens

Google currently shows `ruvgkrlfmixfnmnzqgap.supabase.co` because that is the
host receiving the OAuth callback. Frontend button copy cannot change it. The
production fix is the Supabase custom domain `auth.truemax.app` plus a verified
Google OAuth brand. Supabase custom domains are a paid add-on, so confirm the
add-on in the project billing screen before starting.

Use this cutover order so sign-in never goes offline:

1. In **Supabase -> Project Settings -> General -> Custom Domains**, begin the
   setup for `auth.truemax.app`. Do not activate it yet.
2. In DNS, add the CNAME from `auth.truemax.app` to
   `ruvgkrlfmixfnmnzqgap.supabase.co` and the `_acme-challenge` TXT record that
   Supabase supplies. Wait for Supabase to verify the records and issue TLS.
3. In the existing Google OAuth web client, keep the old callback and add:

   ```text
   https://auth.truemax.app/auth/v1/callback
   ```

4. In **Google Auth Platform -> Branding**, set the app name to `TrueMax`, add
   the TrueMax logo, use `https://www.truemax.app/` as the home page, and use
   the live TrueMax privacy and terms pages. Add `truemax.app` as an authorised
   domain and submit brand verification if Google offers it.
5. If Apple sign-in has been configured, add `auth.truemax.app` and
   `https://auth.truemax.app/auth/v1/callback` to the Services ID before the
   Supabase domain is activated.
6. Activate the custom domain in Supabase. The original project URL remains
   available during the cutover.
7. Set `VITE_SUPABASE_URL=https://auth.truemax.app` in a Vercel Preview and
   complete Google signup, sign-in, sign-out and password recovery. Promote the
   same value to Production only after those checks pass. The repository CSP
   already permits both the old and branded hosts during this migration.
8. Keep the old Google callback until production and the rollback path have
   both been tested. It can be removed in a later maintenance window.

## 5. Enable Google sign-in

In Google Cloud / Google Auth Platform:

1. Create or select the TrueMax project.
2. Configure Branding and Audience. Request only `openid`, `userinfo.email` and
   `userinfo.profile`.
3. Create an OAuth client of type **Web application**.
   The current screen is available directly at
   <https://console.cloud.google.com/auth/clients/create>.
4. Add authorised JavaScript origins (origins have no path or trailing slash):

   ```text
   https://www.truemax.app
   http://localhost:5173
   ```

   Remove the localhost origin after local OAuth testing if you do not need it.
5. Keep the project callback during the branded-domain cutover and add both
   authorised redirect URIs:

   ```text
   https://ruvgkrlfmixfnmnzqgap.supabase.co/auth/v1/callback
   https://auth.truemax.app/auth/v1/callback
   ```

6. Copy the client ID and client secret into **Supabase → Authentication →
   Providers → Google**, then enable and save the provider.

The JavaScript origin is the TrueMax website; the redirect URI is Supabase's
callback. Do not swap them. Supabase then sends the completed session back to
the Site URL/redirect allowlist in Authentication → URL Configuration.

Do not put the Google client secret in Vite or browser code.

## 6. Enable Apple sign-in

TrueMax does **not** need to be published in the App Store first. Web OAuth works
for the existing website. It does require an active Apple Developer Program
membership so you can create the identifiers and signing key below.

In **Apple Developer → Certificates, Identifiers & Profiles**:

1. Under **Identifiers → App IDs**, create an explicit TrueMax App ID such as
   `com.truemax.app`, enable **Sign in with Apple**, and leave the
   Server-to-Server notification endpoint blank. The identifier can later be
   reused by the native iOS app; creating it does not publish an app.
2. Under **Identifiers → Services IDs**, create the web client, for example
   `com.truemax.app.web`. Open it, enable **Sign in with Apple**, choose the
   TrueMax App ID as its primary App ID, then choose **Configure**.
3. After the branded Auth domain is active, use domain `auth.truemax.app` and
   return URL:

   ```text
   https://auth.truemax.app/auth/v1/callback
   ```

4. Under **Keys**, create a Sign in with Apple key associated with the TrueMax
   App ID. Download the `.p8` file once and store it in a password manager or
   secrets vault. Do not put it in this repository, Vite or chat.
5. Record the 10-character Team ID and the Key ID. In Chrome or Firefox, use
   Supabase's Apple client-secret generator with the Team ID, Key ID, Services
   ID and `.p8` key. The generator runs locally in the browser and currently
   does not work in Safari.
6. In **Supabase → Authentication → Providers → Apple**, put the Services ID
   (for example `com.truemax.app.web`) first in **Client IDs**, paste the
   generated JWT in **Secret Key**, enable and save.
7. Register TrueMax's sending domain with Apple's private email relay before
   emailing users who choose Hide My Email.

Apple web OAuth client secrets expire every six months. Record the owner and
renewal date when it is created. Apple may not return a person's name in the
web OAuth flow, so TrueMax correctly asks for first and last name in onboarding.
When a native iOS build is added later, use native Sign in with Apple there;
that is a later App Store task and does not block web sign-in now.

## 7. Real-device verification

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

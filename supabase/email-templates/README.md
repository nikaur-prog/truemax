# TrueMax auth emails

These are production-ready HTML bodies for **Supabase Auth → Email Templates**.
They use only inline styles, include no remote images or fonts, and never expose a
raw URL in the visible copy. The action is still a real secure link behind the
button, using Supabase's `{{ .ConfirmationURL }}` variable.

## Templates and subjects

| Supabase template | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | `Welcome to TrueMax — confirm your email` |
| Magic link | `magic-link.html` | `Your secure TrueMax sign-in link` |
| Reset password | `reset-password.html` | `Reset your TrueMax password` |
| Invite user | `invite-user.html` | `You’re invited to TrueMax` |
| Change email address | `change-email.html` | `Confirm your new TrueMax email` |
| Reauthentication | `reauthentication.html` | `Your TrueMax verification code` |

The confirm-signup message is intentionally the welcome email. It welcomes the
person and asks them to confirm the address in one clean message, avoiding a
second transactional email before the account is active.

## Preview locally

Run `npm run dev`, then open one of these unlisted development-only URLs:

- `http://localhost:5173/tools/email-preview.html?template=confirm-signup`
- `http://localhost:5173/tools/email-preview.html?template=reset-password`
- Replace the final value with any filename from the table above, without
  `.html`.

The preview tool inserts sample addresses and is not included in the Vite
production build.

## Install

1. Follow the exact Resend and provider setup in
   [`docs/SUPABASE_AUTH_PROVIDER_SETUP.md`](../../docs/SUPABASE_AUTH_PROVIDER_SETUP.md).
   Supabase's default sender is only suitable for testing and new Free-plan
   projects cannot customize its templates.
2. Open **Authentication → Emails → Templates**.
3. Select each template, paste the matching subject and complete HTML file, and
   save.
4. Disable click/open tracking in the SMTP provider. Link rewriting can break
   Supabase's single-use auth links.
5. Send real signup, magic-link and password-reset emails to an iPhone and an
   Android device before launch.

The password-reset email states which address received the request. A separate
“forgot my email” lookup is deliberately not provided because revealing whether
an address has an account creates an account-enumeration privacy risk.

Official reference: <https://supabase.com/docs/guides/auth/auth-email-templates>

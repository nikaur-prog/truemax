# Launch checklist

Ordered by what blocks what. Everything in **Stage 1** is required for the site
to exist at `truemax.app`. Stage 2 is required before it can take money. Stage 3
is required before an app store will accept it. Nothing below Stage 1 blocks
posting to TikTok.

Status markers: `[ ]` not done · `[x]` done · `[~]` code done, needs configuring.

---

## Stage 1 — get it live (blocks everything)

### 1.1 DNS

- [ ] Cloudflare → DNS → Records. Two records, **both with the orange cloud OFF
      (“DNS only”)**:

  | Type | Name | Target |
  |---|---|---|
  | CNAME | `@` | the target Vercel shows for the apex |
  | CNAME | `www` | the same target |

  Copy the target string from Vercel’s Domains page rather than from anywhere
  else — it is a per-project hash and a single wrong character reads as
  “Invalid Configuration”.

- [ ] Delete any other `A`, `AAAA` or `CNAME` record on `@` or `www`. A leftover
      `A @ 76.76.21.21` from an older setup will fight the CNAME.
- [ ] Cloudflare → SSL/TLS → **Full (strict)**. “Flexible” produces an infinite
      redirect loop against Vercel.
- [ ] Vercel → Domains → **Refresh**. Propagation is usually a minute or two.

**Why the proxy must be off:** proxied records answer DNS lookups with
Cloudflare’s own IPs, so Vercel’s verification never sees its target and marks
the domain invalid. With it off, Cloudflare is purely DNS and Vercel handles CDN
and TLS itself — which is what you want; you are not losing anything.

### 1.2 Deployment protection

- [x] Vercel → Settings → Deployment Protection → **Vercel Authentication**.
      Set to *Only Preview Deployments*, or off. If it is on for Production, the
      site returns 401 to the public while working perfectly for you, logged in.
      This one wastes a lot of people’s afternoon.

### 1.3 Production build

- [x] Production Branch is `main`, and `main` carries the current code.
- [x] Vercel → Deployments shows a **Production** (not Preview) deployment on the
      latest `main` commit, status Ready.

### 1.4 Smoke test on the real domain

- [ ] `/` loads, engine reaches “ready”, camera permission prompt appears.
- [ ] Front scan → side scan → results, on a phone, on cellular.
- [ ] `/quick` loads (the filming page).
- [ ] View source of the response headers: CSP present, and `X-Robots-Tag:
      noindex` on `/quick` and `/calib` only.

---

## Stage 2 — make it earn

### 2.1 Accounts (Supabase)

Code is written and ships dark. See `docs/ACCOUNTS_SETUP.md` for the full
walkthrough including the SQL.

- [x] Create the Supabase project.
- [x] Authentication → Providers → Email: enabled; confirmation is required.
- [~] Authentication → URL Configuration → **Site URL** = `https://truemax.app`,
      with `http://localhost:5173` added under Redirect URLs.
- [x] Apply the account migration from `ACCOUNTS_SETUP.md` (scans table,
      hardened RLS policies, `delete_own_account`).
- [x] Vercel → Environment Variables: `VITE_SUPABASE_URL` and
      `VITE_SUPABASE_ANON_KEY`. Redeploy.
- [~] Signup/login modal, `/auth` portal, forgot/reset password, and post-scan
      account gate are built. Merge and deploy the auth PR.
- [x] Enable Google. The live Auth settings report it enabled.
- [ ] Enable Apple. A published iOS app is not required for web login, but an
      Apple Developer membership, App ID, Services ID and signing key are; see
      `SUPABASE_AUTH_PROVIDER_SETUP.md`.
- [ ] Verify: “Sign in” appears top-right; create an account; delete it; confirm
      it is gone from Authentication → Users.
- [~] Side-landmark review, manual correction and separate opt-in feedback are
      built; the private Supabase table/bucket are live. Add the three
      server-only Vercel variables and complete the consent/cleanup acceptance
      tests in `SIDE_CORRECTION_FEEDBACK.md` before deploying the upload route.

**Anon key only.** The `service_role` key bypasses row-level security and must
never reach the browser. It belongs in server-side environment variables and
nowhere else.

Note what this does *not* do yet: local scans are not synced up or down. Identity
ships first so it can be tested on its own; sync is a focused follow-up against
`history.ts`.

### 2.2 Payments — code built, configuration required

The Stripe Checkout, customer portal, signed webhook and Supabase entitlement
code are written. See `docs/PAYMENTS_SETUP.md` for the required Stripe, Supabase
and Vercel configuration.

- [x] Decide the surface: Stripe for web. (RevenueCat only becomes relevant at
      the app-store stage.)
- [x] Audit the connected Stripe account. It currently contains no products,
      prices or webhook endpoints.
- [x] Confirm the USD catalog: Starter $6.99/month, Max $11.99/month, member
      scan $2.99 and non-member scan $5.99. **Trial is 7 days** — this was
      recorded as an unresolved 7-vs-30 conflict, but nothing actually
      implements 30: `api/create-checkout-session.ts` sets
      `trial_period_days: 7`, the onboarding buttons say "Start 7-day free
      trial", and `PRICING_DECISION.md` says 7. Only this line disagreed.
- [~] Hosted Checkout and customer portal Vercel Functions exist as a secure
      single-Max skeleton. Extend them for Starter, scan credits, trial
      eligibility and age enforcement before adding live keys.
- [~] **Knowing who paid** — the entitlement migration is applied to live
      Supabase. The webhook destination and server-only Vercel variables remain.
- [x] Read the entitlement in the account UI and expose a reusable
      `hasMaxAccess()` gate for Stage 2.3.
- [x] No Stripe JS runs in the page: the browser calls only same-origin `/api`
      routes and navigates to Stripe's hosted URL, so CSP `connect-src 'self'`
      does not need weakening.

### 2.3 Tier enforcement

- [ ] Free: first analysis per verified account; exact ongoing feature access
      still needs to be written.
- [ ] Starter: exact features still need to be written; this is the only paid
      plan available to under-18 users.
- [ ] Max: Max AI plus the still-to-be-written premium feature set.
- [ ] No result or plan components enforce this three-tier split yet.

---

## Stage 3 — legal and trust

### 3.1 Privacy policy — written

- [x] `privacy.html`, served at `/privacy`. Static, no script, indexable, and
      readable by someone who has accepted nothing — which is what an app-store
      reviewer following a bare URL is.
- [ ] Create the `privacy@truemax.app` and `support@truemax.app` inboxes. Both
      documents name them, and a policy that names an address nobody reads is
      worse than one that names none.

The honest version is still strong but must name the exception precisely:
images are processed on the device by default. A side-profile photo leaves the
browser only after a separate, optional consent to send the automatic and
corrected landmark positions to TrueMax for product improvement. State the
purpose, private Supabase processing, 90-day maximum retention and deletion
path. The front photo is not included.

### 3.2 Terms — written

- [x] `terms.html`, served at `/terms`. Covers the score's meaning and limits,
      eligibility, billing and the 7-day trial, cancellation, acceptable use,
      liability and governing law.
- [x] The score's limits lead the document rather than sitting in a disclaimer
      at the bottom: it measures geometry against a reference sample, and it is
      not a measure of worth, health or attractiveness to any given person. It
      also says plainly that if measuring your face is making you feel worse, a
      doctor is a better next step than another scan. That paragraph is not
      legally required. It is there because it is true, and because a product
      that hands young men a number about their face should say it.
- [ ] Confirm New Zealand as the governing-law jurisdiction, or change it.

### 3.3 Age gate — does not exist

- [ ] Under-18s restricted to one plan, per the product rule already decided.
      Nothing implements this today.

---

## Stage 4 — measurement

### 4.1 Analytics

- [ ] Pick one. There is none today, so the TikTok funnel is invisible.
- [ ] Whatever you pick, add its domain to `connect-src` in `vercel.json` or the
      CSP will block it with no visible error.
- [ ] Minimum useful events: landing → camera opened → front captured → side
      captured → results shown → plan opened.

### 4.2 Known measurement debt

- [x] **Replace the false cheekbone pair and regenerate every dependent norm.**
      The engine now uses MediaPipe 116/345 as an approximate malar-prominence
      pair. It deliberately calls this *malar*, not a clinical skeletal zygion:
      a monocular face mesh cannot locate a bone it cannot see.

  `bizygo` is the denominator of six metrics: `fwhr`, `cheekboneHeight`,
  `jawCheekRatio`, `eyeSeparationRatio`, `fifthsEyeRatio` and `facialIndex`.

  Completed in the analysis-integrity pass: candidate overlays were reviewed
  across ten different faces; 115 celebrity and 153 population photos were
  rescanned; all 31 front distributions, the 108-entry comparison database,
  both shape models and both aggregate quantile tables were regenerated.

  Remaining limit: this is a repeatable mesh proxy, not a direct anthropometric
  bizygomatic-breadth measurement.

---

## Regenerating the norms

Required after any change to how a metric is measured. Must run on a machine that
holds the reference photo set.

```
node tools/fetch-photos.mjs      # populates .calib/ — needs open internet
node tools/scan-celebs.mjs
node tools/apply.mjs
node tools/normalize.mjs         # rewrites src/engine/aggNorm.ts
npm run build
```

`normalize.mjs` reads `.calib/pop-manifest.json` and each photograph on disk, and
drives the real engine through a headless browser so the generated table cannot
drift from the code that consumes it. **No photographs are ever committed** — the
repository holds coordinates and quantiles only.

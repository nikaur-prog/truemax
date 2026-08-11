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

- [ ] Vercel → Settings → Deployment Protection → **Vercel Authentication**.
      Set to *Only Preview Deployments*, or off. If it is on for Production, the
      site returns 401 to the public while working perfectly for you, logged in.
      This one wastes a lot of people’s afternoon.

### 1.3 Production build

- [x] Production Branch is `main`, and `main` carries the current code.
- [ ] Vercel → Deployments shows a **Production** (not Preview) deployment on the
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

- [~] Create the Supabase project.
- [~] Authentication → Providers → Email: enabled.
- [~] Authentication → URL Configuration → **Site URL** = `https://truemax.app`,
      with `http://localhost:5173` added under Redirect URLs.
- [~] Run the SQL from `ACCOUNTS_SETUP.md` (scans table, RLS policies,
      `delete_own_account`).
- [~] Vercel → Environment Variables: `VITE_SUPABASE_URL` and
      `VITE_SUPABASE_ANON_KEY`. Redeploy.
- [ ] Verify: “Sign in” appears top-right; create an account; delete it; confirm
      it is gone from Authentication → Users.

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
- [ ] Products and prices in Stripe.
- [~] Hosted Checkout and customer portal Vercel Functions. Needs Stripe test
      and live keys plus `STRIPE_MAX_PRICE_ID` in Vercel.
- [~] **Knowing who paid** — a signature-verified webhook transaction writes an
      idempotent entitlement to Supabase with the server-only secret key. Needs
      the migration applied and webhook destination configured.
- [x] Read the entitlement in the account UI and expose a reusable
      `hasMaxAccess()` gate for Stage 2.3.
- [x] No Stripe JS runs in the page: the browser calls only same-origin `/api`
      routes and navigates to Stripe's hosted URL, so CSP `connect-src 'self'`
      does not need weakening.

### 2.3 Tier enforcement

- [ ] Free / minimum tier: overview, generalised direction, progress tracking.
- [ ] Max: personalisation, actionable steps, product tracking, follow-up.
- [ ] The split is designed but nothing in the code enforces it yet.

---

## Stage 3 — legal and trust

### 3.1 Privacy policy — does not exist

- [ ] Write and publish one. Required because the app requests camera access,
      and required later by both app stores.

Yours is unusually easy and unusually strong, because the honest version is
short and true: images are processed on the device, nothing is uploaded, and the
only thing that leaves the browser once accounts are on is the numeric report a
signed-in user chooses to sync. Say exactly that.

### 3.2 Terms — does not exist

- [ ] Publish terms covering the obvious: this is not medical advice, scores are
      measurements against a reference sample rather than judgements of worth,
      and no surgical or prescription guidance is given.

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

- [ ] **`ZYGO_R`/`ZYGO_L` are the wrong landmarks.** They are MediaPipe 234/454,
      the widest points of the face oval, which sit at ear and sideburn level —
      not the zygomatic arch. These are the same landmarks that caused the
      side-profile seeding bug.

  `bizygo` is the denominator of six metrics: `fwhr`, `cheekboneHeight`,
  `jawCheekRatio`, `eyeSeparationRatio`, `fifthsEyeRatio` and `facialIndex`.

  **This is a naming and validity problem, not a scoring bug.** Every face is
  measured with the same landmark and scored against norms built from that same
  landmark, so the percentiles are internally consistent and comparable between
  people. What is not safe is any specific claim that a number describes the
  cheekbone.

  Fixing it means re-deriving the affected metrics’ `dist[sex]` constants **and**
  regenerating `AGG_NORM`, which requires the reference photograph set
  (`.calib/`, deliberately gitignored) and a run of
  `fetch-photos → scan → apply → normalize`. It cannot be done from the
  repository alone. See “Regenerating the norms” below.

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

# Shipping TrueMax to the App Store

Everything that can be prepared before and after the Apple Developer membership
($99/yr) is active. Written for this repo specifically, not generically.

## What already exists in this repo

- `capacitor.config.json` — the wrapper config (`app.truemax`, loads `dist/`).
- `resources/` — App Store icon set (1024/512/180/167/152/120) and a 2732
  splash, generated from the Max character by `scripts/make-app-icons.mjs`.
  Regenerate any time Max's drawing changes.
- `src/engine/platform.ts` — `isNativeApp()` and the `.native-app` class. The
  native build **shows no purchase surface at all** (see Money, below): the
  offer screen closes itself, and every checkout button is hidden by CSS.
- Account deletion in-app (guideline 5.1.1(v)) — `api/delete-account.ts`.
- Age gating — under-18 accounts never see Max or the Max plan.
- Apple OAuth already works on the web via Supabase.

## The money question (decide before submission)

Apple requires digital subscriptions bought **inside** an iOS app to use
In-App Purchase (15% cut under $1M/yr with the Small Business Program —
enroll for it). The shipped answer here is the **Spotify model**:

- The app sells nothing and links to nothing. No prices, no checkout, no
  "go to our website" (that phrase is what gets rejected).
- Subscriptions are bought on truemax.app in a browser; the app reads the
  entitlement from the server and unlocks identically.
- Later, if conversion demands it: add StoreKit IAP alongside Stripe, and the
  webhook-equivalent (App Store Server Notifications) writes to the same
  `entitlements` table.

## Steps once the membership is active

1. `npm i @capacitor/core @capacitor/cli @capacitor/ios && npm run build && npx cap add ios && npx cap sync`
2. Open `ios/App` in Xcode. Set the team, bundle id `app.truemax`.
3. `Info.plist` additions:
   - `NSCameraUsageDescription`: "TrueMax uses your camera to measure your
     face on your device. A photo is sent only when you separately choose a
     cloud feature such as side-point placement or Goal preview."
4. Icons/splash: drag `resources/` PNGs into the asset catalog.
5. **Sign in with Apple**: required because Google login is offered.
   - Enable the capability in Xcode.
   - App Store Connect → create a Services ID; configure it in
     Supabase → Auth → Providers → Apple (the web flow already works, the
     native flow needs the Services ID + key).
6. OAuth redirects in the wrapped app: add the custom scheme
   (`app.truemax://`) to Supabase's allowed redirect URLs.

## App Privacy questionnaire (the answers)

The architecture is the story: say it plainly.

- Photos/face data: **processed on device, never collected**. The App Privacy
  label can honestly say no photo or biometric data is collected.
- Data collected: email (account), purchase state (subscriptions), optional
  anonymous funnel counters (`funnel_events` has no identity columns — that is
  "not linked to you").
- Consented side-landmark feedback is the one optional photo upload; it is
  opt-in per photo with explicit consent language. Declare as "user content,
  linked, optional".
- No tracking, no third-party ads, no data sold. "Data Used to Track You:
  none."

## Review notes template

> TrueMax measures facial proportions from two photos, entirely on-device
> (MediaPipe face mesh in the browser runtime; no photo ever leaves the
> phone). The free tier gives a score and ranking; a subscription (purchased
> on our website, not in the app) unlocks the full measurement breakdown and
> the Max AI coach. Demo account: [create reviewer@... and grant it a row in
> `app_admins` — that gives full access with no payment]. Under-18 accounts
> are restricted from the AI coach and weight-related content by server-side
> age checks.

Before submitting: create that reviewer account, run
`insert into app_admins (user_id, note) select id, 'app review' from auth.users where email = '...'`.

## Age rating

Expect 12+ (infrequent mature themes: appearance rating). Answer the
questionnaire honestly around body image; the under-18 restrictions and the
absence of surgery/supplement content are the mitigations worth stating in
the review notes.

## Play Store

The previous version of this section said "one-time $25 fee, same everything".
The fee is right and the rest is not. The IAP rule genuinely is the same — Play
Billing is required for digital goods, and `.native-app` already covers it,
because `Capacitor.isNativePlatform()` is true on both platforms. Everything
below is where Play differs from Apple.

### The thing that decides your calendar

**A personal developer account must run a closed test with at least 12 testers,
opted in and continuously enrolled for 14 days, before it can apply for
production access.** Organisation accounts are exempt. This is not a review
queue you can hurry — it is a fortnight of wall-clock time that starts only once
twelve real people have accepted the invitation, and it is the single most
common reason a Play launch slips.

Two consequences worth deciding now rather than in a fortnight:

- If TrueMax will be published by a company rather than by a person, register
  the account as an organisation. That needs a D-U-N-S number, which itself
  takes days to obtain, but it removes the fourteen-day gate entirely.
- If it stays a personal account, line up twelve testers **before** paying the
  $25, and start the closed test the day the account is verified. The clock is
  the deliverable; the build can improve during it.

Verify both in the Play Console when you get there — Google changes this policy
and the numbers above are what applied as of writing, not a permanent law.

### What this repo is missing

- **A web account-deletion URL.** Play requires a page reachable *without
  installing the app and without signing in*, where somebody can request
  deletion, and it is a required field on the Data Safety form. We have in-app
  deletion (`api/delete-account.ts`) and `/privacy` says "delete your account
  from inside the app", which is not sufficient — it assumes the app. Needs a
  small public route, e.g. `/delete-account`, explaining what is deleted and how
  to request it by email, then linked from `/privacy`.
- **A 1024x500 feature graphic.** Mandatory for a Play listing, and there is no
  equivalent on the App Store, so `resources/` has nothing like it.
- **An adaptive icon.** Android wants a foreground and a background layer rather
  than one square, and draws its own mask over them.
  `scripts/make-app-icons.mjs` currently emits only the Apple sizes plus a flat
  512; it needs an Android target.

### What carries over unchanged

- `/privacy` and `/terms` are already public routes, which satisfies the privacy
  policy URL both stores require.
- The icon artwork, from `resources/icon.svg`.
- Age gating, and the no-purchase-surface native build.

### Data Safety is not the App Privacy questionnaire

Same information, different shape, and two questions Apple does not ask:

- whether data is **encrypted in transit** (yes — HSTS with preload, and the CSP
  in `vercel.json` allows no plaintext origin);
- whether users can **request deletion**, which is where the URL above goes.

Declare the face photograph as collected. It is biometric-adjacent and the
honest answer is the safe one — the scan runs on device, but side-correction
feedback is uploaded when somebody opts in, so "not collected" would be wrong.

### One policy risk that is not about mechanics

A product that rates faces sits near Google's policies on content that can
encourage negative self-image, in the same way it sits near Apple's. The
mitigation is the same in both stores and is mostly already true of the product:
the result is framed as a measurement rather than a verdict, the plan is
constructive, and under-18 accounts see no Max and no Max plan. Say that
plainly in the review notes rather than hoping it is not noticed — the Apple
review-notes template above is a good starting point and the same text works.

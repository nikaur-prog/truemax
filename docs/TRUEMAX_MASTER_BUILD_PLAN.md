# TrueMax Master Build Plan

Status: implementation blueprint; Stage 1 exit gate passed 20 August 2026

Scope: scanner, scoring, results, Max, accounts, billing, personalized journey, creator tools, launch, and later native apps.

Implementation evidence: `TRUEMAX_STAGE1_VERIFICATION.md`. Stage 2 standardized capture is next. The separate creator execution sequence is not represented as complete.

## 1. Product definition

TrueMax should become three connected products sharing one account and one measurement engine:

1. **Quick** — a frictionless front-photo score and creator tool. It prioritizes completion and content creation over clinical-grade repeatability.
2. **TrueMax Scan** — a standardized front-and-side facial measurement product with visible confidence, editable landmarks, repeatable scoring, and a personalized plan.
3. **Max** — a persistent coach that understands the user, their scans, goals, plan, purchases, adherence, and progress, and uses approved tools rather than inventing facts.

The first sellable MVP is the second product with a constrained version of Max. Quick is the acquisition/content surface. Advanced simulations and native apps come later.

## 2. Non-negotiable product decisions

- FaceIQ is a useful benchmark for capture discipline, information architecture, perceived quality, and exposed measurements. It is not proof that its ratings are scientifically validated.
- TrueMax will not copy proprietary source code, hidden APIs, datasets, or scoring formulas. It will build an independent, documented, versioned system using public research, visible benchmark observations, and its own calibration set.
- A score is a measurement estimate with uncertainty, not an objective verdict about a person.
- No cross-user photo, scan, conversation, or subscription state may ever be returned.
- Ethnicity must not be inferred from a photograph or used to produce different attractiveness standards. User-supplied background can only inform clinically defensible skin or hair guidance, with disclosure and consent.
- Skin analysis provides screening and education, not diagnosis. Red flags and uncertain cases must be referred to qualified clinicians.
- Surgical simulations and recommendations remain out of the public MVP.

## 3. Immediate repair, rebuild, and defer decisions

### Repair

- Supabase authentication, OAuth callbacks, password reset, transactional emails, and post-scan account gate.
- Stripe Checkout, webhook reconciliation, entitlements, account display, and customer portal.
- Quick capture and its creator controls.
- Upload normalization, image orientation, crop, and error recovery.
- Existing results shell, share image, MP4 renderer, and responsive layout.
- Photo and scan ownership boundaries.

### Rebuild

- Score aggregation and percentile conversion.
- Basic-versus-full score consistency.
- Side-profile landmark estimation and validation.
- Capture-quality policy and confidence model.
- Max's context, memory, tools, safety, and evaluation architecture.
- Subscription entitlement resolver.

### Defer until the foundation passes release gates

- Surgical treatment simulator.
- Celebrity matching.
- Fully automated diagnosis of every skin condition.
- Native App Store and Play Store releases.
- A draggable desktop Max avatar with unrestricted site-wide control.
- Large public launch or paid acquisition.

## 4. Ordered implementation programme

## Stage 0 — Preserve, inventory, and benchmark

### Build

- Tag the current production commit and create a recoverable baseline.
- Inventory routes, client state, local storage keys, Supabase objects, Vercel variables, Stripe objects, webhooks, feature flags, and open pull requests.
- Map every score displayed in Quick, Basic, Full, share cards, MP4s, account history, and Max prompts back to its source function.
- Assemble a defect register with reproduction steps and severity.
- Record the complete TrueMax and FaceIQ flows at desktop and mobile widths.
- Measure FaceIQ's visible motion timings from the user's screen recording: tab movement, crossfade, blur resolution, list stagger, score count-up, modal entry, and image loading.

### Exit gate

- One architecture map, one defect register, one source-of-truth score map, and no unknown production environment dependencies.

## Stage 1 — Privacy, isolation, and state integrity

This stage blocks every other release.

### Build

- Remove any global, demo, or unscoped fallback photo used when a current scan is missing.
- Scope every scan, photo, result, plan, correction, conversation, and entitlement to `user_id` and, where relevant, `scan_id`.
- Replace mutable shared client state with an explicit scan state machine and immutable scan IDs.
- Separate anonymous pre-signup scans from authenticated user records using a one-time claim token.
- Clear object URLs, camera frames, pending uploads, and scan state when a new scan starts, a user signs out, or identity changes.
- Enforce Supabase Row Level Security and storage policies.
- Add signed URLs with short expiration for private photos.
- Add deletion, consent, retention, and audit records.
- Prevent logs and analytics from receiving raw facial images, access tokens, or sensitive questionnaire responses.

### Tests

- Two-account isolation test across the same browser, incognito, two devices, and rapid sign-out/sign-in.
- Anonymous scan claim test.
- Stale local-storage and back-button tests.
- Storage path and RLS adversarial tests.

### Exit gate

- Zero cross-user leakage in automated and manual tests.
- A scan can never render a photo whose owner and scan ID do not match the active context.

## Stage 2 — Standardized capture and upload pipeline

### Product modes

- **Quick:** accept any single detectable front-facing face, warn only when analysis is impossible, and never block on blur or lighting alone.
- **TrueMax:** guide toward a standardized image, allow a wider tolerance than the current validator, and distinguish warnings from hard failures.

### Capture flow

- Explain why standardized photos matter before capture.
- Recommend rear camera, 2x optical/telephoto when available, roughly 2 metres distance, eye-level camera, neutral expression, hair away from landmarks, and even light.
- Support camera capture, upload, drag-and-drop, HEIC conversion, EXIF orientation, crop, rotation, zoom, and mirror correction.
- Provide front and exact 90-degree side examples.
- Use a 1.5-second sequence: low beep, higher beep, shutter sound.
- Keep positioning instructions advisory unless geometry is truly unusable.

### Validation policy

Hard fail only for:

- no face or multiple faces;
- missing critical landmark regions;
- extreme yaw for front or insufficient yaw for side;
- unreadable resolution after normalization;
- severe occlusion that prevents required measurements.

Warn but continue for:

- moderate blur, lighting imbalance, small smile, mild pitch/roll, glasses, or imperfect framing;
- low-confidence skin analysis;
- front-camera lens distortion.

### Technical work

- Normalize uploads to a canonical pixel space before validation.
- Validate the detected face crop rather than the source image's total dimensions.
- Replace independent brittle thresholds with a weighted quality/confidence score.
- Return precise recovery copy and always expose **Retake**, **Upload another**, and when safe **Continue with lower confidence**.
- Reserve UI geometry so loading never causes content jumps.

### Exit gate

- Quick accepts at least 98% of single-face test images that the landmark model can process.
- TrueMax accepts at least 90% of standardized test captures.
- Compliant-photo false rejection is below 10%.

## Stage 3 — Landmark engine and correction loop

### Front landmarks

- Keep dense face-mesh detection for initial geometry.
- Add semantic anchors for hairline, temples, ears, pupils/iris, eyelids, brow boundaries, nose wings and tip, lip contours, chin, jaw angles, and neck boundaries.
- Flag landmarks derived from weak proxies rather than directly visible anatomy.

### Side landmarks

- Replace generic face-mesh side placement with a dedicated profile contour pipeline.
- Detect forehead/hairline, glabella, nasion, pronasale, subnasale, upper/lower lip, soft-tissue pogonion, menton, gonion, tragion, cervical point, and neck contour.
- Support left- and right-facing profiles through one normalized coordinate system.
- Never silently score missing or implausible landmarks.

### Correction UX

- Show estimated points immediately after capture.
- Add **Edit placement of points** and **Confirm**.
- On point selection, open a magnified lens or auto-zoomed crop with touch-friendly handles.
- Explain each point and highlight measurements affected by it.
- Recompute raw values and scores live.
- Preserve original estimates separately from corrections.

### Opt-in learning loop

- After confirmation, ask permission to share the image, original points, corrected points, model version, and quality metadata with the TrueMax improvement team.
- A refusal stores no training copy.
- A consented example enters a private review queue with revocation and deletion support.

### Exit gate

- Critical front landmark normalized error target below 2% of face span.
- Critical side landmark target below 3% of profile span.
- Every low-confidence point can be corrected on desktop and mobile.

## Stage 4 — Measurement catalogue and scoring rebuild

### Measurement catalogue

Create a versioned registry for every metric containing:

- canonical name and category;
- front, side, texture, or manually supplied source;
- landmark dependencies and formula;
- unit and plausible domain;
- sex-dependent physiological context where scientifically justified;
- public evidence/source notes;
- ideal interval, soft boundaries, and confidence requirements;
- weight, redundancy group, and display copy;
- applicable age range and safety limitations.

Start with a smaller reliable set, then expand. FaceIQ's visible catalogue is a research checklist, not automatically the TrueMax catalogue.

### Independent scoring model

- Store **raw measurement**, **quality confidence**, **metric score**, **category score**, **overall score**, and **percentile** as separate values.
- Use smooth bounded curves around documented target intervals rather than abrupt thresholds.
- Prevent correlated ratios from being counted repeatedly by grouping redundant measurements.
- Penalize low confidence by widening uncertainty, not by lowering attractiveness.
- Make Quick, Basic, Full, share cards, and MP4s consume the same versioned score object.
- Eliminate the misleading 0–100 Basic display or label it explicitly as percentile. A `95/100` attractiveness result must not be created by multiplying a 0–10 score or averaging percentiles.
- Display confidence and repeatability language alongside results.

### Calibration programme

- Build a consented benchmark set with standardized front and side images, balanced across age-appropriate demographic groups without using ethnicity to create beauty norms.
- Include repeated captures of the same people across devices, distances, and lighting.
- Obtain blinded ratings from multiple qualified human reviewers using a documented rubric where subjective judgement is unavoidable.
- Compare TrueMax against visible FaceIQ outputs only as a benchmark, not a target to imitate blindly.
- Fit and validate calibration on separate train, validation, and holdout cohorts.
- Version every scoring release and preserve old results under their original version.

### Exit gate

- Median repeat-scan change at or below 0.5/10 under standardized capture.
- 90th-percentile repeat change at or below 1.0/10.
- Basic and Full overall values agree because they share the same core score.
- Percentile labels match the reference distribution and sample limitations.
- A calibration report explains every weight and limitation.

## Stage 5 — Results experience and motion system

### Information architecture

- Persistent shell: user/scan history, Overview, Analysis, Plan, Max, and Share.
- Overview: one overall estimate, confidence, front/side contribution, category summaries, strongest opportunities, and next action.
- Analysis: Harmony, Angularity, Dimorphism, and Features as understandable lenses, not four disconnected scoring systems.
- Metric detail: raw value, score, target interval, visible measurement drawing, why it matters, confidence, contributing landmarks, and correction entry.
- Avoid overwhelming users with dozens of unprioritized flaws.

### Motion specification

- One animated tab indicator; content does not remount the entire page.
- Preserve photo and panel dimensions between categories.
- Crossfade current content and translate it 6–12 px over roughly 180–260 ms.
- Blur placeholders resolve to sharp content over roughly 220–320 ms.
- Stagger measurement rows by 20–35 ms with a capped total delay.
- Count scores from the prior value to the new value.
- Prefetch adjacent category data and images.
- Animate transforms and opacity, avoiding layout-heavy width/height animation.
- Respect `prefers-reduced-motion`.

### Mobile

- Sticky category rail and bottom primary action.
- Overview sections reveal top-to-bottom with reserved height.
- No horizontal overflow or hidden essential controls.

### Exit gate

- No visible layout shift during category changes.
- No blank page when data is pending; skeleton/blur state appears immediately.
- Interaction remains smooth on a mid-range phone and desktop at normal CPU throttling.

## Stage 6 — Max: trusted coaching agent

### Max v1 scope

Max answers questions about the user's scan, explains measurements, builds a conservative action plan, records user choices, and checks progress. It does not diagnose, prescribe, or make unsupported guarantees.

### Context architecture

Max receives structured context rather than a giant transcript:

- user profile, age band, region, units, constraints, and consent;
- goals, priorities, excluded topics, budget, timeline, and preferences;
- scan summaries, raw measurements, score version, confidence, and corrections;
- active plan, tasks, products, routines, workouts, and dietary preferences;
- purchases, adherence, check-ins, outcomes, adverse reactions, and unresolved questions.

### Tools

- `get_user_profile`
- `get_scan_summary`
- `explain_measurement`
- `compare_scans`
- `get_active_plan`
- `create_or_update_goal`
- `create_or_update_plan_item`
- `record_product_status`
- `record_check_in`
- `search_approved_product_catalog`
- `check_ingredient_conflicts`
- `get_evidence_source`
- `escalate_medical_or_safety_concern`

The model cannot write directly to arbitrary tables or browse arbitrary commerce pages.

### Product and evidence retrieval

- Curated product catalogue with region, price, merchant, ingredients, evidence tier, contraindications, age limits, affiliate disclosure, and last verification time.
- Prefer primary clinical guidance and official product information.
- Distinguish evidence-supported, promising, lifestyle, cosmetic, and speculative recommendations.
- Require citations for health, skin, supplement, and procedure claims.

### Conversation behaviour

- Stream responses immediately and show a meaningful working state.
- Ask only the missing questions required to make a plan safe and useful.
- Keep the conversation centred on the user's goals; redirect unrelated or abusive prompts without becoming brittle.
- Do not reinforce compulsive scanning, self-hatred, body dysmorphia, eating disorders, or unsafe weight loss.
- For minors, remove invasive, sexualized, extreme dieting, and high-risk content.
- State uncertainty and offer professional referral when appropriate.

### Longitudinal coaching

- Weekly check-ins for plan completion, product use, workout/diet adherence, progress photos, side effects, and blockers.
- Ask whether a recommended item was purchased before assuming use.
- Adapt the plan from reported adherence and outcomes.
- Stop or flag products when adverse effects are reported.
- Let the user pause reminders, delete history, and correct Max's memory.

### Performance and reliability

- Use streaming, compact context, cached scan summaries, structured tool outputs, timeouts, retries, and circuit breakers.
- Maintain idempotent mutations.
- Log tool decisions and model/version metadata without storing private images in traces.
- Add a golden evaluation set for scan explanations, acne, rosacea, fat loss, product conflicts, off-topic prompts, minors, and crisis language.

### Exit gate

- 95th-percentile first useful token under 2.5 seconds under normal load.
- Tool failures produce a recovery response rather than a blank or invented answer.
- No unsupported medical or product claims in the release evaluation set.
- Max correctly reads and updates the active user's plan without cross-user access.

## Stage 7 — Personalized journey and follow-through

### Onboarding questionnaire

- First and last name, email, optional mobile.
- Date of birth/age band with verified adult gating where required.
- Discovery source.
- Primary goal and what success looks like.
- Expectations, perceived strengths, concerns, insecurities, and topics to avoid.
- Budget, timeline, dietary restrictions, allergies, medical exclusions, region, and preferred units.
- Height and weight only when relevant, voluntary, and stored as sensitive profile data.

### Plan model

- Goals contain measurable outcomes and review dates.
- Plan items contain category, rationale, evidence tier, expected effort, cost, frequency, dependencies, safety notes, and status.
- Daily/weekly tasks feed a lightweight adherence timeline.
- Progress compares standardized scans and reported outcomes, not a single score alone.

### Exit gate

- A user can see what to do today, why it matters, whether they did it, and what Max will review next.

## Stage 8 — Authentication, account UX, and messaging

### Authentication

- Supabase email/password, magic link if retained, Google OAuth, Apple OAuth, reset password, session refresh, and sign-out.
- Scan remains the default landing page.
- After an anonymous scan reaches analysis, blur the background and display:
  - “In order to analyze your face, you must create an account. Sign up or log in to continue.”
- Claim the pending scan only after successful authentication.
- Sign-in failure copy should not reveal whether an email exists; use a secure combined message such as “Email address or password not found.”

### Emails

- Confirm email, welcome, password reset, magic link, email change, subscription confirmation, trial ending, payment failure, and cancellation.
- Clean branded buttons with visible fallback URLs in plain text for accessibility and security.
- Custom SMTP with SPF, DKIM, DMARC, verified sending domain, bounce handling, and rate limits.

### Exit gate

- Email, Google, Apple, reset, callback, and session-expiry flows pass on desktop and mobile.
- Anonymous scans are claimed exactly once.

## Stage 9 — Stripe billing and entitlements

### Product rules to finalize

- Starter: USD 6.99/month.
- Max: USD 11.99/month, adults only.
- Member extra scan: USD 2.99.
- Non-member scan: USD 5.99.
- Resolve the conflicting trial requirement: one week versus one month. Use one canonical configuration before implementation.
- Define whether the first signup scan is free and whether the trial includes exactly one additional scan.

### Architecture

- Stripe Checkout for web subscriptions and one-off scan purchases.
- Webhook events are the source of truth for subscription entitlements.
- Verify signatures, store event IDs, and process idempotently.
- Resolve `customer_id`, `subscription_id`, price, status, trial end, cancellation state, and entitlement atomically.
- Add customer portal for invoices, payment method, cancellation, and plan changes.
- Reconcile delayed webhooks on return from Checkout by polling a server endpoint with a bounded timeout, then show a truthful pending state.
- Never unlock from a success URL parameter alone.

### App stores

- Web Stripe launches first.
- Native digital subscriptions later require Apple/Google in-app purchasing and entitlement reconciliation; do not route native digital access through Stripe in violation of store rules.

### Exit gate

- Test clocks cover trial start/end, renewal, failure, retry, cancellation, refund, upgrade, downgrade, duplicate webhook, and delayed webhook.
- Account status changes correctly without manual refresh.

## Stage 10 — Trial funnel and conversion

### Flow

- Visitor scans first.
- Signup/login gate appears before analysis is revealed.
- User completes concise onboarding.
- First free result is revealed.
- Premium split-screen offer appears after the result/next action:
  - Starter on the left.
  - Max on the right with Max character animation.
  - Under-18 users see Max visibly locked with respectful copy.
- Decline remains available and explains one-off scan pricing without deceptive pressure.

### Exit gate

- Funnel events are defined from scan start through paid activation.
- Pricing, trial terms, renewal date, cancellation, and age restriction are explicit.

## Stage 11 — Skin and visible-feature analysis

### Safe initial scope

- Acne lesion burden, post-inflammatory marks, acne scarring, redness, uneven tone, visible dryness/flaking, oiliness proxy, dark circles, eye bags, fine lines, and obvious irritation.
- Do not claim comprehensive detection of every blemish or disease from a consumer photo.

### Quality gating

- Skin results require higher resolution and lighting confidence than geometry scores.
- If conditions are unsuitable, geometry may continue while skin results are marked unavailable.
- Surface uncertainty and never infer a diagnosis from one photo.

### Recommendation system

- Evidence-ranked OTC options, basic routine, lifestyle considerations, and when to seek care.
- Ingredient interaction and contraindication checks.
- Patch-test, pregnancy, age, allergy, and irritation warnings.
- Red-flag routing for suspicious lesions, severe infection, eye involvement, sudden change, or significant distress.

### Exit gate

- Every skin label has a documented dataset, known limitations, confidence threshold, and safe response template.
- False reassurance is tested as seriously as false positives.

## Stage 12 — Quick, share cards, reel creator, and MP4 output

### Quick

- Restore capture/upload controls and adjustable before score.
- Remove strict blur and skin-quality blocking.
- Use one coherent Quick score derived from the same core scoring version, with a prominent lower-confidence label.

### Share card

- Downloadable portrait image with safe crop, photo, score, category highlights, version label, and TrueMax branding.

### MP4 renderer

- Render server-side or in a deterministic worker rather than real-time DOM recording.
- 1080×1920, 30 or 60 fps, H.264/AAC MP4, fixed frame timing, preloaded fonts/images/audio, and no dropped frames.
- Black or controlled dark background, large face crop, smooth reposition to top, scores revealed beneath.
- One-word/typewriter callouts, measurement-line draws, subtle transition sounds, and optional voiceover.
- Preview before export and expose separate image/MP4 buttons.

### Reel creator

- Clear slots for before clip, after clip, optional B-roll, audio, caption style, and before/after scores.
- Drag, trim, reorder, preview, autosave, and retry failed renders.

### Exit gate

- Export duration and audio/video sync are deterministic.
- Frame-drop and crop tests pass on representative portrait and landscape inputs.

## Stage 13 — Brand, dashboard, SEO, and content system

### Brand

- Final TrueMax wordmark, monogram, favicon, app icon, dark/light variants, spacing rules, SVG/PNG exports, and logo pack.
- Signed out: disabled dark-grey mark.
- Starter: neon-green full TrueMax.
- Max: green “True” and neon-gold “Max.”

### Dashboard

- Compact scan/demo controls aligned on desktop and mobile.
- Scan history, current plan, next check-in, subscription, Max access, and creator exports.

### SEO

- Technical crawl/index audit, metadata, canonical URLs, sitemap, robots, structured data, Core Web Vitals, image optimization, internal linking, and Search Console.
- Evidence-led topic clusters: facial proportions, standardized photography, skincare basics, confidence and grooming, methodology, privacy, and measurement limitations.
- Avoid programmatic pages that make unsupported health or attractiveness claims.

### Exit gate

- Branded assets are consistent across site, email, share media, and app manifests.
- Public pages pass metadata, indexing, performance, and accessibility checks.

## Stage 14 — Observability, QA, legal, and launch controls

### Observability

- Structured errors for capture, landmarking, scoring, auth, Max tools, Stripe, and rendering.
- Correlation IDs from browser through API and worker.
- Privacy-safe performance metrics and alerting.
- Feature flags and kill switches for scoring versions, Max tools, skin labels, and billing offers.

### Test layers

- Unit tests for measurements and score curves.
- Golden-image tests for landmarks and drawings.
- Property tests for impossible/degenerate geometry.
- Integration tests for auth, scan ownership, database policies, and Stripe webhooks.
- Browser tests for front/side capture, correction, signup gate, checkout, results, Max, and export.
- Visual regression at phone, tablet, laptop, and wide desktop widths.
- Accessibility and reduced-motion tests.
- Security review, dependency scan, rate limiting, upload limits, and abuse testing.

### Legal and trust

- Privacy policy, biometric/facial data consent, retention/deletion policy, terms, medical disclaimer, age policy, subscription disclosures, affiliate disclosures, and regional review.
- Explain what runs on-device versus server-side accurately.
- Give users control over training consent and plan memory.

## Stage 15 — Native app preparation

- Only after the web MVP passes production stability gates.
- Package the responsive experience or build native shells with camera, secure storage, push reminders, deep links, Apple/Google auth, in-app purchases, and entitlement sync.
- Run TestFlight and Play closed testing before store submission.

## 5. Supabase data model

Use migrations, generated types, RLS, and audit columns. Proposed domains:

- `profiles`
- `profile_preferences`
- `consents`
- `anonymous_scan_claims`
- `scans`
- `scan_assets`
- `scan_quality`
- `landmark_sets`
- `landmark_points`
- `landmark_corrections`
- `measurement_definitions`
- `measurement_versions`
- `scan_measurements`
- `score_versions`
- `scan_scores`
- `goals`
- `plans`
- `plan_items`
- `check_ins`
- `adherence_events`
- `products`
- `product_evidence`
- `user_products`
- `conversations`
- `messages`
- `agent_runs`
- `tool_calls`
- `subscriptions`
- `entitlements`
- `stripe_events`
- `scan_credits`
- `render_jobs`
- `feedback_examples`
- `audit_events`

Sensitive medical-adjacent fields should be minimized and separated from public profile data.

## 6. API and job boundaries

- Capture and lightweight landmark preview can run client-side where feasible.
- Canonical scoring, entitlement checks, plan mutations, Max tools, and signed asset access run server-side.
- Long-running MP4 renders, calibration jobs, and consented feedback processing run in durable workers.
- Every mutation accepts an idempotency key.
- Every response carries `scan_id`, relevant version IDs, and confidence metadata.

## 7. Release batches

### Batch 1 — Stop dangerous failures

1. Cross-user image/state isolation.
2. Auth and pending-scan claim.
3. Stripe webhook and entitlement repair.
4. Upload normalization and validator rollback.

### Batch 2 — Make scans complete reliably

1. Quick acceptance policy.
2. TrueMax warning-versus-block policy.
3. Retake/upload recovery.
4. Side-profile acceptance and crop/level UI.

### Batch 3 — Make measurements correctable

1. Side semantic landmarks.
2. Magnified correction UI.
3. Consent-based feedback capture.
4. Landmark golden test set.

### Batch 4 — Make scores defensible

1. Measurement registry.
2. Unified score object.
3. Remove 95/100 inflation path.
4. Repeatability suite and calibration report.

### Batch 5 — Make results feel premium

1. Persistent results shell.
2. Blur/skeleton loading.
3. Shared motion tokens and transitions.
4. Mobile reveal and count-up.

### Batch 6 — Make the product sellable

1. Onboarding questionnaire.
2. Trial/paywall funnel.
3. Account/email completion.
4. Customer portal and scan credits.

### Batch 7 — Make Max useful

1. Structured scan explainer.
2. Plan builder with approved tools.
3. Memory and weekly check-ins.
4. Product catalogue and evidence retrieval.
5. Safety and evaluation suite.

### Batch 8 — Build growth surfaces

1. Share card.
2. High-quality MP4.
3. Reel creator.
4. SEO and content foundations.
5. Logo pack.

### Batch 9 — Closed beta and calibration

1. 25–50 consented testers.
2. Standardized repeat captures.
3. Support/defect triage.
4. Score and Max evaluation.
5. Funnel and retention measurement.

### Batch 10 — Public MVP

- Open only when all launch gates below pass.

## 8. MVP launch gates

TrueMax is MVP-ready only when:

- no known P0/P1 privacy or account-isolation defect exists;
- signup, login, reset, Google, Apple, and session recovery pass;
- Stripe activation, renewal, failure, cancellation, and portal pass;
- at least 90% of compliant TrueMax captures complete;
- side landmarks can be reviewed and corrected;
- repeatability targets are met;
- the score is consistent across every surface;
- Max explains the current scan without fabricating data;
- users can delete scans/account and control training consent;
- mobile results and checkout are usable;
- monitoring and rollback switches are live;
- legal, privacy, medical, and subscription disclosures have been reviewed.

## 9. MVP feature cut

### Included

- Front + side scan.
- Editable landmarks.
- Unified overall/category results with uncertainty.
- A concise personalized non-invasive plan.
- Max scan Q&A and plan follow-up.
- Account, scan history, subscriptions, credits, share image.
- Quick acquisition tool.

### Optional for MVP if stable

- MP4 export.
- Initial skin screening labels.
- Weekly reminders.

### Post-MVP

- Advanced simulation.
- Celebrity comparison.
- Broad procedure library.
- Native apps.
- Full animated/draggable Max avatar.

## 10. Product decisions required before Batch 6

1. Trial length: one week or one month.
2. Exact scan allowance before, during, and after trial.
3. Whether non-members can buy a $5.99 scan without an account.
4. Exact age verification and Max eligibility policy.
5. Whether public results show a 0–10 estimate, percentile, or both.
6. Which initial skin labels are allowed at launch.
7. Whether training-feedback photos are retained for a fixed period or until revoked.
8. Whether Max product links are editorial, affiliate, or both.

## 11. Benchmark material still useful

A video of the FaceIQ category switching is useful for measuring easing, delay, blur resolution, and perceived continuity. It is not required to start Batches 1–4. Store it only as a private visual benchmark and reproduce the design principles with TrueMax's own interface and code.

## 12. Definition of completion

Completion is not “the page renders.” Each batch ends with:

- implementation;
- automated tests;
- manual desktop and mobile verification;
- production-safe migration/rollback plan;
- observability;
- written acceptance evidence;
- no unrelated pull-request merging.

The first implementation move is Batch 1, starting with a code-level trace of scan identity and asset ownership before any visual rebuild.

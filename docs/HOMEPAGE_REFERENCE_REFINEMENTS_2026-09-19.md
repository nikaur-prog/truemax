# Homepage and reference refinements

Implemented in `codex/post-267-audit`. Publication now follows [the calibration release instructions](RELEASE_CALIBRATION_2026-09-19.md). Prior calibration, Coach Max and morph work is preserved.

## User scope and delivered changes

- Removed the homepage Max AI pill. The landing's synthetic-demo disclosure and Coach Max's identity remain.
- Replaced generic motivational quotations with 12 original TrueMax grooming, styling and comparable-photo notes. No invented celebrity quotations or endorsements.
- Added a house-icon button beside the logo for signed-in users. Both open the same account-checked dashboard action. The dashboard logo/house controls return from other tabs without breaking selected-tab state, and return Home to its top even when that tab is already active.
- Removed landing replay. Kept a discreet pause/resume control because the example animation loops alongside other content.
- Followed the user's later override: no radial theme reveal and no extra header switch. Settings > Appearance provides immediately saved Light/Dark choices on this device. No photo or canvas inversion.
- Clicking a celebrity reference now shows a front-reference estimate and reliability-qualified regional estimates alongside its measurements. All values come from the canonical current scorer and the entry's explicit sex, without name-based overrides or the marketing demo shim.
- References have stored measurement vectors, not recorded full-scan scores or meshes. The UI explicitly labels measurement-only estimates, missing side/outline information, pending calibration, and the fact that the displayed portrait can differ from the measured source. No percentile, potential or independently validated attractiveness claim is added.
- Fixed two issues found in rendered testing: desktop empty-dashboard flex shrinking clipped the logo/settings row under navigation; the Settings overlay was below the dashboard. The wording subdialog also remains above Settings.

## Verification

The verification skill prompted complete rendered-flow checks rather than relying on unit tests alone.

- TypeScript: passed.
- Full suite after the navigation follow-up: 2,120 passed, 0 failed, 28 existing environment-gated skips, 1 existing todo. All four local-preview tests also passed.
- Production build: passed. Existing approximately 617 kB Max 3D runtime chunk warning remains.
- User-facing em-dash and diff whitespace checks: passed.
- Browser: desktop at 1280 x 720, mobile at 390 x 844 and 320 x 740. Checked signed-in Home navigation, removed pill, working Settings overlay, Light/Dark switching, reload persistence, 44px appearance targets, reference score/measurement rendering and long-name wrapping. No horizontal overflow in checked mobile views.
- Reference detail Escape closes and restores focus to the opening card. Men's and women's reference labels were verified with separate entries; tests compare all 125 entries to the canonical scorer.
- Light preference restored after the check. Original user calibration tab left intact. No profile-save, new scan, paid render, remote write or calibration-row change made in this pass.

This is a local calibration preview. Its deliberately disabled account APIs report unavailable body-profile, feedback and consent data. Those messages are not a successful production backend test. Signed-out Home gating is covered by regression tests rather than signing out the user's existing session. These are browser viewport checks, not physical-device validation.

## Navigation and tutorial follow-up

The user's screenshot showed broken tutorial images and an unresponsive Home action. At inspection, the local port 4189 preview was no longer listening, while the browser retained the previously loaded page. Both tutorial images had zero decoded width. The source JPEGs were valid and their paths were already root-relative; this was not an intentional exemplar placeholder.

- Restarted the local calibration preview. Its help URL also incorrectly fell through to the scanner HTML. The preview now reads the explicit HTML-page rewrites from `vercel.json`, so `/help/take-a-good-face-scan` serves the real photo-help page, including on direct navigation. Production routing and the preview API allowlist were not broadened.
- Root scanner logo/house clicks now share a single in-flight navigation, show loading feedback, and expose an accessible retry message if loading rejects. Account and scan-owner checks are preserved. This does not add a timeout to underlying account requests.
- The house controls have no visible Home text, retain an accessible Dashboard label, and have 44px touch targets. Bottom navigation labels remain unchanged.
- Rendered checks: signed-in scanner house opens the actual dashboard; Celebrities returns to Home via its header house; mobile retains Scans, Home, Scan, Celebrities and Coach. Home is selected and its scroll position is zero after returning. No horizontal overflow at 390px; narrow 320px dashboard also checked.
- Opened the real upload guide without submitting an image or consuming a scan. Both front tutorial JPEGs decoded at 640 x 853 and rendered correctly at desktop and 390 x 844. Asset regression tests decode all tutorial JPEGs and check nested-URL resolution and the side tutorial video asset.
- Original calibration page was inspected read-only and remains at zero faces with Add a face available. No user captures were changed. Temporary viewport override was reset; the dashboard preview remains available.

The next user instruction authorized push and merge before calibration; see the release document for the updated order. Navigation/tutorial verification does not establish final scoring accuracy or complete production-backend verification.

## Existing questions: current truthful status

Coach Max's local prompt and formatting work is present: direct openings, fewer repeated names and stock phrases, context-aware follow-ups, and plain-text cleanup. It still needs live conversational-quality evaluation. The chat provider and speech voice have not been switched by this pass.

Ideal Dream Morph is not ready for public release. Local consent, recovery, cancellation and remeasurement work exists, but real generated-image identity/realism checks, paired-view consistency validation, server duplicate-job protection, a server rollout gate, and live storage/failure-path verification remain. See `MORPH_PREVIEW_CONTRACT.md`.

Calibration remains the next priority. This pass does not change scoring coefficients or ideal measurements and does not turn competitor scores into ground truth. The prior owner calibration smoke test established upload, automatic placement, manual review and diagnostic export for one synthetic front/side pair; the actual reviewed calibration set still needs the user's input.

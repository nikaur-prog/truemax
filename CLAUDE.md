# TrueMax — standing decisions

Context that outlives a single session. These are settled calls, not suggestions:
if a change would contradict one, raise it rather than quietly reversing it.

## Demo faces and AI disclosure

- The landing demo card and the account-gate demo strip show **no caption under the
  score**. No invented name ("Dev", "Adrian"), and no "AI-GENERATED DEMONSTRATION"
  label either. Both were tried and both were removed at the owner's call: the card
  is plainly a product demo, nobody reads it as a testimonial, and a caption on the
  picture bought nothing.
- The provenance lives in the landing page's fine print instead — "Demo faces are
  AI-generated" in `index.html`. Keep that line.
- The on-screen "AI-generated demonstration" tag **stays** in the published CTA
  videos (`src/ui/ctaSeries.ts`, `ctaSeries2.ts`). That is a different artifact: a
  before/after story with an AI actor, which a viewer could take for a real
  customer. See `docs/AI_ACTOR_CONTENT_STRATEGY.md`.
- The canvas still draws `face.credit` for any face whose licence requires
  attribution (a CC photograph, if one ever joins the roster). Only the synthetic
  cast's credit is suppressed.

## Hard limits

- **No proprietary source, hidden APIs, datasets or scoring formulas** are copied
  from anyone else.
- **Ethnicity is never inferred from a photograph**, and never used to produce
  different attractiveness standards. Synthetic-dataset diversity exists for
  landmark-placement geometry only, never for scoring.
- **No cross-user data** — photo, scan, conversation or subscription state — may
  ever be returned from an endpoint. The league leaderboard RPC is the single
  deliberate exception.
- `app_admins` rows are granted by hand in the Supabase SQL editor. Never from code.
- The repo is **public**: no real-face photographs are committed. The allowed
  exceptions are `public/tutorial/*`, `public/demo/*` (AI-generated),
  `public/league/montage.mp4`, `public/demo/*.mp4` and
  `public/side-guide/reference.jpg`. `.cta-assets/`, `.celeb-cache/`,
  `.voiced-example/`, `.rundown-sheet/` and `.side-dataset/` are gitignored.
- Secrets live in Vercel environment variables and are never echoed. TikTok tokens
  are server-only.
- Never put a model identifier in a commit message, PR title or body, code comment,
  or any other pushed artifact.

## Verdict wording

The plain ladder is a reading, not a compliment: needs work / needs improving /
below average / okay / alright / decent / good / very good / top of the scale.
No "attractive", "handsome" or "beautiful" anywhere on it, and the spoken
descriptors match. Pinned by tests in `analysisMode.test.ts`.

No verdict word may name a real person. "Marlon level" shipped, and the rundown
that surfaced it was about Marlon — the video's verdict on Marlon was that he is
Marlon level.

## Claims

- Never print a rarity claim the data cannot support. **"1 in N" is never said.**
- `fwhr` is excluded from the videos: its measured reliability is 0.00.
- Percentiles and repeatability claims stay inside what the sample supports; see
  `docs/SCORING_VALIDATION.md`.

## Voice and copy

- Only Coach Max's read is coach-toned. Every other surface is plain, factual and
  scientific.
- **No em dashes** in user-facing copy. Swept and clean as of the #198 cycle; a
  detector lives in the review notes. The one exception is the en dash `–` used
  as the empty-cell glyph in a numeric column (`fmt`, `moveLabel`), which is a
  typographic placeholder rather than prose.
- Voice speed is 1.125x (was 1.25x, which outran the measurement lines on screen).
  `VOICE_SPEED` in `api/tts.ts`; `SYLLABLES_PER_SECOND` and `WPM` track it.
- TTS provider chain: ElevenLabs (with timestamps), falling back to OpenAI
  (`tts-1-hd`, `onyx`). Higgsfield has no TTS endpoint — verified against their
  OpenAPI spec, which is image and video only. Do not add it as a voice provider.

## Privacy of the side-feedback loop

Consent-gated, 90-day retention. A guest scan never writes the owner's prior, and
the owner's prior is never applied to a guest.

## Working agreement

- Development happens on `claude/truemax-v1-scaffold-exje8g`; each cycle is one PR,
  squash-merged, then the branch is reset from `origin/main` with
  `--force-with-lease`.
- Validate before pushing: `npx tsc --noEmit`, `npm test`, `npm run build`.
- League and quick endpoints answer non-members with a 404 "Not found."

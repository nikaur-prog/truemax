# Front-only face-rater carousel

Plan only, 9 September 2026. No carousel code, photo uploads, renders, purchases or posts are included in this change.

## Outcome

Latest scope: a simple **front-only face rater** in `/quick`, for one person at a time. Choose a real front scan, review four measured feature slides, and put the basic scorecard PNG last. Download the images and a separate copy sheet, then manually finish the photo post in TikTok. No side photo, side points, comparison builder, screen recording, narration, generated transformation, trend scraper or auto-posting in this MVP. The separate synthetic asset workflow is in `IMAGE_FIRST_UGC_PLAN.md`.

## What already exists

| Reuse | Current implementation | Missing for this lane |
| --- | --- | --- |
| Creator entry and saved faces | `src/quick.ts`, `src/ui/clipsLibrary.ts`, `src/engine/faceLibrary.ts` | Choose the exact original and frozen front report, not a silent rescore using the current default reference. |
| Carousel layout and packaging | `src/ui/carouselCreator.ts`, `src/ui/zipArchive.ts` | A measured storyboard, per-slide copy sheet and complete-export validation. Existing generation themes are not measured categories. |
| Basic final scorecard | `src/ui/scoreCard.ts:53` | Reuse its layout and PNG renderer with the exact front report. Fix the category list for this lane; missing values must not trigger a substitute category. |
| Face framing, score hue and geometry | `src/ui/rundownFrame.ts:256`, `src/ui/measureOverlay.ts:383` | Deterministic still compositions with measurement drawing at its completed state. No audio, timed reveal or video encoder needed. |
| Saved measurements and versions | `src/engine/scanArchive.ts`, `src/engine/history.ts` | A versioned export snapshot containing the metric definitions, units and reference basis used for those numbers. Archives currently rehydrate definitions from live tables. |

Two source-data gaps matter. `photoStore.ts:39` keeps only 320px thumbnails, not crisp export originals. `SavedFace` retains a full front photo and landmarks but not the complete historical report/reference basis. Start with the current completed front scan while its original is available, then support eligible saved originals and snapshots. For older scans, require verified original-photo association or state that high-quality export is unavailable. Never put old geometry on a different photo. Bounded, opt-in original retention can follow with owner isolation and deletion.

The older `TIKTOK_BREAKDOWN_MASTERPLAN.md` describes video production, and `AI_ACTOR_CONTENT_STRATEGY.md` describes another content lane. Neither makes this real-scan carousel implemented. Do not inherit their editable-score workflow or unverified reach claims.

## Six-slide MVP

Use a measured-carousel schema separate from the existing generative progression, even though six slides fit its current size limit.

| Slide | Contents |
| --- | --- |
| 1 | Front photo and space for a short hook, such as “A closer look at this face.” |
| 2 | Proportions: actual lines, value/unit and region score. |
| 3 | Eyes: the same clear format. |
| 4 | Midface: the same clear format. |
| 5 | Jaw: front-view measurements only. |
| 6 | The basic scorecard PNG, last. No extra CTA slide after it. |

Use **Proportions, Eyes, Midface, Jaw** in that order for every person and the final card. Missing or invalid entries remain in place as “Not measured” with a brief reason, never replaced with another strongest category. Show one focal measurement per feature slide; any secondary detail must remain legible on a phone. Put essential limitations on the affected slide and the fuller explanation in the caption.

Front-only means no side image, side toggle, profile score or invented projection measurement. Use the front report, not a combined front-plus-side overall. If an old record has only combined values, do not relabel them as front scores. Preserve the report's scoring/reference provenance and do not silently change the selected reference when reopening it.

All values come from the selected report snapshot, using the app's canonical 0-10 scale and rounding. No typed earlier score, new rating scale, invented percentile or generated target used as a measured result. The existing card has a potential column; use a measured-only option in that same renderer for this simple lane rather than inventing a potential value. Only retain a displayed rank when its saved reference basis is verified. Suppressed/invalid measurements stay suppressed. No hormone, health or biological-change claims, and no humiliating rankings.

## Visuals and native copy

Render crisp 1080x1920 stills directly from source images and geometry. Reuse restrained score-coloured hue, clean type and measured lines, with one focal detail per slide. Manual crop must preserve alignment between photo and overlay. Preview and export use the same composition function, awaited fonts and decoded images.

Keep metric names, measured values, units, scores and essential limitations baked into the image so they cannot drift from the source. Reserve clear space for a short native hook. Export `01-hook.jpg`, the four numbered feature images, `06-scorecard.png`, `copy.txt` with slide-numbered optional native text, and `caption.txt`. Keep the final card visually familiar. Do not put private scan IDs, account identifiers, full names or consent records in the public pack. Provide individual image saves as well as ZIP for phone workflows.

Check TikTok's actual photo composer on a phone before locking the safe area or promising per-slide native text controls. Where those controls are unavailable, use the post title/caption and a complete-image variant. Native text is useful for flexible editing and reader context, not a guaranteed distribution trick.

TikTok describes recommendations as a combination of interactions, content and user information, with interaction signals generally more heavily weighted for most users. It does not establish a guaranteed reach advantage from creating text or music natively. Its text/sound creative research is guidance for ads, not proof of an organic-carousel ranking bonus. [Recommendation guidance](https://support.tiktok.com/en/using-tiktok/exploring-videos/how-tiktok-recommends-content), [creative guidance](https://ads.tiktok.com/business/en-US/blog/creative-best-practices-top-performing-ads?redirected=1).

## Consent, music and offer

- Begin with consenting adults. Viewer permission to receive a scan is not permission to publish their face and ratings in promotional content. Record that separate purpose and the creator's rights to use the photograph, allow an alias, and require approval of the finished carousel. A public photo or celebrity name is not evidence of a reusable image licence. Keep rights evidence private and support deletion; do not promise removal of copies already shared externally.
- Keep the image pack silent. At publishing, manually choose a track cleared for the commercial use, region and placement. TikTok recommends its Commercial Music Library for promotional posts; its other music licences do not cover commercial use. Outside that library, the necessary rights must be secured independently. Do not download or bundle a trending copyrighted track. [Commercial-use guidance](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/commercial-use-of-music-on-tiktok), [library and placement selection](https://ads.tiktok.com/resources/help/article/how-to-use-the-commercial-music-library?lang=en-GB).
- Turn on the appropriate own-brand promotional disclosure. TikTok says this disclosure does not affect feed distribution. [Content disclosure guidance](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/promoting-a-brand-product-or-service).
- Verified CTA: **“Your facial score is free. Create an account to see your analysis at truemax.app.”** `index.html:245`, the signup wall in `src/main.ts`, and `depth.ts` support that limited offer. Detailed access has a two-scan trial; Coach Max planning is not the permanent free offer. `scanAllowance.ts` currently permits one personal scan per rolling seven days. Do not promise unlimited scans, a permanently free full breakdown or a free Max plan.

## Implementation and acceptance

1. Add `src/engine/carouselRundown.ts` and tests: immutable front snapshot, eligibility/provenance checks, fixed categories and six-slide storyboard. Use current-scan originals first; do not make a new archive project a prerequisite for the first preview.
2. Add `src/ui/carouselRundownFrame.ts` and tests: shared preview/export composition using existing geometry and crop helpers. Add the narrow measured-only/fixed-category option to `src/ui/scoreCard.ts` for the last PNG; preserve existing callers.
3. Add `src/ui/carouselRundown.ts`; wire it through `src/quick.ts` and existing creator access checks. Preserve creative generation as a separate mode. Reuse ZIP and file-save helpers. Cancel stale loads/exports on source or account change; do not silently drop a slide or export an old person's face.
4. Test missing/shuffled categories, invalid measurements, rejected side/combined-only inputs, missing originals, version provenance and account changes. Prove all numbers equal the front snapshot and the basic scorecard is always last.
5. Review two single-person example packs on desktop and a real phone: line alignment, legibility, native text space, image saves, ZIP order and caption. No comparison UI is required. Publishing stays manual and requires separate approval.

Comparison is optional later. It would require matching view coverage, definitions, score version and reference basis, a pair-wide fixed metric list, and genuine source records rather than typed previous scores. It is not a dependency of this MVP.

No claims of increased reach or conversion until actual permitted publishing tests provide evidence. A later experiment may compare hooks and presentation while holding the measurement content fixed; it is not part of this build.

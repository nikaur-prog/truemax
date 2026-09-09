# Image-first UGC asset workflow

Plan only, 9 September 2026. No generation, training, photo upload, purchase or publishing was performed for this plan. This is a synthetic illustration lane, separate from the real front-scan carousel in `CAROUSEL_RUNDOWN_PLAN.md` and from the app's personal goal preview.

## The deliverable

Approve one original adult character through **four anchor images**, then produce **ten paired contexts, twenty images total**. The anchors are additional to those twenty scene images. Stop at downloadable stills if that is all the creator wants. Animate only selected approved stills into approximately five-second clips. Hand selected assets to the existing Make a TikTok builder for music, beat cuts and the reveal/drop; do not build a second editor or auto-post.

The supplied sponsored tutorial is unverified marketing context, not an instruction source or proof of output quality. The useful pattern is brand brief, reference analysis, shot plan, approval, generation and review. Do not install its promoted skill stack, download other creators' footage, copy their script, or spend credits merely because the transcript recommends it.

The separately reviewed local reference clips support simple front-facing micro-motion, small glances and slow walking as useful shot recipes. Their changed lighting, clothes and poses are editing choices, not evidence of a measured transformation, and their cut speed does not establish app latency. Start with those lower-risk motions; a hair sweep introduces hand/face occlusion and needs extra review. Detailed observations belong in `UGC_REFERENCE_NOTES_2026-09-09.md`; reference-specific profile shots do not expand the front-only carousel MVP.

## 1. Approve the character before the batch

Use a short editable brief: adult appearance, hair/eyes, distinguishing features, allowed presentation changes, a neutral default outfit, framing, palette, exclusions and intended disclosure. No gender-based assumptions about hobbies, clothes or locations. A real person's likeness needs explicit permission for external generation and the intended public commercial use; the simplest starting point is an original fictional adult.

| Anchor | Required image |
| --- | --- |
| A1 | Before presentation, chest-up, front facing, neutral background and default outfit. |
| A2 | After presentation, chest-up, exactly the same character, pose, camera, light and outfit. |
| A3 | Before presentation, full body, same default outfit, proportions and identity as A1. |
| A4 | After presentation, full body, matching A3's pose, camera, light and outfit and A2's approved changes. |

“Before” and “after” mean fictional visual treatments, not elapsed time or customer outcomes. List the intended differences explicitly, preferably grooming and styling for the first run. Do not use a different face, skeletal structure, body type, camera angle, exposure or outfit as a hidden shortcut. Keep those fixed unless a separately labelled creative concept is explicitly approved. Approve the four images together on a contact sheet, not one at a time without cross-checking. Replacing an anchor invalidates downstream approvals that depend on it.

## 2. Ten editable scene pairs

Each context gets its own outfit and setting choices, but those choices are identical within its before/after pair. Pose, framing, lens/perspective, lighting, location, props and identity stay paired. Create the first image, then use it as a composition reference for its counterpart alongside the approved identity anchors; do not independently prompt two unrelated shots and call them a pair. A repeated random seed is not proof of identity consistency.

| Pair | Editable starting context | Composition to lock within the pair |
| --- | --- | --- |
| 01 | Window-lit room | Seated chest-up, same chair and window light. |
| 02 | Desk or creative workspace | Same desk position, hands and background objects. |
| 03 | Cafe | Same table, cup, seated pose and outfit. |
| 04 | Street walk | Full-body walking pose at the same point in the same scene. |
| 05 | Park | Same bench or standing position and weather. |
| 06 | Bookshop or library | Same shelf, book and body orientation. |
| 07 | Gym or sport setting | Same fully clothed outfit and neutral pose; no body-change claim. |
| 08 | Event or evening outing | Same venue, outfit and controlled lighting. |
| 09 | Travel or station setting | Same luggage, outfit and background, no invented endorsement. |
| 10 | Hobby chosen by the creator | Same instrument, board, craft or other chosen prop and pose. |

These are templates, not ten mandatory stereotypes. Replace any context before production. Generate one pair as a pilot, inspect it, then continue the remaining nine only after approval and a cost check. Show a twenty-image review grid grouped into ten pairs. Reject identity drift, changed clothing/location, extra fingers, inconsistent props, fake text/logos, unintended body changes or altered camera perspective. Retry only the rejected asset or pair, with a bounded retry budget.

## 3. Download or animate selectively

- **Stills:** save the twenty numbered images, optional anchors, a contact sheet, and a human-readable shot/caption sheet. Keep provider job details and consent evidence in the private project record, not the publishing pack.
- **Selected clips:** let the creator select individual approved images or paired images. Quote cost and confirm quantity before submitting jobs. Request about five seconds with one simple action, such as a small glance, breath, step or hand gesture, maintaining the exact approved character, clothes and scene. Where the provider only supports another duration, obtain approval for that cost/duration and trim to five seconds during assembly. Do not animate all twenty automatically.
- For a paired reveal, animate before and after separately with matching motion intent. Cut between them in the editor. Do not use an identity-morph transition that fabricates a real transformation.
- Review the entire clip, not only its poster frame. Reject face drift, anatomy artifacts, lip movement without intended speech, scene cuts and changed proportions. Download approved clips; failed jobs must remain visibly failed and must not be silently regenerated indefinitely.

## 4. Use the existing TikTok builder

`src/ui/beatReelPanel.ts:551` already accepts `openBeatReelPanel(analysis?, initialFiles)`. Its `loadClip` supports both image and video files. `src/engine/beats.ts`, `beatPlan.ts` and `src/ui/beatReelExport.ts` already handle beat analysis, cut planning and export. The panel has a waveform, clip order/duration controls and a manually marked drop. Route selected stills/clips through this existing workflow, with pair order preserved and the after reveal chosen by the creator.

Do not invent an analysis segment for synthetic assets. If a synthetic demonstration is actually scanned, show only the resulting engine numbers and identify it as a demonstration; a prompt target is never the measured result. Do not convert a requested PSL-style creative label into the app's score, a percentile or a claimed reference-population rank. Existing editable-score controls need a provenance-safe handoff, not automatic values from this brief.

The builder currently enables its long CTA film by default. Make that choice explicit in the handoff so a short selected-asset cut does not unexpectedly acquire a thirty-second tail. Verify total duration, crop and beat/drop placement before export. Rendering local audio does not itself grant music rights: only import a track licensed for this editing/export use. A track available inside TikTok is not automatically licensed for extraction into our builder. For music added only in TikTok, download the stills/clips first; the existing beat builder requires a local song, so a silent assembled cut would need an explicit export option rather than a promise it already supports one. TikTok recommends its Commercial Music Library for promotional content, with region/placement checks. [Commercial music guidance](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/commercial-use-of-music-on-tiktok), [library usage](https://ads.tiktok.com/resources/help/article/how-to-use-the-commercial-music-library?lang=en-GB).

## 5. What another platform adds

Use the already connected Higgsfield access for the first controlled pilot. The account and credit balance were checked separately by the owner-facing task; recheck available credits and per-job cost immediately before an approved run. Do not infer API billing from a subscription name or promise that all twenty-four images fit a balance without a quote. Public capabilities are not a benchmark of successful identity preservation.

| Platform | Verified capability or current evidence | Incremental value for this workflow |
| --- | --- | --- |
| Higgsfield | Official developer tooling supports image/video jobs, cost checks, character identity assets and marketing workflows. Its official connector is already available here. [Official surfaces](https://higgsfield.ai/creator-hub/help-center/getting-started/official-higgsfield-platforms), [official CLI reference](https://github.com/higgsfield-ai/cli). | We already have generation access and can keep the approval/asset manifest in our workspace. First test whether four anchors produce a consistent pair before adding another subscription. Not every website feature is necessarily exposed through the current connector. |
| Eromify | A read-only public browser review of the requested `.com` site showed Avatar, Canvas, Templates, image/video creation, Upscale, Influencers, Library and MCP/CLI areas. It markets reusable trained personas by name, batches of twelve and a connected image-to-video canvas. Its MCP page advertises access on Growth/Creator through supported chat clients. Pricing was visible with yearly billing selected, so displayed monthly equivalents were not month-to-month prices. [Requested site](https://www.eromify.com/), [MCP page](https://www.eromify.com/mcp). | A focused avatar library and batch/canvas UI may reduce manual work. Actual identity retention, matched-pose quality, export rights, retention and usable API/connector coverage still need verification. Do not repeat its conversion, customer-count or perfect-consistency advertising as established results. No subscription is needed now; consider a controlled comparison only if our existing Higgsfield workflow fails the identity pilot. |
| Runway Agent | Official documentation describes conversational planning, reference/storyboard creation, image/video generation and a built-in editable timeline. It warns that output is variable. Its timeline guide currently says still images are not supported directly in that timeline. [Agent guide](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent), [timeline guide](https://help.runwayml.com/hc/en-us/articles/52685547867667-Trimming-and-Assembling-Clips-in-Studio). | Its integrated creative workspace and manual video timeline are the clearest additions, not proven better likeness. Our existing builder already accepts stills as timed segments and handles beats/drop. A switch is optional, not required for this image-first plan. |

For any Runway trial, enable **Ask before generating media** first: its documented default is automatic generation, which spends credits without a separate approval. Agent can also build reusable workflows; creating the workflow and executing paid generations are separate steps, and its current documentation restricts running that feature to eligible paid plans. These are useful conveniences, not reasons to authorize an unattended batch. [Agent approval settings](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent), [workflow guide](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent).

## 6. Disclosure and claims

Every published synthetic image/video needs a clear **“AI-generated illustration. Not a real result.”** label, plus the platform's applicable synthetic-media and promotional disclosure controls. Do not make fake testimonials, skin-treatment success stories, biological/hormone claims, or promises of clinical outcomes or timelines. Do not show a fictional “after” as what TrueMax measured or guarantees a person will become. Avoid body-size-based worth or success labels. Refer to TikTok's [AI-generated content guidance](https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content) and [promotional disclosure requirements](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/promoting-a-brand-product-or-service) before publishing.

## Proposed build and gates

1. Add a typed private project manifest and owner-scoped draft storage: four anchor approvals, ten context pairs, locked pair attributes, selected exports, provider job state, cost ceiling and retry counts. A new `src/engine/imageFirstUgc.ts` should not overload the current generative carousel's numerical levels.
2. Add `src/ui/imageFirstUgc.ts`: brief, four-anchor contact sheet, editable context grid, per-pair approve/retry, still download, selected-clip quote and explicit generation approval. Reuse existing provider integration and image/ZIP helpers; use server-only credentials and existing creator grants. Determine the exact provider route after capability inspection, not by inventing an endpoint.
3. Add a selected-asset handoff to `openBeatReelPanel`, preserving order, synthetic provenance, duration and explicit CTA choice. No new music library, trend collection or posting integration is required.
4. Test approval invalidation, before/after pairing, account changes during jobs, duplicate submission prevention, bounded retries, image-only completion with no video calls, selected-only clip submission, ordered downloads and propagation of disclosure/provenance into the final export. Safely ignore cancelled late results.
5. Acceptance: approve four anchors, one successful pilot pair, the final ten-pair image grid, and only the chosen clips. Verify one existing-builder handoff and downloaded result on desktop and phone. Spend nothing further until a rejected output or changed brief receives a specific retry approval.

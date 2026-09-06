# Goal preview contract

The first release separates the product's promise from the image renderer.
`src/engine/morphPlan.ts` owns what may change, how far a measurement may move,
and what repeated evidence completes a goal. A future rendering service may
turn that blueprint into pixels, but it cannot widen the promise.

## Product states

The Plan shows two targets:

- **My goals** combines only goals the member selected.
- **Max's full view** adds at most three suggestions supported by a reliable
  measured gap. It never infers an unmeasured skin, hair, teeth or body issue.

Front and profile stay paired. If the scan has no profile photograph, the
profile target is withheld. The goal map labels draft measurements as illustrative,
not proven personal outcomes. Required time estimates and appearance-point
promises are omitted until repeatability, realistic target ranges and the reward
service are validated. Routine/streak rewards are separate.

The current release can ship the target map with image rendering disabled.
`VITE_MORPH_PREVIEW=1` should be set only after the endpoint and all validation
gates below are live.

## Request

Authenticated clients send `POST /api/morph-preview` with:

```json
{
  "version": 1,
  "variant": "selected",
  "scanId": "<the scan's uuid>",
  "source": {
    "front": "data:image/jpeg;base64,...",
    "side": "data:image/jpeg;base64,..."
  },
  "blueprint": {},
  "privacy": {
    "purpose": "goal-preview",
    "retainSource": false
  }
}
```

The client downsizes each source to a maximum edge of 1400 pixels. Inputs and
outputs must be in-memory JPEG or WebP data URLs. Remote output URLs are
rejected so the browser never leaks a member token or photograph to an
unapproved host.

The server sanitizes a numeric recipe from the blueprint's known effect and
metric IDs. Names, units and permitted measurements come from the server
catalogue, not client text. Direction and amount are bounded by that catalogue's
illustrative movement ceiling. The provider receives the signed effect amounts,
baseline, requested target and allowed range, rather than just nonzero layer
switches. This constrains instructions; it is not proof that the pixels comply
or that the target is biologically achievable. The independent validation and
release gates below remain required.

A front-only request contains and renders exactly one photograph. The provider
interface's optional side output must not be synthesized from a duplicate front.

The service may return `accepted` or `processing` with a job ID. The client
polls `GET /api/morph-preview?job=<id>` with the same bearer token.

After consent, the client has a single five-minute wall-clock budget across token
refresh, upload, response-body reads, polling and validation. It cancels stale work
on teardown or account change and withholds late results, even when a transport
ignores cancellation. Each consent API request has its own 15-second budget;
there is no timer on the person's reading or decision. Consent has focus entry,
keyboard containment, Escape dismissal and safe return to its opener.

If the server has already supplied a job ID, Check existing preview resumes that
job in the current report instead of buying another render. This is not durable
resume after reload. The existing synchronous POST cannot be recovered by job ID
if it times out before returning one; a future accepted-job endpoint and saved-job
picker are still needed for that case.

## What the server asserts, and what the device must

The server (`api/morph-preview.ts`, built on the shared Goal preview
machinery in `api/goal-preview.ts`) stands behind three of the five gates:
`moderationPassed` (the provider did not refuse), `naturalOnly` (the
instruction set came from the catalogue's layers and nothing typed) and
`crossViewConsistent` (both views rendered from one instruction set in one
job). `identityPreserved` and `targetAligned` are pixel questions for the
landmarker and the metrics, which run on the device and not on the server,
so a fresh `ready` response carries them as `false` with
`"pending": ["identityPreserved", "targetAligned"]`. The browser runs its
re-measurement on the returned images, posts the verdict to
`PATCH /api/goal-preview?id=<jobId>` as `{ "validation": { "passed": true } }`
(or `false`, which marks the job rejected), and from then on
`GET /api/morph-preview?job=<jobId>` returns all five gates true. The
display rule below is unchanged: nothing is shown until all five are true.

The request also carries `scanId`, the scan the photographs came from, so
the stored job names its scan. Consent is a separate call the dialog makes
once, `PUT /api/goal-preview-consent` with `{ "version": "goal-preview-v1" }`;
without it the render answers 403 "Choose Goal preview in Settings first."

## Required validation

A `ready` response is displayable only when all five booleans are true:

```json
{
  "status": "ready",
  "jobId": "preview_12345678",
  "images": {
    "front": "data:image/webp;base64,...",
    "side": "data:image/webp;base64,..."
  },
  "validation": {
    "identityPreserved": true,
    "naturalOnly": true,
    "targetAligned": true,
    "crossViewConsistent": true,
    "moderationPassed": true
  }
}
```

The browser withholds the entire result if one gate fails, the expected second
view is missing, the job ID is malformed or an image is not a bounded JPEG or
WebP data URL.

The server must independently enforce authentication, Max entitlement, adult
access, per-member rate limits, input size, MIME validation and deletion of
source and generated images after the response or short job expiry. Client
flags are never authorization.

## Natural-change boundary

Allowed controls are limited to soft-tissue fullness, under-eye puffiness, jaw
and under-chin definition, visible skin evenness and blemish patterns, grooming,
hair finish, smile presentation, posture and lighting. There are no controls
for bone structure, eye size, nose size, lip size, skin tone, age or identity.

Measurement targets use the shared catalogue's conservative movement ceiling
and eligible IDs, within the existing scoring definition's changeable share.
Skeletal, implausible, noisy or already-in-range readings do not become promises.
The draft's legacy completion-delta field is not an award rule. No preview or
single photograph completes a goal or mints appearance points.

Saved device-local drafts keep their accepted baseline and destination fixed.
Only canonical catalogue measurements, views and units are restored. For a new
scan, a reached or passed draft marker is omitted from further numeric edits,
not treated as verified progress. A missing verified view, incompatible goal
set or destination beyond the current illustration budget pauses the combined
selected-goal render. This preserves the marker without silently moving it or
reapplying a broad effect after dropping its numerical target.

The device compares isotropic image coordinates before eye-based alignment, using
the original and generated frame dimensions. Uniform resize, padding, crop and
roll no longer appear to change identity merely because the aspect ratio changed.
This repair leaves thresholds unchanged and is not an identity validation study.

## Per-goal teasers

The composite target is the first render surface. Per-goal image teasers should
be added only after the composite passes an identity retention study. The same
contract can then accept a goal scope, render one rule at a time and cache the
validated result by member, scan, goal and blueprint version. A text change map
remains the fallback when a teaser fails, times out or has no measurable basis.

## Release gates

1. A consent and retention review approves the exact copy and deletion window.
2. A labelled identity set passes front and profile preservation thresholds.
3. Independent checks reject surgical, identity-changing and unbounded edits.
4. Paired views describe the same change and never contradict the blueprint.
5. Timeout, refusal, invalid output and partial-view paths reveal no image.
6. A member can delete every generated target and its job metadata.
7. Monitoring records timings and gate outcomes without storing source pixels.

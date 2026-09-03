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
profile target is withheld. Each goal shows its expected review window, the
points available on completion and the repeatable measurements that can prove
movement. Points reward the consistency and effort of completing a plan item;
they are not attractiveness points.

The current release can ship the target map with image rendering disabled.
`VITE_MORPH_PREVIEW=1` should be set only after the endpoint and all validation
gates below are live.

## Request

Authenticated clients send `POST /api/morph-preview` with:

```json
{
  "version": 1,
  "variant": "selected",
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

The service may return `accepted` or `processing` with a job ID. The client
polls `GET /api/morph-preview?job=<id>` with the same bearer token.

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

Measurement targets close at most 85 percent of the changeable share already
declared by the scoring engine. Skeletal, implausible, noisy or already-in-range
readings do not become promises. Completion requires at least 60 percent of the
modelled move to repeat across comparable scans; one photograph cannot complete
a goal.

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

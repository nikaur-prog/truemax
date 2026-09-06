# Max 3D: first authored asset and runtime

Status: real local prototype, not yet visually approved. The normal product keeps the existing SVG. The 3D version is currently available in the development preview only, not part of capture startup. The runtime is ready for a future explicit opt-in on a large Coach surface after approval.

## Identity and deliverable

The latest owner decision in `PREMIUM_REVIEW_AND_MAX_PLAN.md` takes precedence over the older avatar inventory: cobalt cloud-lobed shell, dark visor, pupils, mint antenna, stub arms without elbows, no legs and no props. This first iteration is original procedural geometry authored for this repository. It is not a generated image, a sequence of flat sprites, or an externally purchased character.

- Editable source: `scripts/build-max-3d.mjs`.
- Rebuild: `node scripts/build-max-3d.mjs`.
- Actual asset: `public/brand/max-rig-v1.glb`.
- Asset inventory and approval state: `public/brand/max-rig-v1.json`.
- Geometry: 8,596 triangles, 3 shared materials, 203,356 bytes, no textures or external dependencies inside the GLB. Shared vertices and smooth normals keep the rounded shell smooth; cloud shaping is limited to subtle upper lobes.
- Rig: rigid transform hierarchy. It is intentionally not a skinned character or human skeleton. The arm pivots do not add elbow joints.
- Source assets: none. This deliverable uses original paths and primitive geometry, with no third-party mesh or texture rights dependency.

The older `MAX_AVATAR_SPEC.md` lists `max-avatar-v1` images that are not in this checkout. The actual static fallback files are `public/brand/max-avatar.png` and `.webp`; current UI markup is the existing SVG. That inventory discrepancy must not be mistaken for delivery of a rigged asset.

## Coordinate and clip contract

Metres, Y up, front facing positive Z. `MaxRoot` is the hover translation; `Body` owns body orientation; the rigid `Face`, `Eyes`, `Mouth`, `ArmLeft`, `ArmRight` and `Antenna` children share a common rest pose. No clip translates the character away from its stage.

| Clip | Seconds | Behaviour |
| --- | ---: | --- |
| idle | 4.8 | Small hover and yaw, looping |
| listening | 3.2 | Lean and head tilt, looping |
| thinking | 4.0 | Slight turn and pupil direction, looping |
| speaking | 2.2 | Small nod and mouth motion, looping |
| celebrate | 1.8 | One lift and stub-arm response, then idle |
| quiet | 1.0 | Rest pose, render once after transition |

Samples start and finish at matching transforms, with finite times and values. Tests check those seams and the asset budget. Browser review must still check perceived continuity and crossfades. Speaking is only a visual state; selecting it does not play audio and must not be represented as audible speech.

## Runtime and lifecycle

`mountMax3D(stage, initialState?)` returns `destroy()`, `setAnimation(state)` and `setView(view)`. Call it only after an explicit request on a large post-report Coach surface. Keep the existing `.mx-svg` inside the stage as the fallback and call `destroy` before removing or replacing the surface. The development preview includes front, three-quarter, side and back turnaround views.

The thin launcher imports neither Three nor the GLB until the stage is at least 88 by 88 pixels, visible, connected, in a foreground document, and the device does not request reduced motion or data saving. One mount owns the renderer; mounting another releases the previous surface. The renderer is a separate dynamic chunk. The development preview exposes all six states and a Return to static button.

The drawing buffer is bounded to a 640 CSS-pixel longest edge, at most 1.5 device pixel ratio, with at most 30 rendered frames per second. There are no shadow maps, bloom, postprocessing, image textures or physics. Geometry, materials and renderer are explicitly disposed. The mixer releases its root. A removed surface, cancelled load, context loss or rendering failure returns to the SVG and cannot leave a hidden renderer running. Hidden/offscreen surfaces schedule no animation frames. The quiet state stops its frame loop after blending to rest.

The SVG is not just made invisible: when the first real frame appears its CSS animation, idle scheduler and pointer tracking are suspended through the shared motion controller. They resume when the fallback is restored. Small chat avatars never create a context.

The approach follows the official [rendering-on-demand guidance](https://threejs.org/manual/en/rendering-on-demand.html), [resource cleanup guidance](https://threejs.org/manual/en/cleanup.html), [GLTF exporter](https://threejs.org/docs/pages/GLTFExporter.html) and [GLTF loader](https://threejs.org/docs/pages/GLTFLoader.html). The exact runtime dependency is pinned in the package lock.

## Acceptance before any default rollout

1. Owner approves front, three-quarter, side and back silhouette against the brief. A polished visual pass may change this first iteration.
2. Review all clips and transitions at 88, 320 and 420 pixels. Verify no pupil clipping, arm snapping, lighting flicker or loop hitch.
3. Check Return to static, route close, rapid re-open, hidden tab, offscreen scroll, reduced-motion and data-saving changes, context loss and failed asset download.
4. On a physical older iPhone, compare a five-minute report/Coach session with and without the optional character. Record CPU, memory, scroll response and thermal behaviour. Desktop browser emulation is not that evidence.
5. Only after those checks should `approved` become true or the opt-in be considered for a default large Coach surface. Capture and initial report loading remain independent in either case.

## Scan instrumentation delivered alongside this pass

`src/engine/scanPerformance.ts` keeps at most eight attempt summaries in page memory, using fixed stages and fixed outcomes. It contains elapsed rounded durations and an ephemeral counter, no absolute timestamps, pixels, landmarks, measurements, person/scan identifiers or error strings. It sends nothing, persists nothing and does not place data on a window global. `clearScanPerformance()` invalidates old handles as well as clearing the summaries. Attempt finish/cancel/eviction prevents late callbacks from adding records, and each stage is counted once.

These diagnostics can expose a stall during a deliberate test, but do not constitute production latency evidence until measured on representative devices. Stage collection must not invent a successful outcome for pending work or turn report rerenders into fresh scans.

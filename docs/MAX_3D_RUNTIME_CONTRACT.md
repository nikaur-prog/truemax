# Max 3D: corrected SVG identity and runtime

Status: real local prototype, not yet visually approved. The normal product keeps the existing SVG. The 3D version is currently available in the development preview only, not part of capture startup. The runtime is ready for a future explicit opt-in on a large Coach surface after approval.

## Identity and deliverable

The owner's latest reference is the original SVG in `src/ui/maxCharacter.ts`, restated in `MAX_AVATAR_SPEC.md`. It supersedes the earlier cloud-lobed, pupil-eyed interpretation: one blue oval shell, a large inset rounded navy visor, pupil-less pale-blue light bars with tiny top glints, light brows and curved smile, flattened navy flippers and a mint antenna. No chest light, illuminated seams, elbows or legs. The latest direction adds readable gestures and a mirror, skateboard and guitar within their own five-second routines, with no prop left visible at rest. The reference identity is approved, but this rounder 3D interpretation has not received final visual approval.

This iteration is original procedural geometry derived from the SVG paths and palette. The closed egg has circular cross sections, with depth matching width instead of a shallow slab, and depth-aware face geometry. It is not an image placed on a plane, a sequence of flat sprites, or an externally purchased character.

- Editable source: `scripts/build-max-3d.mjs`.
- Rebuild: `node scripts/build-max-3d.mjs`.
- Actual asset: `public/brand/max-rig-v1.glb`.
- Asset inventory and approval state: `public/brand/max-rig-v1.json`.
- Current content revision: manifest version 3, retaining the `max-rig-v1` filename for loader compatibility; `approved: false`.
- Geometry: 18,712 triangles, 1,066,568 bytes and 3 serialized shared materials, with no textures or external dependencies inside the GLB. The oval uses the SVG's cubic outline with a round loft. Curved visor and eye surfaces follow that volume with separate depth offsets to avoid intersections; both curved and straight boundary segments are subdivided before projection. Twelve clips carry explicit reset tracks for the complete animated hierarchy; constant tracks use just two samples.
- Rig: rigid transform hierarchy. It is intentionally not a skinned character or human skeleton. The arm pivots do not add elbow joints.
- External source assets: none. This deliverable uses the project's original SVG paths and primitive geometry, with no third-party mesh or texture rights dependency.

The unchanged normal-product fallback is the existing SVG. Legacy raster files `public/brand/max-avatar.png` and `.webp` remain available but are not the geometry source. The old `max-avatar-v1` image inventory is not present in this checkout.

## Matte rendering contract

The GLB uses `KHR_materials_unlit`: one authored vertex-colour palette, one translucent mint antenna halo and one translucent hover shadow. The runtime uses `MeshBasicMaterial` and `NoToneMapping` to preserve the blue and visor gradients without glossy lighting or exposure-dependent colour changes.

The shell retains the exact authored front shade and eases into the darker rear shade by angle using smoothstep, not a front/back hemisphere switch. Both side boundaries meet in value and slope. Asset tests check identical colours at duplicate seam vertices and bounded adjacent angular colour changes; the shading fix adds no geometry, material or byte overhead.

Only the shell material is cloned at runtime to add the original upper-left ellipse highlight in the fragment shader. Its SVG-space centre is `(57, 34)`, radii `(21, 12)` and white opacity `0.32`. The analytic ellipse is antialiased in the shader and limited to the front surface, avoiding a stepped per-vertex highlight. This means 3 serialized materials and 4 live material instances after that clone, all disposed on teardown. The metadata travels with the shell in the GLB, but the analytic highlight is implemented by this runtime; a generic GLB viewer is not guaranteed to reproduce it. All remaining geometry and gradients are self-contained.

## Coordinate and clip contract

Metres, Y up, front facing positive Z. SVG coordinates map at 0.023 metres per SVG unit, centred on `(75, 79)`. `MaxRoot` is the hover translation; `Body` owns body orientation; the rigid `Face`, `Eyes`, `Brows`, `Mouth`, `ArmLeft`, `ArmRight` and `Antenna` children share a common neutral pose. The arm-named nodes animate flattened flippers, not jointed limbs. `MouthSmile` and `MouthOpen` are separate groups: the latter contains an actual oval cavity, rim and inner light, not a stretched smile. Its neutral scale is zero, while `MouthSmile` has unit scale. Each clip restores all animated positions, rotations and scales, including hidden props and the relaxed quiet expression. Sampled contact tests verify the mirror grip and guitar fretting/strumming contacts. No clip translates the character away from its stage.

| Clip | Seconds | Behaviour |
| --- | ---: | --- |
| idle | 4.8 | Small hover and yaw, looping |
| listening | 4.0 | Attentive lean, light bars and flipper response, looping |
| thinking | 4.5 | Thoughtful turn and brow expression, looping |
| speaking | 3.2 | Nod with separately opening mouth geometry, looping |
| celebrate | 2.4 | Lift and flipper response, then previous base state |
| quiet | 1.0 | Constant relaxed expression, render once after transition |
| wave | 3.2 | Greeting gesture, then previous base state |
| shocked | 2.4 | Brief surprised expression, then previous base state |
| angry | 3.0 | Brief expressive response, then previous base state |
| mirror | 5.0 | Held mirror routine, then previous base state |
| skate | 5.0 | Bounded skateboard routine, then previous base state |
| guitar | 5.0 | Guitar routine, then previous base state |

Samples start and finish at matching transforms, with finite times and values. Every clip writes the complete animated transform set so a previous expression or prop cannot leak into the next state. Tests check those seams and the asset budget. Browser review must still check perceived continuity and crossfades. Speaking is a visual state; selecting it does not itself play audio and must not be represented as a connected Coach voice engine.

## Runtime and lifecycle

`mountMax3D(stage, initialState?, { playful?: boolean })` returns `destroy()`, `setAnimation(state)`, `setView(view)`, `setPlayfulEnabled(boolean)` and `setSpeechLevel(number | null)`. Call it only after an explicit request on a large post-report Coach surface. Keep the existing `.mx-svg` inside the stage as the fallback and call `destroy` before removing or replacing the surface. The development preview includes front, three-quarter, side and back turnaround views. State, view, playful preference and speech level selected during either the dynamic import or asset request are replayed from their latest values when creation finishes.

That API is a future integration contract, not a release approval. Currently only the development preview calls it; normal production surfaces remain SVG.

The thin launcher imports neither Three nor the GLB until the stage is at least 88 by 88 pixels, visible, connected, in a foreground document, and the device does not request reduced motion or data saving. One mount owns the renderer; mounting another releases the previous surface. The renderer is a separate dynamic chunk. The development preview exposes all twelve states and a Return to static button. Embedded browsers without IntersectionObserver use visible viewport bounds instead of remaining indefinitely asleep. Assets missing a required clip fail to SVG rather than silently displaying an unanimated character.

The drawing buffer is bounded to a 640 CSS-pixel longest edge, at most 1.5 device pixel ratio, with at most 30 rendered frames per second. There are no shadow maps, bloom, postprocessing, image textures or physics. Geometry, original and cloned materials, and renderer are explicitly disposed. The mixer releases its root. A removed surface, cancelled load, context loss or rendering failure returns to the SVG and cannot leave a hidden renderer running. Hidden/offscreen surfaces schedule no animation frames. The quiet state stops its frame loop after blending to its constant relaxed pose. The camera has a minimum half-height of 2.15 metres, allowing space for the bounded flipper and prop gestures.

### Visible-time routines and transitions

Automatic routines are enabled by default in this prototype. Only idle and thinking accumulate eligible visible animation time. Their waits vary deterministically through 6, 8, 10 and 7 seconds; the routine rotates through mirror, skate and guitar without adjacent repeats. Each automatic routine lasts five visible animation seconds, then returns to the requested idle or thinking state. Listening, speaking and quiet never schedule playful interruptions. An explicit state request immediately interrupts any automatic routine, including a request for the same base state. Explicit one-shot gestures return to the last stable base state when their own clip ends. Turning playful behavior off cancels an automatic routine, but does not cancel an explicitly selected showcase gesture.

There are no routine or quiet-state timers. Frame deltas drive the scheduler, clip mixer and 0.28-second transition cleanup together. Hidden/reduced-motion/data-saving pauses reset the frame timestamp, so background wall time cannot advance a routine or its blend. At most two actions are active during a transition; an interrupted older fade is stopped immediately, and the final outgoing action is stopped after its visible blend. Reusing a clamped one-shot resets its time and pause state. Completion of a faded action cannot replace a newer requested state.

### Speech-level hook

`setSpeechLevel(level)` accepts an amplitude from zero to one; finite values outside that range are clamped and non-finite values select the default authored loop. It does not request microphone permission, read audio, synthesize speech or integrate with Coach audio. `null` uses the authored speaking animation. A future approved audio integration may supply amplitude samples, but the runtime alone is not lip-sync or phoneme alignment.

When a non-null level is supplied while speaking, bounded exponential smoothing drives `MouthOpen` and hides `MouthSmile` while the mouth is open. They are separate geometry groups, not an enlarged smile line. The override is applied after the mixer, and the prior authored transforms are restored before the next mixer update. Returning to null or any other state therefore restores that clip's own expression, including the relaxed quiet smile. Other states ignore amplitude values. Development exports disable playful scheduling and select null speech level for deterministic authored examples.

The SVG is not just made invisible: when the first real frame appears its CSS animation, idle scheduler and pointer tracking are suspended through the shared motion controller. They resume when the fallback is restored. Small chat avatars never create a context.

The approach follows the official [rendering-on-demand guidance](https://threejs.org/manual/en/rendering-on-demand.html), [resource cleanup guidance](https://threejs.org/manual/en/cleanup.html), [GLTF exporter](https://threejs.org/docs/pages/GLTFExporter.html) and [GLTF loader](https://threejs.org/docs/pages/GLTFLoader.html). The exact runtime dependency is pinned in the package lock.

## Local example videos

The development-only `?preview=max3d` page provides three silent 12-second examples: idle/listening/thinking, speaking/celebration/listening, and turnaround views including quiet. Each export composites actual rendered WebGL frames into a labelled 576 by 576 canvas and records locally with `MediaRecorder`. The browser chooses a supported MP4 or WebM format; an offline conversion may be needed for a final MP4 deliverable. No photo, account data or rendered video is sent to a provider.

Readiness, recording and recorder-stop waits are finite. Cancel, hidden-page, context-loss and surface-removal paths stop recording and release tracks/listeners. The frame-copy hook is development-only; no production per-frame export event is emitted. Example videos demonstrate the built geometry and clips, not approval or an iPhone performance benchmark.

## Acceptance before production opt-in or default rollout

1. Owner approves front, three-quarter, side and back silhouette against the original SVG identity. Review the smooth visor outline and upper-left highlight specifically. A polished visual pass may change this corrected iteration.
2. Review all clips and transitions at 88, 320 and 420 pixels. Verify no light-bar or visor clipping, flipper snapping, gradient flicker or loop hitch.
3. Check Return to static, route close, rapid re-open, hidden tab, offscreen scroll, reduced-motion and data-saving changes, context loss and failed asset download.
4. On a physical older iPhone, compare a five-minute report/Coach session with and without the optional character. Record CPU, memory, scroll response and thermal behaviour. Desktop browser emulation is not that evidence.
5. Only after those checks should `approved` become true or any production opt-in/default large Coach integration proceed. Capture and initial report loading remain independent in either case.

## Scan instrumentation delivered alongside this pass

`src/engine/scanPerformance.ts` keeps at most eight attempt summaries in page memory, using fixed stages and fixed outcomes. It contains elapsed rounded durations and an ephemeral counter, no absolute timestamps, pixels, landmarks, measurements, person/scan identifiers or error strings. It sends nothing, persists nothing and does not place data on a window global. `clearScanPerformance()` invalidates old handles as well as clearing the summaries. Attempt finish/cancel/eviction prevents late callbacks from adding records, and each stage is counted once.

These diagnostics can expose a stall during a deliberate test, but do not constitute production latency evidence until measured on representative devices. Stage collection must not invent a successful outcome for pending work or turn report rerenders into fresh scans.

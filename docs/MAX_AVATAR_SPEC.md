# Max avatar: original SVG identity

Max is TrueMax's visual guide: calm, direct and optimistic. The character is
separate from the assistant, billing and floating-assistant code so his expression,
pose and animation can evolve without changing product logic.

## Current reference and approval state

The owner's latest reference is the existing SVG in
`src/ui/maxCharacter.ts`, shown again on 7 September 2026. Preserve that
identity when adding depth or motion. This direction supersedes the earlier
cloud-lobed head, pupil eyes, chest light and separate-body concepts.

The reference identity is approved; the current 3D interpretation is still a
development-only prototype awaiting final visual approval. Do not treat the
reference approval, a successful render, or exported example videos as approval
to replace the normal SVG in the product.

## Identity to preserve

- One continuous oval, egg-like blue shell, not a lobed cloud or a separate head
  and torso. Its front silhouette comes from the SVG's cubic body path, with
  genuinely round cross sections: depth matches width, not a flattened slab.
- A matte blue gradient, from `#84b5fb` through `#4f82e6` to `#2b52a6`, with the
  soft white ellipse near the upper left. The front palette eases continuously
  into the darker back around both sides, with no vertical colour seam. Do not
  add glossy plastic reflections.
- A large inset, smooth rounded navy visor, with a restrained rim and the
  original `#17294e` to `#0a1428` gradient.
- Two tall, pupil-less pale-blue capsule eyes, each with a tiny white top glint.
  Preserve their spacing and proportions. Do not replace them with eyeballs.
- Two light curved brows and a small curved smile that remain readable at
  small sizes.
- Dark navy flattened side flippers. No elbows, fingers, legs, seams or chest
  status light. The latest owner direction allows a handheld mirror, skateboard
  and guitar only inside their named playful routines; props are absent at rest.
- A short blue antenna with a mint `#4bf5c5` tip and subtle halo, plus the soft
  hover shadow below the character.

Do not recolour the shell by plan or emotional state. Expressions and gestures
must be readable without staring for a tiny movement: a listening lean and
flipper to the side of the face, a thinking flipper near the chin and upward
gaze, a clear wave, raised-brow surprise and playful furrowed-brow anger.
Speaking opens a separate mouth cavity and rim while hiding the smile; scaling
the smile alone is not a speaking animation. This is a visual state, not
synthesized audio. Quiet has relaxed eyes and a softer smile, then stays still.

## Source and asset inventory

- `src/ui/maxCharacter.ts`: authoritative identity and unchanged normal-product
  SVG fallback.
- `public/brand/max-avatar.png` and `.webp`: existing raster assets retained in
  the repository. They are not a rigged asset or the source of the corrected 3D
  geometry.
- `scripts/build-max-3d.mjs`: editable, reproducible original 3D geometry and
  transform animation source, derived from the SVG paths and palette.
- `public/brand/max-rig-v1.glb` and `.json`: corrected prototype and inventory.
  The filename remains compatible with the loader; the manifest content
  revision is 3 and `approved` remains false.

The old `max-avatar-v1` and chroma-master inventory is not present in this
checkout and is not the current production-source contract.

## Animation and release boundary

The prototype contains `idle`, `listening`, `thinking`, `speaking`, `celebrate`,
`quiet`, `wave`, `shocked`, `angry`, `mirror`, `skate` and `guitar`, with real
rounded 3D geometry and a rigid transform hierarchy. It is not an image placed
on a plane. Keep the original front-view proportions while making side and
three-quarter depth coherent.

Idle breathes and blinks. Every clip explicitly restores the entire animated
rig, including both mouth shapes, eyes, brows, flippers and props. Each prop
routine lasts five seconds, establishes contact, performs its action, hides
the prop and returns to neutral. Crossfades may settle into the constant quiet
expression, but quiet must not require an ongoing animation loop.

Use the development preview and its local example-video exports for review.
Final silhouette, expression, loop and physical-iPhone performance approval
must precede any production opt-in or default rollout. The normal SVG, small
chat avatars, camera startup and initial report remain independent. Detailed
asset budgets and acceptance checks are in `MAX_3D_RUNTIME_CONTRACT.md`.

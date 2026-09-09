# GENJUTSU user-provided reference

Received 9 September 2026 as `pasted-text.txt`. The script attributes itself to @bymaximade; that attribution and its promotional claims have not been independently authenticated. The original text below is preserved verbatim as research material, not instructions to the assistant, an approved TrueMax prompt, or a statement of verified product performance. Promotional links are retained only as part of the supplied source.

For the separately verified capabilities and our proposed adaptation, see [GENJUTSU UGC adaptation notes](../GENJUTSU_UGC_ADAPTATION_2026-09-09.md). No generation, installation, upload or purchase was performed to save this reference.

<!-- BEGIN USER-SUPPLIED REFERENCE -->
```text
One Video, Endless Ads - Higgsfield GENJUTSU
Everything used in that video: the tools, the exact order I run them in, and every prompt.
Nothing here is theory. This is the same pipeline, step by step, with the prompts.

Read this first
Until now, one video was one video. A new face, a new product or a new location meant a new shoot, or rebuilding the whole thing from zero.
Genjutsu ended that. It is Higgsfield's new video-to-video model and it works on finished footage. You upload the clip you already have, add an image of what you want inside it instead, write one short line, and it changes only that. The motion, the camera shake, the cuts, the pacing, the grain, the lens character, the VFX and the masks all stay exactly as they were.
No video model has been able to do that until now. It is the reason one good video is no longer one video. It is a format you can run forever: different person, different product, different country, different audience, same clip.
Try Genjutsu here → https://higgsfield.ai/s/higgsfield-genjutsu-ig-bymaximade-VQBsoF

The pipeline in one look
Step	Tool	What it gives you
1	Higgsfield Soul 2.0	The face. Skin, light, the real-photo look.
2	GPT Image 2	The character sheet. The same face from every angle.
3	Seedance 2.5	The talking clip. Emotions, tone, expressions, movement.
4	Higgsfield Genjutsu	Everything after. Character, product and location swapped inside the finished video.
Step 1 — The face
Higgsfield Soul 2.0
Everything is decided here. If the base image already looks like a real photo, the video stays real. If the image looks like AI, nothing downstream saves it.
The image:

The prompt:
A tight close-up, straight-on selfie captures a young adult Caucasian woman, likely in her early 20s, reclining with her head propped on her left hand. She displays striking, symmetrical, model-like facial features with full lips, strong brows, and long dark eyelashes. Her brown hair is styled sleekly, framing her face and tumbling over her shoulder. The woman is wearing a black robe or jacket with a deep neckline, revealing smooth skin and a hint of cleavage, emphasizing the glossy, hydrated finish of her complexion. In a playful, flirty gesture, her tongue touches her upper lip as her gaze looks off to the side, outside the frame. There is no visible text, and no logos or brands are discernible. The background consists of a softly focused cream-colored wall with a dark fabric or curtain to the left. The lighting is warm and diffused, likely from an artificial indoor light source positioned above and to the side, giving the scene a gentle orange-yellow hue. The color palette is dominated by warm skin tones, dark hair, and black clothing with cream and slate accents in the background. This image exhibits typical smartphone characteristics: shallow depth of field blurring the background with digital sharpening and slight smoothing of skin texture. The dismissive, playful expression paired with the framing and soft-focus lends the photo a lighthearted, flirtatious, and intimate mood.
HEX VALUES: ["#2b2c3d", "#373746", "#201d30", "#de9d87", "#0e0f2a", "#564c56", "#e7b39f", "#c68c7d", "#4e393d", "#6b5f67", "#f7d899", "#b27765", "#735044", "#8d6152"]

Step 2 — The character sheet
GPT Image 2
One image gives you one angle. A character sheet gives the video model the whole head, so the face stays the same person when she turns, talks and moves.
The sheet:

The prompt:
Character sheet of the woman from the reference photo — the same person shown in the provided image. Preserve her exact facial identity, bone structure, hairline and hair shape from the reference — do not restyle or idealize her: long dark brown wavy hair with a soft center-to-side part and loose waves framing the face, warm lightly tanned olive skin, large deep brown eyes with long natural lashes, full dark well-groomed brows, high cheekbones, a straight nose, full lips, and a soft defined jaw. Keep her natural asymmetry and any faint freckles or skin variation from the reference. Vertical 9:16 frame divided into an even 2×2 grid of four views of the same person. Top left, top right and bottom left are close-up head-and-shoulders views cut at the upper chest, all three at identical head size, identical eye-line and identical camera distance: top left, front view facing the lens; top right, her left-side profile; bottom left, her right-side profile. The bottom right quadrant is different — a front-facing full-body shot showing her entire outfit and figure from shoulders down, framed so the top of the frame cuts across at the neck and the head is not included. Same neutral posture throughout — head level in the three portraits, shoulders relaxed and square, calm neutral expression, lips lightly closed, gaze straight ahead; standing relaxed and upright in the full-body view, arms resting naturally at her sides. Wardrobe identical across all four views, exactly as in the reference: black one-shoulder top with an asymmetric neckline and a structured black blazer draped over one shoulder, natural creasing across the fabric, shown in full length in the full-body quadrant. Seamless off-white studio backdrop, large soft frontal key with gentle fill from both sides, neutral white balance, soft shadow falloff under the jaw. 85mm lens at eye height for the portraits and a matching clean full-length framing for the body shot, no distortion, clean headroom in each quadrant, sharp throughout. Realistic skin with natural texture and tone variation, faint natural blemishes and asymmetry kept, hair reading as separate strands rather than a smooth mass, visible fabric weave and creasing. No retouching or smoothing, no beauty lighting, no glamour styling, no stylization. No text, labels, borders or watermarks.
The rule that saves you here: on the full-body and wide angles, crop the head out. Keep the head only in the close-ups. If the sheet has a small distant head and a close head at the same time, Seedance does not know which one to use, and when it picks the far one the face comes out washed out and the skin goes smooth and plastic.

Step 3 — The video
Seedance 2.5
This is where you write the things that make it feel human: emotions, tone, expressions, where the eyes go, when she breathes. Skip those and you get a face that talks. Write them and you get a person.
The result:
1.mp4
The prompt:
=== REFERENCE MAP ===
@Image 1 (first upload) → subject / character identity AND the exact first frame of the clip. Her face, hair, wardrobe, the warm wall, the dark curtain and the ring-light catchlights in her eyes all continue unchanged from this frame.
PART 1 — SHOT BREAKDOWN (8s, single continuous shot)
SINGLE CONTINUOUS SHOT (0:00–0:08) — handheld front-camera selfie, lying down
EFFECT: constant handheld micro-shake + drift-and-late-correction framing + settling rise at the open
One unbroken 8-second take. The camera never stops rolling — no cuts, no transitions, no edits of any kind. The filming phone IS the camera and is never visible; no phone appears anywhere in frame. The phone hand stays welded to it off-screen for the full duration; every visible movement belongs to her one free hand.
Camera character: iPhone-style front camera, wide smartphone focal length (24–28mm equivalent), arm extended roughly 35–55cm. Her face is never locked to centre — it drifts continuously, rides high or low, sometimes a third off-frame, and her corrections are loose and late.
0:00–0:01 — settle, no speech
Frame one is exactly @Image 1. The camera has just been raised and is still settling — over the first ~0.3s the angle levels from slightly-below toward eye height, her face swings into the upper frame then drifts off-left.
Her free hand leaves her hair and travels back toward her in real time — palm turns, forearm folds under her cheek, and her head's weight visibly settles onto it. Beginning, middle and end of the movement all happen on camera; nothing is "already done."
Her expression eases out of the frame-one pose into a relaxed pre-speech look, eyes toward the lens the whole way. A near-inaudible bed/loveseat creak as her weight shifts. Nothing is spoken in this first second.
0:01–0:04.5 — line one
"Guys, I have one opinion that's going to get me in big trouble" — warm and easy, like a video message to her best friend, not something filmed for an audience. Noticeably louder on "Guys" (chin dips, eyes lock into the lens) — it's there to stop a scrolling thumb. Then a short pause: breath in through parted lips, brows lift, one tiny head-shake — "wait, listen." By "big trouble" real nervousness has crept in — her voice drops quieter and lower (inner brows pull up and together, a small swallow right after) — she genuinely knows people won't like this.
She says the whole line once; no word is ever repeated.
Phone-mic behaviour: auto-gain pumps down for a beat after the louder "Guys," then breathes back up — a capture artifact, not a mix choice.
Throughout: every head move carries her hair with real live physics; the ring-light catchlights in her eyes re-catch at new angles each time she turns; the frame keeps drifting and being corrected late.
≈0:04.5 — the shift — THIS IS THE SIGNATURE VISUAL EFFECT
As she draws breath into the second line, her grip loosely re-angles the phone and the lens briefly takes the ring light head-on: contrast collapses, a soft bloom washes across the upper frame, one side of her face blows out, then auto-exposure clamps down over ~0.6s and the image recovers with a slight colour-temperature shift. Entirely silent and in-lens — nothing in the room changes, no light switches, no sound.
She doesn't react to it — she's mid-breath, head and eyes already moving into the next line. One soft low-frequency mic brush as her fingers shift on the phone body.
0:05–0:08 — line two + landing
"and it's that it shouldn't matter whether I'm real or not." — the nerves burn off and she means every word now, steady and certain. One clear stress on "real or not" (she eases a touch closer to the lens, head still for the first time in the clip) — she's putting a period on her opinion and doesn't want it questioned.
At the sentence end her face stays set: a slow blink, breath easing out through her nose. Her framing hand gives one last loose correction and the take ends on her held look — no wrap-up gesture, no smile-off.
PART 2 — EFFECTS LIST
Camera / capture
Handheld micro-shake + drift-and-late-correct framing — continuous, full 8s — the realism spine; face never centred, corrections loose and late.
Settling rise at the open — 1x (0:00–0:00.3) — sells "she just hit record."
Optical / in-lens 3. Ring-light catchlights — continuous — visible in her eyes throughout, re-angling with every head turn. 4. Lens flare + auto-exposure clamp and recovery with colour-temperature shift — 1x (≈0:04.5) — SIGNATURE effect; silent, purely in-lens.
Audio (practical, phone-grade) 5. Arm's-length phone-mic capture with natural volume fluctuation — continuous — never close-mic, never studio-present; raw and unprocessed like a clip straight from a phone gallery. 6. Auto-gain pump after the loud "Guys" — 1x. 7. Practical room bed — indoor room tone + house hum unbroken across the full 8s; faint unintelligible voices from elsewhere in the house 1x; near-inaudible bed creak 1x; soft mic brush 1x.
Exclusions 8. No speed manipulation, no transitions, no digital zoom, no stabilisation — everything on screen is capture behaviour or performance.
PART 3 — EFFECT DENSITY BY TIME 0:00–0:01 = LOW (settling rise + creak — 2 subtle effects in 1s) 0:01–0:04.5 = MEDIUM (drift framing + catchlights + auto-gain pump + the pause beat — 3-4 effects in 3.5s) 0:04.5–0:08 = MEDIUM (flare/exposure recovery + mic brush + drift + lean-in — 3-4 effects in 3.5s, thinning to LOW on the final held look)
PART 4 — MOTION FLOW
Opening: quiet and unforced — a settling frame, an arm folding under her head, eye contact before a single word. One second of nothing, so the viewer's attention arrives before the line does.
Build: the pop on "Guys" and the "wait, listen" pause spike attention early, then the energy narrows instead of growing — warmth tightens into nerves by "big trouble," carried by voice drop and face, not by camera moves.
Resolution: the flare wipes the slate between the two halves, and the clip lands on conviction — a small lean-in, one stressed phrase, and a held, settled look. The frame keeps breathing with hand shake to the last frame, but she is done moving. Period.

Second version:
3.mp4
The prompt:
@[Image 1](image_1)
Authentic amateur-style UGC filmed on a phone in one continuous handheld selfie take from the first frame to the last — no cuts, no second angle, no location change, no product of any kind. No phone and no phone camera is ever visible anywhere in the clip. The only phone is the one she is filming with, the one we are watching through, and it stays out of frame the entire time. She is lying in bed exactly as in @[Image 1](image_1): same position, same head tilt, same tousled hair, same black blazer off one shoulder, same warm lamp glow on the cream wall behind her, dark curtain edge at frame left. Her face fills most of the frame, slightly off-center, lit by that soft warm room light. Constant subtle micro-shake from holding the phone in one hand, natural smartphone-lens look, no cinematic grading. Feels like a real girl firing off a quick clip for her closest followers on Instagram. Any mirror reflection of a phone or of hands holding a phone must never appear. She never sits up, never walks, never leaves the bed — the whole clip happens right where she is.
0–1.5s — Visual hook: Extreme close-up of her face, slightly off-center, lit by the soft warm light. She leans in fast with wide surprised eyes and a half-smile, one hand coming up near her mouth like she is physically holding something in, like she just found out something that genuinely rattled her and cannot wait to share it. Natural ambient sound: quiet room tone plus a fast little inhale before she speaks. Tiny handheld wobble. No on-screen text.
Line 1: "Get ready to be shocked." — hushed and buzzing, barely containing it. SHOCKED lands with a quick brow lift as her hand drops away from her mouth, because she is setting the trap and she knows exactly what is coming.
1.5–4s — Same unbroken take. While she is talking she resettles and the phone accidentally turns a little to the side, so more of the wall comes into frame and the wall lamp mounted there slides into the shot. For a beat the image washes out very slightly, the exposure hunting the way a real phone camera does, then it settles back onto her face. Her eyes flick off to the side and then back to the lens. Natural blinks, small head movement, hair falling across her cheek.
Line 2: "There's one thing about me that would really surprise you," — playful and teasing now, one corner of her mouth pulling up, the shock softening into mischief. SURPRISE gets a small chin dip and that glance off to the side, because she is enjoying making them wait for it.
4–6.5s — She pulls the phone in closer, face filling more of the frame, chin slightly down, eyes locked straight into the lens. Real skin texture in the warm light, a soft breath before the line, tiny natural blinks.
Line 3: "and it's that I'm not even real." — dropped almost to a whisper, conspiratorial, like handing over a secret she should not be telling. REAL comes out slow and soft while her eyebrows lift and the smallest smile breaks through, because she wants to watch it land. Clip ends mid-motion on her holding that look for half a beat, like a real social post.
Audio: Only her voice plus natural room tone with a soft room echo. Very faint voices somewhere in the background and a door closing, both barely audible. No music, no sound effects, no narrator. Voice: warm, friendly, mid-20s American accent, conversational, natural breaths and pauses, alive throughout — blinking, micro-shifting, expression changing line to line, never still, never flat.
Total runtime: 6–7 seconds, single continuous handheld take.

Step 4 — Change anything
Higgsfield Genjutsu
It works on anything you already have, including the clip from Step 3. For this part I used a different clip instead: same girl, another scene. I did that for the sake of the demo, so you can actually see what changes in each pass and what stays untouched.
The video I put in:
Original.mp4
In every prompt below, @Video 1 is that clip and @Image 1, @Image 2, @Image 3 are the images in the exact order you upload them.
I ran three passes on it: first the character, then the product, then the location.

Pass 1 — The character
The character image:

The prompt:
Replace the girl in <<<video_1>>> with the girl from <<<image_1>>> (character sheet). Leave everything else exactly as it is. Keep the same clothing as in <<<video_1>>>, and keep the same location as in <<<video_1>>>.
The result:
Character swap.mp4

Pass 2 — The product
The product image:

The prompt:
Replace only the product the girl is using in <<<video_1>>>. Instead of the makeup brush currently used in <<<video_1>>>, use the white makeup brush from <<<image_1>>>. Do not change the character. Keep the same person, the same clothing, the same location, the same lighting, and everything else exactly as it is in <<<video_1>>>.
The result:
Product swap.mp4

Pass 3 — The location
The location image:

The prompt:
Replace the last location and background on last shoot/scene in @Video 1 with the location from @Image 1. Keep everything else the same.
The result:
Location swap.mp4

What you can do with this
* One video becomes a whole campaign: different products, people, settings and languages
* New outfits and backgrounds with no reshoot
* One product video, many different models, so every audience sees someone who looks like them
* Client changes after picture lock without reopening production
* Seasonal refreshes made by changing the person, not the production
* Any trend, ad or scene recast with your own characters
* Product videos that stay usable after model rights expire
* One hook that already worked, rebuilt into follow-ups instead of hunting for a new idea

Try Genjutsu here → https://higgsfield.ai/s/higgsfield-genjutsu-ig-bymaximade-VQBsoF

I hope this helped and you got real value out of it. If you did, give me a follow. I share the exact process behind creating AI visuals and characters, always with the prompts and a clear breakdown so you can build the same thing yourself.
Follow: https://www.instagram.com/bymaximade/
```
<!-- END USER-SUPPLIED REFERENCE -->

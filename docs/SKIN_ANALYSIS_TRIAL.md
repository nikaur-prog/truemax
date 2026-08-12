# TrueMax visible-skin analysis trial

Updated 12 August 2026.

## Product boundary

TrueMax may screen a valid, unfiltered face photograph for **observable visual
patterns**. It may not diagnose acne, rosacea, eczema, infection, melasma,
vitiligo or skin cancer from a selfie. These conditions overlap visually and
may require symptoms, history, palpation, dermoscopy or laboratory testing.

The user-facing language must therefore be:

- “visible inflamed-spot pattern,” never “you have acne”;
- “visible redness pattern,” never “you have rosacea”;
- “visible flaking or scaling,” never “you have eczema”;
- “uneven colour,” never “melasma” or “vitiligo”;
- “changing or non-healing spots need a clinician,” never a benign/malignant
  prediction.

The complete observable catalogue and safe action ladder live in
`src/engine/skinConcernCatalog.ts`.

## Complete facial concern map

“Every blemish” is not a medically valid model class. The trial instead covers
the visible families below and preserves uncertainty where different conditions
look alike.

| Visible family | Included appearances | Trial status |
|---|---|---|
| Blocked-pore appearance | black dots, pale pore-centred bumps, closed/open-comedone-like patterns | trial after labelled data |
| Inflamed spots | papule-, pustule- and follicle-centred bump patterns | trial after labelled data; never call nodules/cysts from pixels |
| Milia-like bumps | tiny firm pale bumps around eyes/cheeks | trial after macro-quality data |
| Pores and filaments | visible openings and regularly spaced oil-prone dots | self-report until camera artefacts are controlled |
| Redness and vessels | diffuse colour change, patches, flushing appearance, small visible vessels | trial only with controlled colour and skin-tone validation |
| Dryness and scale | flakes, fissures, rough patches, central-face or hairline scale | visible scale may be trialled; cause stays self-report/clinical |
| Post-blemish colour | flat red, purple or brown marks | trial only with user history |
| Uneven pigment | darker or lighter flat patches, freckle/sun-spot-like pattern | self-report/clinical; no diagnosis from auto white balance |
| Scar texture | indented, raised or thickened texture | trial requires multiple lighting angles and history |
| Oil and shine | central-face reflection | self-report until polarised/controlled light is available |
| Razor-bump pattern | hair-centred bumps after shaving, waxing or plucking | self-report plus visible trial; folliculitis is a look-alike |
| Under-eye appearance | shadow, colour difference and puffiness | trial with repeated diffuse-light captures |
| Fine lines/photoageing | resting fine lines and rough sun-related texture | trial with fixed resolution and neutral expression |
| Lip surface | chapping, flaking and fissures | trial; persistent or one-sided sores escalate |
| Acute rash/infection signs | spreading redness, blisters, crust, ooze, marked swelling | clinician-only; never a model label |
| Isolated/changing lesion | mole, growth, crust, irregular or non-healing spot | clinician-only; never cleared by TrueMax |

## What the current engine actually measures

`src/engine/skin.ts` produces five broad image statistics: local tone spread,
redness spread, chroma spread, texture and under-eye brightness. It does not
localise or count individual lesions and it has no validated condition labels.
Existing offline testing found only the under-eye ratio repeatable enough to
report; the colour metrics were dominated by photography. None currently earns
a blemish label or contributes to the overall face score.

## Required data before a blemish classifier ships

1. Obtain a consented, licensed facial-skin dataset with lesion masks or boxes,
   dermatologist labels, age bands and balanced representation across skin
   tones. Public-figure photographs are not a skin ground truth.
2. Reserve subjects—not photographs—for training, validation and holdout sets,
   so another photo of the same person cannot leak into evaluation.
3. Capture at least two controlled images per participant to measure
   repeatability. Include deliberate changes in phone, exposure, white balance,
   distance and compression.
4. Train only the observable classes in `TRIAL_DETECTABLE_SKIN_CONCERNS`.
   Clinician-only categories remain escalation rules, not model labels.
5. Report lesion-level sensitivity, precision, false positives per face,
   calibration and subgroup results by skin tone, sex and age band.
6. Require human review for every proposed user-facing class until each class
   meets its gate on the locked holdout set.

## Proposed acceptance gates

- Photo eligibility must pass before skin processing: straight frontal pose,
  full face, neutral expression, even exposure, sufficient sharpness and
  resolution, no glasses, hat, hood, mask, beauty filter or portrait blur.
- Each finding needs confidence plus an “image may be affecting this” state.
- Proposed per-class target before user display: sensitivity ≥ 0.85, precision ≥ 0.80,
  repeat-photo agreement κ ≥ 0.70, and no subgroup more than 0.10 below the
  overall sensitivity or precision.
- Below threshold, show “unable to assess,” never “clear.” Absence of detection
  is not proof of healthy skin.
- No skin output changes the structural attractiveness score.

## Photo-validation state

Front file uploads now use the same pose, exposure, sharpness and occlusion
standard as the guided camera and reject low-resolution/cropped images. Profile
uploads must pass a 75° detector gate when the frontal mesh survives and an
independent conservative silhouette check; when a true profile makes the mesh
disappear, the silhouette check still applies. Failure gets a specific retake
instruction rather than a score.

Hats and hoods are now checked on-device with MediaPipe's multi-class selfie
segmenter after the cheaper pose/exposure/focus gates pass. Its classes
distinguish hair, face skin, clothes and accessories, so TrueMax no longer
tries to infer fabric from shadows. The model is lazy-loaded (16.4 MB), pinned
by SHA-256 and self-hosted. The spatial thresholds are a trial gate and still
need a labelled hats/hoods/bare-hair benchmark, especially for religious
headwear, textured hair, bald heads and diverse skin tones.

## Medical-safety rules for recommendations

- Default baseline: gentle fragrance-free cleanser, non-comedogenic
  moisturiser and broad-spectrum SPF 30+.
- Recommend one active at a time, patch testing, label directions and a stop
  rule for irritation.
- OTC availability varies by country. Adapalene is OTC in the US but not
  everywhere and topical retinoids are not for pregnancy.
- Diet guidance is optional and modest. Do not prescribe restriction,
  supplements, calorie targets or claim that one food caused a condition.
- Deep painful/scarring lesions, eye involvement, spreading rash, infection
  signs, significant swelling and changing/bleeding/non-healing lesions route
  to a pharmacist, GP or dermatologist without a product recommendation.

## Authoritative sources used for the catalogue

- [AAD: treating different types of acne](https://www.aad.org/public/diseases/acne/diy/types-breakouts)
- [AAD: adult acne OTC treatment](https://www.aad.org/public/diseases/acne/diy/adult-acne-treatment)
- [AAD: rosacea diagnosis and treatment](https://www.aad.org/public/diseases/rosacea/treatment/diagnosis-treat)
- [AAD: dry-skin care](https://www.aad.org/public/everyday-care/skin-care-basics/dry/dermatologists-tips-relieve-dry-skin)
- [AAD: seborrheic dermatitis self-care](https://www.aad.org/public/diseases/a-z/seborrheic-dermatitis-self-care)
- [AAD: razor-bump remedies](https://www.aad.org/public/everyday-care/skin-care-basics/hair/razor-bump-remedies)
- [AAD: hyperpigmentation and tinted sunscreen](https://www.aad.org/public/everyday-care/skin-care-secrets/routine/fade-dark-spots)
- [AAD: skin-cancer warning signs](https://www.aad.org/public/diseases/skin-cancer/find/know-how)
- [FDA OTC sunscreen monograph](https://www.accessdata.fda.gov/drugsatfda_docs/omuf/monographs/OTCMonograph_M020-SunscreenDrugProductsforOTCHumanUse09242021.pdf)
- [FDA adapalene OTC approval material](https://www.fda.gov/files/science%20%26%20research/published/Topical-retinoid-acne-treatment-approved-for-OTC-use.pdf)
- [Google AI Edge MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)

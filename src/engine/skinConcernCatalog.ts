// Observable facial-skin concern catalogue.
//
// This is intentionally a map from VISIBLE PATTERNS to safe next steps, not a
// diagnostic classifier. Many conditions are visual look-alikes, and several
// require symptoms, history, palpation, dermoscopy or laboratory testing that a
// phone photograph cannot provide. A future model may emit one of the
// `observable` labels only after validation; it must never emit the conditions
// listed under `couldAlsoBe` as a diagnosis.

export type SkinDetectionTier = "trial" | "self-report" | "clinician-only";
export type SkinActionType = "otc" | "routine" | "lifestyle" | "diet" | "procedure" | "escalate";

export interface SkinAction {
  type: SkinActionType;
  label: string;
  detail: string;
  caution?: string;
}

export interface SkinConcernDef {
  id: string;
  observable: string;
  couldAlsoBe: string[];
  tier: SkinDetectionTier;
  minimumEvidence: string;
  actions: SkinAction[];
}

const baseRoutine: SkinAction[] = [
  { type: "routine", label: "Gentle baseline", detail: "Use a mild fragrance-free cleanser, non-comedogenic moisturiser and broad-spectrum SPF 30+. Add only one active at a time and patch test." },
  { type: "lifestyle", label: "Do not pick or scrub", detail: "Friction and picking prolong inflammation and make marks and scars more likely." },
  { type: "diet", label: "No diagnostic diet", detail: "A balanced eating pattern and adequate fluids support general health, but a photo cannot identify a deficiency and no single food reliably clears this visible pattern." },
];

export const SKIN_CONCERN_CATALOG: SkinConcernDef[] = [
  {
    id: "comedonal-pattern",
    observable: "Small pore-centred dark or pale bumps consistent with a blocked-pore appearance",
    couldAlsoBe: ["open or closed comedones", "sebaceous filaments", "milia"],
    tier: "trial",
    minimumEvidence: "Sharp, evenly lit frontal image; repeated detection in the same facial zones; manually labelled close-up training data across skin tones.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Salicylic acid", detail: "An OTC pore-clearing option commonly used for blackheads and whiteheads; start slowly and follow the label." },
      { type: "otc", label: "Adapalene 0.1%", detail: "An OTC acne retinoid in the US; availability differs by country and improvement usually takes 6–8 weeks.", caution: "Do not use topical retinoids during pregnancy; ask a pharmacist where it is not OTC." },
      { type: "procedure", label: "Professional extraction", detail: "A dermatologist can extract persistent comedones or milia without the scarring risk of squeezing them at home." },
    ],
  },
  {
    id: "inflamed-spot-pattern",
    observable: "Discrete red, pink, purple or brown raised spots with possible pale centres",
    couldAlsoBe: ["inflammatory acne", "folliculitis", "rosacea-like papules", "perioral dermatitis"],
    tier: "trial",
    minimumEvidence: "Lesion-level labels with papule/pustule counts, skin-tone balance and dermatologist adjudication of look-alikes.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Benzoyl peroxide 2.5%", detail: "A common first OTC option for mild inflamed acne; lower strengths can work with less irritation.", caution: "Can bleach fabric and irritate skin. Stop if swelling or blistering occurs." },
      { type: "otc", label: "Azelaic acid", detail: "May help acne-like bumps and the marks they leave and is often better tolerated by reactive skin." },
      { type: "diet", label: "Diet is a secondary lever", detail: "A lower-glycaemic eating pattern may modestly help some people; no single food explains a breakout and restrictive diets are not a first-line treatment." },
      { type: "escalate", label: "Deep, painful or scarring spots", detail: "See a clinician early; OTC products are unlikely to control nodules or cysts and delay increases scarring risk." },
    ],
  },
  {
    id: "milia-like-bump-pattern",
    observable: "Tiny firm-looking pale bumps, often around the eyes or upper cheeks",
    couldAlsoBe: ["milia", "closed comedones", "sebaceous hyperplasia", "another small benign growth"],
    tier: "trial",
    minimumEvidence: "Macro-enough images, location-aware labels and dermatologist adjudication; ordinary distance selfies cannot reliably separate look-alike bumps.",
    actions: [
      ...baseRoutine,
      { type: "lifestyle", label: "Do not lance or squeeze", detail: "Trying to remove a firm bump at home can injure the thin eye-area skin and leave infection or a mark." },
      { type: "procedure", label: "Professional identification and extraction", detail: "A dermatologist can first identify the bump and, when appropriate, remove milia with sterile technique." },
    ],
  },
  {
    id: "pore-filament-pattern",
    observable: "Visible pore openings or evenly distributed dark dots in oil-prone areas",
    couldAlsoBe: ["normal pores", "sebaceous filaments", "blackheads", "camera sharpening or compression"],
    tier: "self-report",
    minimumEvidence: "Controlled close-range capture without makeup plus repeatability across phones. Normal pores and compression artefacts are too easily confused in one selfie.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Salicylic acid", detail: "May reduce material inside oily pores and blackheads; it cannot permanently change the anatomical size of a pore." },
      { type: "otc", label: "Adapalene 0.1%", detail: "Where sold OTC, it can help prevent blocked pores over time.", caution: "Do not use topical retinoids during pregnancy; availability differs by country." },
    ],
  },
  {
    id: "redness-pattern",
    observable: "Persistent or patchy facial colour change and visible small vessels",
    couldAlsoBe: ["temporary flushing", "irritation", "rosacea", "dermatitis", "sunburn", "lupus rash"],
    tier: "trial",
    minimumEvidence: "Colour-calibrated images or repeated same-device captures; validation across skin tones and lighting; symptom questions for burning, heat and triggers.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Azelaic acid", detail: "An OTC-strength option in some countries for redness and acne-like bumps; introduce slowly." },
      { type: "lifestyle", label: "Track personal triggers", detail: "Sun, heat, alcohol, spicy food, wind, exercise and irritating products are common flushing triggers, but they differ by person." },
      { type: "procedure", label: "Vascular laser or IPL", detail: "A dermatologist may use laser or intense pulsed light for persistent visible vessels after confirming the cause." },
      { type: "escalate", label: "Eyes involved or persistent central redness", detail: "Seek a clinician; rosacea and its look-alikes need different treatment, and eye symptoms can affect vision." },
    ],
  },
  {
    id: "dry-flaky-pattern",
    observable: "Visible scaling, flaking, cracking or rough patches",
    couldAlsoBe: ["dry skin", "irritant or allergic contact dermatitis", "eczema", "seborrheic dermatitis", "psoriasis", "fungal infection"],
    tier: "trial",
    minimumEvidence: "Sharp macro-enough images plus self-reported itch, pain, products and duration; dermatologist-labelled differential set.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Fragrance-free cream or ointment", detail: "Apply to damp skin after washing and whenever dry; creams and ointments generally protect the barrier better than lotions." },
      { type: "lifestyle", label: "Remove likely irritants", detail: "Pause scrubs, fragrance, hot water, astringents and newly introduced products; patch test reintroductions." },
      { type: "escalate", label: "Cracked, weeping, painful or spreading", detail: "See a pharmacist or clinician rather than adding more actives; infection and inflammatory rashes can look alike." },
    ],
  },
  {
    id: "central-scale-pattern",
    observable: "Flaking or greasy-looking scale around the brows, sides of the nose, hairline or beard",
    couldAlsoBe: ["seborrheic dermatitis", "dry or irritated skin", "psoriasis", "contact dermatitis", "fungal infection"],
    tier: "self-report",
    minimumEvidence: "Symptom and distribution questions plus clinician-labelled images. The same flakes require different treatment depending on the cause.",
    actions: [
      ...baseRoutine,
      { type: "lifestyle", label: "Keep the routine simple", detail: "Gently remove scale while cleansing; avoid fragrance, harsh scrubs and hair products left on facial skin." },
      { type: "escalate", label: "Confirm before using medicated products", detail: "A pharmacist or clinician can distinguish seborrheic dermatitis from eczema, psoriasis and infection and recommend the locally appropriate treatment." },
    ],
  },
  {
    id: "post-blemish-mark-pattern",
    observable: "Flat red, purple or brown marks where previous spots were reported",
    couldAlsoBe: ["post-inflammatory erythema", "post-inflammatory hyperpigmentation", "melasma", "sun spots", "a mole or other lesion"],
    tier: "trial",
    minimumEvidence: "User confirmation that the mark followed a blemish; stable colour capture; exclusion of changing or raised lesions.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Daily sunscreen", detail: "Broad-spectrum SPF 30+ helps prevent post-inflammatory marks from darkening and protects results from other treatments." },
      { type: "otc", label: "Azelaic acid", detail: "May help both acne and the flat dark marks that remain afterward." },
      { type: "procedure", label: "Chemical peel, laser or microneedling", detail: "Only after professional assessment; the wrong procedure can worsen pigmentation, particularly in deeper skin tones." },
    ],
  },
  {
    id: "uneven-pigment-pattern",
    observable: "Uneven flat areas of darker or lighter colour",
    couldAlsoBe: ["sun-related pigmentation", "melasma", "post-inflammatory change", "vitiligo", "fungal or inflammatory change"],
    tier: "self-report",
    minimumEvidence: "Colour-calibrated repeated captures and clinician labels. Ordinary phone auto-white-balance is insufficient for diagnosis.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Tinted broad-spectrum sunscreen", detail: "Daily SPF 30+ is foundational; visible-light protection from iron oxides can also matter for melasma-prone pigmentation." },
      { type: "escalate", label: "New, spreading or sharply depigmented areas", detail: "See a clinician before treating; colour loss and colour gain have many different causes." },
    ],
  },
  {
    id: "scar-texture-pattern",
    observable: "Persistent indented, raised or thickened texture where prior injury or acne is reported",
    couldAlsoBe: ["atrophic acne scarring", "hypertrophic scar", "keloid", "active inflamed lesion"],
    tier: "trial",
    minimumEvidence: "Multi-angle or controlled raking-light capture; user history; dermatologist labels separating active lesions from scars.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Silicone gel or sheets", detail: "The main OTC option for a raised healing scar; it does not correct indented acne scars." },
      { type: "procedure", label: "Procedure depends on scar type", detail: "Microneedling, subcision, laser, peels, fillers or injections may be used by qualified clinicians after classifying the scar." },
      { type: "escalate", label: "Growing, painful or itchy raised scar", detail: "Seek a clinician; early treatment can matter for hypertrophic scars and keloids." },
    ],
  },
  {
    id: "oil-shine-pattern",
    observable: "Repeated central-face shine under controlled diffuse lighting",
    couldAlsoBe: ["surface oil", "sweat", "moisturiser or makeup", "direct-light reflection"],
    tier: "self-report",
    minimumEvidence: "Polarised or tightly controlled lighting and confirmation of bare skin; a single normal photograph cannot separate oil from reflection.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Non-comedogenic products", detail: "Choose lightweight non-comedogenic moisturiser and sunscreen; harsh degreasing can increase irritation without treating the cause." },
      { type: "lifestyle", label: "Cleanse after heavy sweating", detail: "Wash gently after exercise and keep occlusive hair and equipment products off the face." },
    ],
  },
  {
    id: "razor-bump-pattern",
    observable: "Hair-centred bumps and dark marks in an area that the user reports shaving, waxing or plucking",
    couldAlsoBe: ["razor bumps or ingrown hairs", "folliculitis", "acne", "contact irritation"],
    tier: "self-report",
    minimumEvidence: "User confirmation of hair removal, location-aware lesion labels and clinician review of folliculitis look-alikes.",
    actions: [
      ...baseRoutine,
      { type: "lifestyle", label: "Change the shave, not the skin", detail: "If practical, pause close shaving. Otherwise soften hair first, use moisturising shave cream, shave with hair growth and do not stretch the skin or pluck trapped hairs." },
      { type: "procedure", label: "Persistent razor bumps", detail: "A dermatologist can confirm the cause and discuss medical treatment or laser hair reduction where suitable." },
      { type: "escalate", label: "Pain, pus or spreading redness", detail: "Seek clinical advice because infected follicles can resemble ordinary razor bumps." },
    ],
  },
  {
    id: "undereye-shadow-pattern",
    observable: "Under-eye darkness or puffiness relative to the cheeks",
    couldAlsoBe: ["tear-trough shadow", "visible vessels", "pigmentation", "allergy-related rubbing or swelling", "sleep-related puffiness"],
    tier: "trial",
    minimumEvidence: "Frontal diffuse light, neutral gaze and repeated captures; separate colour from structural shadow using more than one lighting direction.",
    actions: [
      ...baseRoutine,
      { type: "lifestyle", label: "Address the movable component", detail: "Consistent sleep, allergy control, avoiding rubbing, and moderating alcohol and very salty meals may reduce puffiness; they do not remove structural hollows." },
      { type: "procedure", label: "Professional options", detail: "A clinician may discuss pigment treatments, vascular laser or carefully selected tear-trough procedures after identifying the cause." },
    ],
  },
  {
    id: "fine-line-pattern",
    observable: "Fine surface lines and photoageing texture visible at rest",
    couldAlsoBe: ["normal expression lines", "dryness", "sun-related change", "camera sharpening"],
    tier: "trial",
    minimumEvidence: "High-resolution neutral-expression captures at fixed distance and light; repeatability testing across cameras and ages.",
    actions: [
      ...baseRoutine,
      { type: "otc", label: "Sunscreen and moisturiser", detail: "Daily broad-spectrum SPF 30+ prevents additional photoageing; moisturiser temporarily softens the appearance of fine dry lines." },
      { type: "procedure", label: "Clinician-led options", detail: "Prescription retinoids, neuromodulators, resurfacing lasers, peels and microneedling target different kinds of lines; assessment should come before a procedure." },
    ],
  },
  {
    id: "lip-dryness-pattern",
    observable: "Visible lip flaking, fissures or marked surface roughness",
    couldAlsoBe: ["ordinary chapping", "irritant or allergic cheilitis", "sun damage", "infection"],
    tier: "trial",
    minimumEvidence: "Sharp neutral-expression capture plus symptom and product history; colour or texture alone cannot identify the cause.",
    actions: [
      { type: "routine", label: "Plain barrier balm", detail: "Use a fragrance-free, flavour-free petrolatum-based balm and SPF lip protection outdoors." },
      { type: "lifestyle", label: "Stop licking and irritating", detail: "Pause fragranced or tingling lip products and avoid peeling loose skin." },
      { type: "diet", label: "Do not infer a deficiency", detail: "Cracked lips in a photo do not prove dehydration or a nutrient deficiency; avoid supplement recommendations without clinical assessment." },
      { type: "escalate", label: "Persistent, one-sided or non-healing", detail: "Have it examined, especially when there is bleeding, marked pain or a sore that does not heal." },
    ],
  },
  {
    id: "isolated-growth-or-mark",
    observable: "An isolated mole, skin tag, crusted area or other distinct growth",
    couldAlsoBe: ["benign mole", "skin tag", "wart", "seborrheic keratosis", "actinic keratosis", "skin cancer"],
    tier: "clinician-only",
    minimumEvidence: "Never name or clear an isolated lesion from TrueMax imagery. History, examination and sometimes dermoscopy or biopsy are required.",
    actions: [
      { type: "escalate", label: "Do not use a remover", detail: "Do not apply acids, freezing products or home-removal tools to an unidentified facial growth. Ask a clinician to identify it first." },
    ],
  },
  {
    id: "infection-or-acute-rash",
    observable: "Rapidly spreading redness, grouped blisters, honey-coloured crust, oozing, marked swelling or a painful hot-looking area",
    couldAlsoBe: ["bacterial, viral or fungal infection", "severe dermatitis", "allergic reaction"],
    tier: "clinician-only",
    minimumEvidence: "Never classify from TrueMax imagery. Symptoms and examination are required.",
    actions: [
      { type: "escalate", label: "Prompt medical assessment", detail: "Do not recommend cosmetic actives. Seek urgent clinical advice, particularly with eye involvement, fever, severe pain, facial swelling or breathing difficulty." },
    ],
  },
  {
    id: "changing-lesion",
    observable: "A new or changing isolated spot, asymmetric pigmented lesion, irregular border, multiple colours, bleeding or a sore that does not heal",
    couldAlsoBe: ["benign mole or growth", "actinic keratosis", "skin cancer"],
    tier: "clinician-only",
    minimumEvidence: "Never clear or diagnose from a selfie. Dermoscopy, history and clinician examination are required.",
    actions: [
      { type: "escalate", label: "Book a skin check", detail: "TrueMax must not label this harmless or recommend an OTC treatment. A changing, bleeding or non-healing lesion should be assessed by a qualified clinician." },
    ],
  },
];

export const TRIAL_DETECTABLE_SKIN_CONCERNS = SKIN_CONCERN_CATALOG.filter((c) => c.tier === "trial");

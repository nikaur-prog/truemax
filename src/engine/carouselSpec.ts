export const CAROUSEL_MIN_SLIDES = 2;
export const CAROUSEL_MAX_SLIDES = 7;
export const CAROUSEL_MAX_DESCRIPTION = 500;
export const CAROUSEL_MAX_INSTRUCTION = 320;

export type CarouselThemeId =
  | "puffiness"
  | "skin-quality"
  | "fatigue"
  | "jaw-width"
  | "testosterone-concept";

export type CarouselSourceMode = "synthetic" | "morph";

export interface CarouselTheme {
  id: CarouselThemeId;
  label: string;
  title: string;
  note: string;
  levels: readonly string[];
  direction: string;
}

export interface CarouselGenerationSpec {
  theme: CarouselThemeId;
  position: number;
  level: number;
  total: number;
  sourceMode: CarouselSourceMode;
  description: string;
  instruction?: string;
}

export interface ParsedCarouselGeneration {
  spec: CarouselGenerationSpec;
  sourceDataUrl: string | null;
}

export interface CarouselOverlayCopy {
  position: string;
  themeTitle: string;
  levelLabel: string;
  note: string;
  brand: string;
}

export const CAROUSEL_THEMES: readonly CarouselTheme[] = [
  {
    id: "puffiness",
    label: "Facial puffiness",
    title: "FACIAL PUFFINESS",
    note: "A visible presentation scale, not a diagnosis.",
    levels: ["VERY PUFFY", "PUFFY", "BALANCED", "LEAN", "VERY LEAN"],
    direction: "progressively reduce temporary facial puffiness and water-retention cues while preserving the same bone structure",
  },
  {
    id: "skin-quality",
    label: "Skin presentation",
    title: "SKIN PRESENTATION",
    note: "Visible skin presentation only. It does not diagnose a condition.",
    levels: ["VERY ROUGH", "ROUGH", "BALANCED", "CLEAR", "VERY CLEAR"],
    direction: "progressively improve visible clarity, calmness and evenness of the skin without changing facial structure or skin tone",
  },
  {
    id: "fatigue",
    label: "Fatigue cues",
    title: "VISIBLE FATIGUE CUES",
    note: "A visual concept based on presentation, not a stress or health reading.",
    levels: ["VERY TIRED", "TIRED", "NEUTRAL", "RESTED", "VERY RESTED"],
    direction: "progressively reduce visible fatigue cues such as heavy eyelids and dull presentation while keeping identity and anatomy unchanged",
  },
  {
    id: "jaw-width",
    label: "Jaw width",
    title: "JAW WIDTH",
    note: "A visual comparison. It is not a TrueMax measurement result.",
    levels: ["VERY NARROW", "NARROW", "BALANCED", "WIDE", "VERY WIDE"],
    direction: "progressively change the apparent lower-face width for an editorial comparison while retaining recognisable identity",
  },
  {
    id: "testosterone-concept",
    label: "Testosterone cues (concept)",
    title: "MASCULINE VISUAL CUES",
    note: "Creative visual concept only. Appearance cannot determine hormone levels.",
    levels: ["VERY SOFT", "SOFT", "BALANCED", "STRONG", "VERY STRONG"],
    direction: "progressively strengthen masculine-coded styling cues such as grooming, posture and facial presentation without claiming or depicting a biological hormone measurement",
  },
] as const;

const THEME_BY_ID = new Map(CAROUSEL_THEMES.map((theme) => [theme.id, theme]));

export function carouselTheme(id: unknown): CarouselTheme | null {
  return typeof id === "string" ? THEME_BY_ID.get(id as CarouselThemeId) ?? null : null;
}

export function carouselLevelLabel(themeId: CarouselThemeId, level: number): string {
  const theme = THEME_BY_ID.get(themeId);
  if (!theme) return "";
  const index = Math.max(1, Math.min(theme.levels.length, Math.round(level))) - 1;
  return theme.levels[index] ?? theme.levels[0];
}

export function carouselOverlayCopy(
  themeId: unknown,
  level: unknown,
  position: unknown,
  total: unknown,
): CarouselOverlayCopy | null {
  const theme = carouselTheme(themeId);
  if (!theme || typeof level !== "number" || !Number.isInteger(level)
    || level < 1 || level > theme.levels.length
    || typeof total !== "number" || !Number.isInteger(total)
    || total < CAROUSEL_MIN_SLIDES || total > CAROUSEL_MAX_SLIDES
    || typeof position !== "number" || !Number.isInteger(position)
    || position < 1 || position > total) return null;
  return {
    position: `${position} / ${total}`,
    themeTitle: theme.title,
    levelLabel: theme.levels[level - 1],
    note: theme.note.toUpperCase(),
    brand: "TRUEMAX.APP",
  };
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function parseCarouselGeneration(value: unknown):
  | { ok: true; value: ParsedCarouselGeneration }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "The slide request is missing." };
  const body = value as Record<string, unknown>;
  const theme = carouselTheme(body.theme);
  if (!theme) return { ok: false, error: "Choose a supported carousel theme." };
  const level = wholeNumber(body.level);
  if (!level || level < 1 || level > theme.levels.length) {
    return { ok: false, error: "Choose a valid level for this slide." };
  }
  const total = wholeNumber(body.total);
  if (!total || total < CAROUSEL_MIN_SLIDES || total > CAROUSEL_MAX_SLIDES) {
    return { ok: false, error: `A carousel needs ${CAROUSEL_MIN_SLIDES} to ${CAROUSEL_MAX_SLIDES} slides.` };
  }
  const position = wholeNumber(body.position);
  if (!position || position < 1 || position > total) {
    return { ok: false, error: "Choose a valid position for this slide." };
  }
  const sourceMode = body.sourceMode === "morph" ? "morph" : body.sourceMode === "synthetic" ? "synthetic" : null;
  if (!sourceMode) return { ok: false, error: "Choose a source for this slide." };
  const description = cleanText(body.description, CAROUSEL_MAX_DESCRIPTION);
  const instruction = cleanText(body.instruction, CAROUSEL_MAX_INSTRUCTION);
  if (sourceMode === "synthetic" && !description) {
    return { ok: false, error: "Describe the character to generate." };
  }
  if (typeof body.description === "string" && body.description.trim().length > CAROUSEL_MAX_DESCRIPTION) {
    return { ok: false, error: `Character descriptions can be at most ${CAROUSEL_MAX_DESCRIPTION} characters.` };
  }
  if (typeof body.instruction === "string" && body.instruction.trim().length > CAROUSEL_MAX_INSTRUCTION) {
    return { ok: false, error: `Morph instructions can be at most ${CAROUSEL_MAX_INSTRUCTION} characters.` };
  }
  const sourceDataUrl = sourceMode === "morph" && typeof body.sourceDataUrl === "string" ? body.sourceDataUrl : null;
  if (sourceMode === "morph" && !sourceDataUrl) {
    return { ok: false, error: "Attach a source photo before morphing it." };
  }
  return {
    ok: true,
    value: {
      spec: { theme: theme.id, position, level, total, sourceMode, description, instruction: instruction || undefined },
      sourceDataUrl,
    },
  };
}

export function carouselProviderPrompt(spec: CarouselGenerationSpec): string {
  const theme = THEME_BY_ID.get(spec.theme);
  if (!theme) throw new Error("Unsupported carousel theme");
  const label = carouselLevelLabel(theme.id, spec.level);
  const identity = spec.sourceMode === "morph"
    ? "Edit the supplied photograph. Preserve the person's recognisable identity, age range, skin tone, hair, camera angle and expression."
    : `Create one fictional adult subject from this operator description: ${spec.description}`;
  const operator = spec.instruction ? `Operator direction: ${spec.instruction}` : "";
  return [
    identity,
    `Create a clean editorial portrait for slide ${spec.position} of ${spec.total} in a consistent comparison series.`,
    `Theme: ${theme.title}. Requested visual band: ${label}. Across the series, ${theme.direction}.`,
    "Head and upper shoulders, front-facing unless the operator specifically asks for a side view, neutral expression, simple studio background, even lighting, natural skin texture, no text, no logos, no watermark, no frame, no UI.",
    "Do not infer ethnicity, health, stress, hormones or personality from the face. Do not change standards based on ethnicity or skin tone. Do not turn the visual concept into a diagnosis or factual biological claim.",
    "Keep the forehead, chin and both sides of the face inside the image. Do not crop through the head.",
    operator,
  ].filter(Boolean).join("\n");
}

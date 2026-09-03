import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";

// ---------------------------------------------------------------------------
// Two placements of the thirteen side points, one seed.
//
// The device seeder and the cloud pass are independent readers of the same
// photograph. The seeder's eight outline points come from the face mesh and
// are right to a few pixels; its five back points come from a silhouette and
// a template, and drift. The cloud pass reads all thirteen from the pixels
// and, as of vision-2, matches the seeder on the ear notch, the neck point
// and the chin front, and is worse on the jaw corner and the chin bottom
// (docs/SIDE_LANDMARKS_AI_FIRST.md, section 2b).
//
// So the cloud result does not replace the seed. Each landmark takes the
// reader the benchmark says to trust, the two ear points are averaged when
// the readers agree, and the DISTANCE between the two readers becomes the
// confidence the person sees: two independent methods landing on the same
// pixel is the strongest evidence a placement can have without a human, and
// two methods a third of a head apart is the plainest signal to look closely.
//
// Everything is in the photograph's pixel frame; thresholds are in head
// widths (nose tip to ear notch) so a small photo and a large one are judged
// alike. Pure, synchronous, no I/O: the policy is data that the evaluation
// harness can vary and score against the labelled set.
// ---------------------------------------------------------------------------

export const BACK_SIDE_POINT_IDS: readonly SidePointId[] = ["menton", "cervicale", "gonion", "condylion", "tragion"];
export const FRONT_SIDE_POINT_IDS: readonly SidePointId[] = SIDE_POINTS
  .map((p) => p.id)
  .filter((id) => !BACK_SIDE_POINT_IDS.includes(id));

export type SeedSource = "device" | "cloud" | "blend";
export type ConfidenceBand = "high" | "mid" | "low";

export interface DisagreementRule {
  /** Applies while the two readers are at most this far apart, in head widths. */
  upTo: number;
  take: SeedSource;
}

export interface SeedFusionPolicy {
  /** The reader a landmark takes when no rule below applies. */
  prefer: Record<SidePointId, "device" | "cloud">;
  /** Per landmark, what to take at each disagreement, first match wins; falls back to `prefer`. */
  rules: Partial<Record<SidePointId, readonly DisagreementRule[]>>;
  /** Landmarks whose two readings are averaged when they agree to within `blendWithin`. */
  blend: readonly SidePointId[];
  blendWithin: number;
  /** Agreement, in head widths, below which a point is high or mid confidence. */
  highWithin: number;
  midWithin: number;
  /** A cloud reading the model itself doubts below this is capped at mid. */
  doubtBelow: number;
}

// vision-2 on the labelled synthetic set, 55 profiles: the seeder wins on the
// jaw corner (0.066 vs 0.347 where the seeder was wrong) and the chin bottom
// (0.077 vs 0.159), and its worst case on either is under 0.17, so the model
// is never taken there. On the ear pair the two tie on the median (tragion
// 0.107 vs 0.099) but not on the tail: the seeder's notch is more than 0.15
// head widths off on 17 of 54 faces, up to 0.96, while the model's p90 is
// 0.195 with no bias. So a small disagreement on the ear is averaged (two
// similar independent errors cancel) and a large one goes to the model,
// because at that distance it is the seeder that is usually the one that
// missed. The front eight are the mesh's. Revisit from the harness's
// disagreement table and fused column, never by feel.
export const DEFAULT_SEED_FUSION_POLICY: SeedFusionPolicy = {
  prefer: Object.fromEntries(SIDE_POINTS.map((p) => [p.id, "device"])) as Record<SidePointId, "device" | "cloud">,
  rules: {
    tragion: [{ upTo: 0.15, take: "blend" }, { upTo: Infinity, take: "cloud" }],
    condylion: [{ upTo: 0.15, take: "blend" }, { upTo: Infinity, take: "cloud" }],
  },
  blend: ["tragion", "condylion"],
  blendWithin: 0.15,
  highWithin: 0.06,
  midWithin: 0.15,
  doubtBelow: 0.4,
};

export interface FusedSideSeed {
  points: SidePoints;
  source: Record<SidePointId, SeedSource>;
  /** Distance between the two readers in head widths; null when there was one reader. */
  agreement: Record<SidePointId, number | null>;
  band: Record<SidePointId, ConfidenceBand>;
  /** The band the scan carries: the worst of the five back points. */
  overall: ConfidenceBand;
  /** Whether a second reader took part at all. */
  secondOpinion: boolean;
  /** The head width, in pixels, the thresholds were judged in. */
  unit: number;
}

/** Nose tip to ear notch, in the points' own pixels. */
export function headWidth(points: SidePoints): number {
  return Math.hypot(points.pronasale.x - points.tragion.x, points.pronasale.y - points.tragion.y);
}

function bandFor(distance: number, policy: SeedFusionPolicy): ConfidenceBand {
  if (distance <= policy.highWithin) return "high";
  if (distance <= policy.midWithin) return "mid";
  return "low";
}

const ORDER: Record<ConfidenceBand, number> = { high: 0, mid: 1, low: 2 };
function worse(a: ConfidenceBand, b: ConfidenceBand): ConfidenceBand {
  return ORDER[a] >= ORDER[b] ? a : b;
}

/**
 * Fuse the device seed with a cloud reading of the same photograph.
 *
 * Without a cloud reading (declined, signed out, over the limit, timed out)
 * the device seed comes back unchanged, the front eight high, the back five
 * mid: not because they are known to be right, but because nothing has
 * checked them, and "mid" is what unchecked reads as on screen.
 */
export function fuseSideSeeds(
  device: SidePoints,
  cloud: SidePoints | null,
  cloudConfidence?: Partial<Record<SidePointId, number>>,
  policy: SeedFusionPolicy = DEFAULT_SEED_FUSION_POLICY,
): FusedSideSeed {
  const ids = SIDE_POINTS.map((p) => p.id);
  const points = {} as SidePoints;
  const source = {} as Record<SidePointId, SeedSource>;
  const agreement = {} as Record<SidePointId, number | null>;
  const band = {} as Record<SidePointId, ConfidenceBand>;

  let unit = headWidth(device);
  if (!(unit > 1) && cloud) unit = headWidth(cloud);
  const usable = !!cloud && unit > 1;

  for (const id of ids) {
    const d = device[id];
    if (!usable) {
      points[id] = { x: d.x, y: d.y };
      source[id] = "device";
      agreement[id] = null;
      band[id] = BACK_SIDE_POINT_IDS.includes(id) ? "mid" : "high";
      continue;
    }
    const c = cloud![id];
    const distance = Math.hypot(d.x - c.x, d.y - c.y) / unit;
    agreement[id] = distance;
    const rule = policy.rules[id]?.find((r) => distance <= r.upTo);
    const take: SeedSource = rule
      ? rule.take
      : policy.blend.includes(id) && distance <= policy.blendWithin
        ? "blend"
        : policy.prefer[id];
    if (take === "blend") {
      points[id] = { x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 };
      source[id] = "blend";
    } else if (take === "cloud") {
      points[id] = { x: c.x, y: c.y };
      source[id] = "cloud";
    } else {
      points[id] = { x: d.x, y: d.y };
      source[id] = "device";
    }
    let b = bandFor(distance, policy);
    const doubt = cloudConfidence?.[id];
    if (source[id] !== "device" && typeof doubt === "number" && doubt < policy.doubtBelow) b = worse(b, "mid");
    band[id] = b;
  }

  let overall: ConfidenceBand = "high";
  for (const id of BACK_SIDE_POINT_IDS) overall = worse(overall, band[id]);

  return { points, source, agreement, band, overall, secondOpinion: usable, unit };
}

/** The wording the app shows beside a band. Plain, never a compliment. */
export const CONFIDENCE_BAND_LABEL: Record<ConfidenceBand, string> = {
  high: "High confidence",
  mid: "Medium confidence",
  low: "Low confidence",
};

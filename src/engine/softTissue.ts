import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./geometry.js";
import { RELIABLE_MIN, reliabilityOf } from "./reliability.js";
import type { Report } from "./types.js";

// ---------------------------------------------------------------------------
// Soft tissue: the measurements that fat, fluid and muscle actually move.
//
// The question people ask is "is my face fat", and the honest answer a
// photograph can give is not a percentage. A face carries no body-fat figure,
// and a number invented for one would be the kind of claim the rest of this
// product exists to avoid. What a photograph CAN give is the handful of
// measurements soft tissue changes: how far the cheek outline bows outside the
// bone, how wide the lower face is against the cheekbones, how the jaw and
// chin read against each other, and the under-chin angle on the profile.
// Tracked scan to scan, in measurement units, those are what somebody who
// asked the question wants to watch.
//
// This group is a PRESENTATION, not a pillar. Four of its five rows are
// ordinary scored metrics that keep their pillar weight; the fifth is a new
// measurement that carries no score at all until the repeat-photo corpus
// says how repeatable it is. Nothing here moves the structural number.
//
// Rules, restated so they survive the next edit:
//   - never a percentage of anything but face geometry
//   - never a verdict word about the person
//   - every row shows a delta against the previous own scan when one exists,
//     and says "within capture variance" when the move is inside noise
// ---------------------------------------------------------------------------

/** The extra measurement this group adds on top of the scored registry. */
export interface SoftTissueExtras {
  /** Mid-cheek silhouette width against cheekbone width. 1.0 means as wide at the mid cheek as at the bone. */
  lowerFaceWidthRatio: number;
}

/** Rows in display order. Ids not in the registry come from SoftTissueExtras. */
export const SOFT_TISSUE_ORDER = [
  "cheekFullness",
  "lowerFaceWidthRatio",
  "jawCheekRatio",
  "chinWidthRatio",
  "submentalCervical",
] as const;

export type SoftTissueId = (typeof SOFT_TISSUE_ORDER)[number];

/** Plain descriptions, one clause each, no verdict. */
const WHAT: Record<SoftTissueId, string> = {
  cheekFullness: "how far the cheek outline bows outside the bone",
  lowerFaceWidthRatio: "mid-cheek width against cheekbone width",
  jawCheekRatio: "jaw width against cheekbone width",
  chinWidthRatio: "chin width against jaw width",
  submentalCervical: "the under-chin angle at the neck, from the profile",
};

const UNITS: Record<SoftTissueId, { unit: string; decimals: number; name: string }> = {
  cheekFullness: { unit: "", decimals: 1, name: "Cheek fullness" },
  lowerFaceWidthRatio: { unit: "", decimals: 2, name: "Lower face width" },
  jawCheekRatio: { unit: "", decimals: 2, name: "Jaw to cheek width" },
  chinWidthRatio: { unit: "", decimals: 2, name: "Chin width ratio" },
  submentalCervical: { unit: "°", decimals: 1, name: "Under-chin angle" },
};

/** Below this reliability a row wears the indicative flag: the same line the report draws for scored metrics. */
export const SOFT_TISSUE_INDICATIVE_BELOW = RELIABLE_MIN;

/**
 * Smallest move worth printing per row, in the row's own units. Below it the
 * delta reads "within capture variance". These are the repeat-photo spreads
 * where a corpus figure exists and a deliberately wide guess where it does
 * not (the new ratio has no corpus yet).
 */
const NOISE: Record<SoftTissueId, number> = {
  cheekFullness: 0.6,
  lowerFaceWidthRatio: 0.03,
  jawCheekRatio: 0.03,
  chinWidthRatio: 0.03,
  submentalCervical: 4,
};

/**
 * The one measurement this group adds. Mid-cheek silhouette points (132 and
 * 361, the outline between the cheekbone and the jaw corner) against the
 * cheekbone-height silhouette (234 and 454). Both pairs are silhouette rather
 * than bone, which is the point: the outline is what soft tissue drapes.
 */
export function softTissueFromLandmarks(
  lm: NormalizedLandmark[],
  width: number,
  height: number,
): SoftTissueExtras | null {
  const p = (i: number) => {
    const l = lm[i];
    return l ? { x: l.x * width, y: l.y * height } : null;
  };
  const midR = p(LM.CHEEK_MID_R);
  const midL = p(LM.CHEEK_MID_L);
  const zyR = p(LM.ZYGION_R);
  const zyL = p(LM.ZYGION_L);
  if (!midR || !midL || !zyR || !zyL) return null;
  const mid = Math.hypot(midR.x - midL.x, midR.y - midL.y);
  const bizygo = Math.hypot(zyR.x - zyL.x, zyR.y - zyL.y);
  if (!(bizygo > 1e-6) || !Number.isFinite(mid)) return null;
  const ratio = mid / bizygo;
  // A mid-cheek wider than the cheekbones by a fifth, or narrower than half of
  // them, is a landmark on a collar or an ear, not a face.
  if (ratio < 0.5 || ratio > 1.2) return null;
  return { lowerFaceWidthRatio: +ratio.toFixed(4) };
}

export interface SoftTissueRow {
  id: SoftTissueId;
  name: string;
  what: string;
  value: number;
  unit: string;
  decimals: number;
  /** Below the reliability threshold, or no corpus figure at all. */
  indicative: boolean;
  /** Signed change against the previous own scan, when one carried this row. */
  delta?: number;
  /** Whether that change is outside the row's repeat-photo noise. */
  moved?: boolean;
}

/** The values worth storing on a scan row so the next scan can show a delta. */
export function softTissueValues(report: Report): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of SOFT_TISSUE_ORDER) {
    const v = valueFor(report, id);
    if (v != null) out[id] = +v.toFixed(4);
  }
  return out;
}

function valueFor(report: Report, id: SoftTissueId): number | null {
  if (id === "lowerFaceWidthRatio") return report.softTissue?.lowerFaceWidthRatio ?? null;
  const m = report.metrics.find((x) => x.def.id === id);
  if (!m || !Number.isFinite(m.value) || m.implausible) return null;
  return m.value;
}

/**
 * The rows for the report, with deltas against the previous own scan's
 * stored values when it has them. A row absent from the previous scan (an
 * older app version, or no profile that day) simply has no delta.
 */
export function softTissueRows(
  report: Report,
  previous?: Record<string, number> | null,
): SoftTissueRow[] {
  const rows: SoftTissueRow[] = [];
  for (const id of SOFT_TISSUE_ORDER) {
    const value = valueFor(report, id);
    if (value == null) continue;
    const u = UNITS[id];
    const row: SoftTissueRow = {
      id,
      name: u.name,
      what: WHAT[id],
      value: +value.toFixed(u.decimals),
      unit: u.unit,
      decimals: u.decimals,
      indicative: reliabilityOf(id) < SOFT_TISSUE_INDICATIVE_BELOW,
    };
    const prev = previous?.[id];
    if (typeof prev === "number" && Number.isFinite(prev)) {
      const delta = +(value - prev).toFixed(u.decimals);
      row.delta = delta;
      row.moved = Math.abs(value - prev) >= NOISE[id];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * One plain sentence about what moved. No verdict, no percentage, no word
 * that names fat. Empty when there is no previous scan to compare with.
 */
export function softTissueSentence(rows: SoftTissueRow[], daysAgo?: number): string {
  const compared = rows.filter((r) => r.delta !== undefined);
  if (!compared.length) return "";
  const when = daysAgo && daysAgo > 0 ? `since your scan ${daysAgo} days ago` : "since your last scan";
  const moved = compared.filter((r) => r.moved);
  if (!moved.length) {
    return `Nothing in this group moved outside capture variance ${when}.`;
  }
  const parts = moved.map((r) => {
    const from = (r.value - (r.delta ?? 0)).toFixed(r.decimals);
    return `${r.name.toLowerCase()} from ${from}${r.unit} to ${r.value.toFixed(r.decimals)}${r.unit}`;
  });
  const rest = compared.length - moved.length;
  const tail = rest > 0 ? ` The other ${rest === 1 ? "row is" : `${rest} rows are`} within capture variance.` : "";
  return `${cap(when)}, ${joinPlain(parts)}.${tail}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinPlain(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

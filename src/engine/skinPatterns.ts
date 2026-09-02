import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./geometry.js";
import { faceRings } from "./skin.js";
import {
  components,
  dilate,
  extractSkinFields,
  highPass,
  inside,
  maskedBlur,
  robustSpread,
  textureRatio,
} from "./skinFields.js";
import type { Pt, SkinFields } from "./skinFields.js";
import type { SkinPatternId, SkinPatternReading, SkinPatterns, SkinPresence, SkinZoneId } from "./types.js";

// ---------------------------------------------------------------------------
// Visible skin patterns.
//
// What this file does: finds PLACES on the face where the skin differs from
// the person's own skin around it, sorts them into four visible families,
// and says where and how much. What it does not do: name a condition. The
// catalogue (skinConcernCatalog.ts) fixes the words, the trial document fixes
// the gates, and this file is built so that neither can be bypassed by
// accident: every output id is a catalogue id, every threshold is relative
// to the person's own spread so skin tone cannot enter, and the tier is a
// literal "trial" until a class passes its gate on labelled data.
//
// Four patterns:
//
//   inflamed-spot-pattern    small blobs where the flat-fielded redness (a*)
//                            sits well above the person's own local spread
//   post-blemish-mark-pattern small blobs where flat-fielded lightness sits
//                            well below the person's own spread and the
//                            colour barely changes
//   redness-pattern          diffuse: cheeks and nose redder than the
//                            forehead and chin on the same face
//   uneven-pigment-pattern   patches at a scale between a spot and the light:
//                            a band-pass of lightness and b*, by area
//
// Everything runs on the device on the same 220-pixel-wide resample the
// skin statistics use. The thresholds below are the TRIAL values: they were
// set on synthetic fields and the repeat-photo corpus, not on labelled
// faces, and the tier says so. Nothing here touches the score.
// ---------------------------------------------------------------------------

/** Face resampled to this width, as in skin.ts, so a spot is the same size in every photo. */
export const SAMPLE_W = 220;

/** A blob must sit this many robust spreads beyond the person's own local variation. */
export const SPOT_SPREADS = 3;
/** Floors on the spread, in a* and L* units, so flawless synthetic skin cannot make every pixel a spot. */
export const SPREAD_FLOOR_A = 1;
export const SPREAD_FLOOR_L = 1.5;
/** Component size accepted as a spot, in pixels at the 220-wide sample. Smaller is noise; larger is a patch. */
export const SPOT_PX: [number, number] = [2, 40];
/** Spots per 10,000 kept pixels. */
export const SPOT_DENSITY: Record<SkinPresence, number> = { light: 1.5, moderate: 4, marked: 8 };
/** Cheek-and-nose a* minus forehead-and-chin a*, in a* units. */
export const REDNESS_A: Record<SkinPresence, number> = { light: 2.5, moderate: 5, marked: 8 };
/** A pigment patch must sit this many spreads beyond the person's own mid-scale variation. Lower than the spot figure because a patch is soft-edged and the band-pass halves its depth. */
export const PIGMENT_SPREADS = 2;
/** Fraction of kept skin inside mid-scale patches. */
export const PIGMENT_AREA: Record<SkinPresence, number> = { light: 0.04, moderate: 0.1, marked: 0.18 };
/** Band edges for the pigment patches, as fractions of the sample width. */
export const PIGMENT_BAND: [number, number] = [0.03, 0.16];
/** Radius of the illumination blur the spot detectors flat-field against. */
export const FLAT_FIELD_RADIUS = 0.16;

export const SKIN_PATTERN_LABELS: Record<SkinPatternId, string> = {
  "inflamed-spot-pattern": "Visible inflamed-spot pattern",
  "post-blemish-mark-pattern": "Visible post-blemish marks",
  "redness-pattern": "Visible redness pattern",
  "uneven-pigment-pattern": "Uneven pigment pattern",
};

export const SKIN_ZONE_LABELS: Record<SkinZoneId, string> = {
  forehead: "forehead",
  nose: "nose",
  cheekL: "left cheek",
  cheekR: "right cheek",
  chin: "chin",
};

export interface SkinZone {
  id: SkinZoneId;
  poly: Pt[];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * The five zones, as rectangles in sample coordinates, from the mesh. Zones
 * do not have to tile the face; a spot outside every zone still counts in
 * the face total and is simply not placed.
 */
export function zonesFromPoints(
  pt: (i: number) => Pt,
  box: { x0: number; y0: number; x1: number; y1: number },
): SkinZone[] {
  const fh = box.y1 - box.y0;
  const browY = Math.min(pt(LM.BROW_R_MID).y, pt(LM.BROW_L_MID).y);
  const innerR = pt(LM.EYE_R_INNER);
  const innerL = pt(LM.EYE_L_INNER);
  const innerLeftX = Math.min(innerR.x, innerL.x);
  const innerRightX = Math.max(innerR.x, innerL.x);
  const eyeBottom = Math.max(innerR.y, innerL.y) + fh * 0.06;
  const mouthY = Math.min(pt(LM.MOUTH_R).y, pt(LM.MOUTH_L).y);
  const mouthLeftX = Math.min(pt(LM.MOUTH_R).x, pt(LM.MOUTH_L).x);
  const mouthRightX = Math.max(pt(LM.MOUTH_R).x, pt(LM.MOUTH_L).x);
  // The subject's right eye is whichever inner corner sits further left in
  // the image for an unmirrored photograph; the zone ids follow the mesh,
  // not the image, so a mirrored selfie names the same cheek the same way.
  const rightIsImageLeft = innerR.x < innerL.x;
  const cheekImageLeft = rect(box.x0, eyeBottom, innerLeftX, mouthY);
  const cheekImageRight = rect(innerRightX, eyeBottom, box.x1, mouthY);
  return [
    { id: "forehead", poly: rect(box.x0, box.y0, box.x1, browY - fh * 0.02) },
    { id: "nose", poly: rect(innerLeftX, pt(LM.NASION).y, innerRightX, pt(LM.SUBNASALE).y) },
    { id: rightIsImageLeft ? "cheekR" : "cheekL", poly: cheekImageLeft },
    { id: rightIsImageLeft ? "cheekL" : "cheekR", poly: cheekImageRight },
    { id: "chin", poly: rect(mouthLeftX, pt(LM.LIP_BOTTOM).y + fh * 0.03, mouthRightX, box.y1) },
  ];
}

function presenceOf(value: number, table: Record<SkinPresence, number>): SkinPresence | null {
  if (value >= table.marked) return "marked";
  if (value >= table.moderate) return "moderate";
  if (value >= table.light) return "light";
  return null;
}

function zoneAt(zones: SkinZone[], x: number, y: number): SkinZoneId | null {
  for (const z of zones) if (inside(z.poly, x, y)) return z.id;
  return null;
}

/**
 * The detector proper, on fields only, so it can be pinned in Node with a
 * synthetic face. `zones` come from zonesFromPoints in the product and from
 * rectangles in tests.
 */
export function patternsFromFields(f: SkinFields, zones: SkinZone[]): SkinPatterns {
  const { sw, sh, L, A, B, mask, keep, keepCount } = f;
  const n = sw * sh;
  const scale = (sw / SAMPLE_W) ** 2;
  const minPx = Math.max(1, Math.round(SPOT_PX[0] * scale));
  const maxPx = Math.max(minPx + 1, Math.round(SPOT_PX[1] * scale));
  const flatR = Math.round(sw * FLAT_FIELD_RADIUS);

  // Kept pixels per zone, so a zone's area fraction is over its own skin.
  const zoneOf = new Int8Array(n).fill(-1);
  const zoneKeep = new Array<number>(zones.length).fill(0);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!keep[i]) continue;
      for (let z = 0; z < zones.length; z++) {
        if (inside(zones[z].poly, x + 0.5, y + 0.5)) {
          zoneOf[i] = z;
          zoneKeep[z]++;
          break;
        }
      }
    }
  }

  // ---- spots: flat-fielded a* and L*, thresholds in the person's own spread
  const hpA = highPass(A, mask, sw, sh, flatR);
  const hpL = highPass(L, mask, sw, sh, flatR);
  const keptA: number[] = [];
  const keptL: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) { keptA.push(hpA[i]); keptL.push(hpL[i]); }
  const sA = Math.max(SPREAD_FLOOR_A, robustSpread(keptA));
  const sL = Math.max(SPREAD_FLOOR_L, robustSpread(keptL));

  // Candidates come from the whole skin mask, not the trimmed `keep`: a mark
  // is darker than the skin around it by definition, and the lightness tails
  // that `keep` drops are exactly where the darkest marks sit. The tails are
  // trimmed to shed hair, frames and blown highlights, and those still fall
  // out here, on size: they are far larger than any spot.
  const redBin = new Uint8Array(n);
  const darkBin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    // A mark is a dark blob that is NOT a red one. Requiring the colour to be
    // unchanged as well threw away real marks, which are usually a little
    // less red than the skin around them, not exactly as red.
    if (hpA[i] > SPOT_SPREADS * sA) redBin[i] = 1;
    else if (hpL[i] < -SPOT_SPREADS * sL) darkBin[i] = 1;
  }
  const spotReading = (bin: Uint8Array, id: SkinPatternId): SkinPatternReading | null => {
    const comps = components(bin, sw, sh).filter((c) => c.size >= minPx && c.size <= maxPx);
    if (!comps.length) return null;
    const density = comps.length / (keepCount / 10_000);
    const presence = presenceOf(density, SPOT_DENSITY);
    if (!presence) return null;
    const counts = new Map<SkinZoneId, number>();
    for (const c of comps) {
      const z = zoneAt(zones, c.cx + 0.5, c.cy + 0.5);
      if (z) counts.set(z, (counts.get(z) ?? 0) + 1);
    }
    return {
      id,
      presence,
      zones: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([zone, count]) => ({ zone, count })),
    };
  };

  const patterns: SkinPatternReading[] = [];
  const red = spotReading(redBin, "inflamed-spot-pattern");
  if (red) patterns.push(red);
  const dark = spotReading(darkBin, "post-blemish-mark-pattern");
  if (dark) patterns.push(dark);

  // ---- diffuse redness: zone contrast on raw a*, which a global colour cast
  // cannot move because it lifts both groups together
  const zoneIndex = (id: SkinZoneId) => zones.findIndex((z) => z.id === id);
  const sumA = new Array<number>(zones.length).fill(0);
  for (let i = 0; i < n; i++) if (keep[i] && zoneOf[i] >= 0) sumA[zoneOf[i]] += A[i];
  const groupMean = (ids: SkinZoneId[]): number | null => {
    let s = 0, c = 0;
    for (const id of ids) {
      const z = zoneIndex(id);
      if (z < 0) continue;
      s += sumA[z];
      c += zoneKeep[z];
    }
    return c >= 200 ? s / c : null;
  };
  const warm = groupMean(["cheekL", "cheekR", "nose"]);
  const ref = groupMean(["forehead", "chin"]);
  if (warm != null && ref != null) {
    const contrast = warm - ref;
    const presence = presenceOf(contrast, REDNESS_A);
    if (presence) {
      const zonesOut: SkinPatternReading["zones"] = [];
      for (const id of ["cheekL", "cheekR", "nose"] as SkinZoneId[]) {
        const z = zoneIndex(id);
        if (z < 0 || zoneKeep[z] < 100) continue;
        const d = sumA[z] / zoneKeep[z] - ref;
        if (d >= REDNESS_A.light) zonesOut.push({ zone: id, areaPct: Math.round(d * 10) / 10 });
      }
      patterns.push({ id: "redness-pattern", presence, zones: zonesOut });
    }
  }

  // ---- uneven pigment: a band between the spot scale and the light
  const rSmall = Math.max(1, Math.round(sw * PIGMENT_BAND[0]));
  const rLarge = Math.max(rSmall + 1, Math.round(sw * PIGMENT_BAND[1]));
  const band = (field: Float32Array): Float32Array => {
    const small = maskedBlur(field, mask, sw, sh, rSmall);
    const large = maskedBlur(field, mask, sw, sh, rLarge);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = mask[i] ? small[i] - large[i] : 0;
    return out;
  };
  const midL = band(L);
  const midB = band(B);
  const keptMidL: number[] = [];
  const keptMidB: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) { keptMidL.push(midL[i]); keptMidB.push(midB[i]); }
  const sML = Math.max(SPREAD_FLOOR_L, robustSpread(keptMidL));
  const sMB = Math.max(SPREAD_FLOOR_A, robustSpread(keptMidB));
  // Counted over the skin mask with a hair guard rather than over `keep`: a
  // pigment patch IS the dark tail of a face's lightness, so the tail trim
  // that keeps hair and frames out of the statistics would also cut the
  // patches in half. Hair is far darker than any patch, so anything more than
  // half the trimmed range below the low tail is treated as not skin.
  const hairGuard = f.lo - 0.5 * (f.hi - f.lo);
  let patchPx = 0;
  let skinPx = 0;
  const zonePatch = new Array<number>(zones.length).fill(0);
  const zoneSkin = new Array<number>(zones.length).fill(0);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!mask[i] || L[i] < hairGuard) continue;
      skinPx++;
      let z = zoneOf[i];
      if (z < 0 && !keep[i]) {
        for (let k = 0; k < zones.length; k++) if (inside(zones[k].poly, x + 0.5, y + 0.5)) { z = k; break; }
      }
      if (z >= 0) zoneSkin[z]++;
      if (Math.abs(midL[i]) > PIGMENT_SPREADS * sML || Math.abs(midB[i]) > PIGMENT_SPREADS * sMB) {
        patchPx++;
        if (z >= 0) zonePatch[z]++;
      }
    }
  }
  const area = skinPx ? patchPx / skinPx : 0;
  const pigment = presenceOf(area, PIGMENT_AREA);
  if (pigment) {
    patterns.push({
      id: "uneven-pigment-pattern",
      presence: pigment,
      zones: zones
        .map((z, i) => ({ zone: z.id, areaPct: zoneSkin[i] ? Math.round((zonePatch[i] / zoneSkin[i]) * 1000) / 10 : 0 }))
        .filter((z) => z.areaPct >= PIGMENT_AREA.light * 100)
        .sort((a, b) => b.areaPct - a.areaPct),
    });
  }

  // ---- confidence: what the photograph can and cannot support
  let confidence = 0.85;
  const caveats: string[] = [];
  if (f.coverage < 0.12) { confidence -= 0.25; caveats.push("little usable skin in this photo"); }
  const tex = textureRatio(L, keep, sw, sh);
  if (tex > 0 && tex < 0.55) { confidence -= 0.25; caveats.push("the photo is soft"); }
  if (f.hi > 97) { confidence -= 0.25; caveats.push("bright areas are blown out"); }
  if (Math.abs(f.meanA) > 18 || Math.abs(f.meanB) > 32) { confidence -= 0.25; caveats.push("a strong colour cast"); }
  confidence = Math.max(0.05, Math.round(confidence * 100) / 100);

  return {
    patterns,
    confidence,
    caveat: caveats.length ? `Image may be affecting this: ${caveats.join(", ")}.` : null,
    coverage: f.coverage,
    tier: "trial",
  };
}

/**
 * The product entry point: sample the face exactly as skin.ts does, build the
 * fields, place the zones from the mesh, and detect. Null when the face is
 * too small or the sample has too little skin, which the report shows as
 * "unable to assess", never as clear.
 */
export function detectSkinPatterns(
  source: CanvasImageSource,
  lm: NormalizedLandmark[],
  width: number,
  height: number,
): SkinPatterns | null {
  if (typeof document === "undefined") return null;
  const R = faceRings();
  const pt = (i: number): Pt => ({ x: lm[i].x * width, y: lm[i].y * height });
  const oval = R.oval.map(pt);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of oval) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const fw = x1 - x0;
  const fh = y1 - y0;
  if (!(fw > 4 && fh > 4)) return null;
  const sw = SAMPLE_W;
  const sh = Math.max(8, Math.round((fh / fw) * SAMPLE_W));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const cx = c.getContext("2d", { willReadFrequently: true });
  if (!cx) return null;
  cx.drawImage(source, x0, y0, fw, fh, 0, 0, sw, sh);
  const data = cx.getImageData(0, 0, sw, sh).data;
  const toLocal = (p: Pt): Pt => ({ x: ((p.x - x0) / fw) * sw, y: ((p.y - y0) / fh) * sh });
  const skinPoly = dilate(oval.map(toLocal), 0.94);
  const holes = [
    dilate(R.eyeL.map(pt).map(toLocal), 1.7),
    dilate(R.eyeR.map(pt).map(toLocal), 1.7),
    dilate(R.lips.map(pt).map(toLocal), 1.25),
    dilate(R.browL.map(pt).map(toLocal), 1.35),
    dilate(R.browR.map(pt).map(toLocal), 1.35),
  ];
  const fields = extractSkinFields(data, sw, sh, skinPoly, holes);
  if (!fields) return null;
  const zones = zonesFromPoints((i) => toLocal(pt(i)), { x0: 0, y0: 0, x1: sw, y1: sh });
  return patternsFromFields(fields, zones);
}

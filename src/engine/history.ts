import type { RegionId, Report, Sex } from "./types.ts";

// Device-local scan history (localStorage) — powers week-over-week deltas
// with no accounts and no backend. One previous scan per sex is kept.

export interface StoredScan {
  date: string; // ISO
  sex: Sex;
  overall: number;
  regions: Partial<Record<RegionId, number>>;
}

export interface ScanDelta {
  daysAgo: number;
  overall: number; // signed score delta vs previous scan
  regions: Array<{ region: RegionId; delta: number }>;
  reading: DeltaReading;
}

// What a change between two scans is actually worth taking seriously.
//
//   "noise"    — inside single-photo measurement spread. Not a change.
//   "tooSoon"  — big enough to be outside that spread, but days apart, and a
//                face does not restructure in days. Still capture.
//   "worthNoting" — outside the spread and enough time has passed for it to be
//                real. Still not proof: capture remains the leading
//                alternative.
export type DeltaReading = "noise" | "tooSoon" | "worthNoting";

// Measured, not chosen. Rescanning the same person from different photographs
// moves the overall score with an SD of 1.32 — and that figure is an UPPER
// bound on noise, because the repeat photos it came from span years of genuine
// ageing, so some of that spread is real change rather than measurement error.
// Between different people the SD is 1.20, which is the uncomfortable part: two
// photos of one person disagree by more than two people do.
//
// The whole point of reading a delta against this number rather than against
// zero is that it stops the app selling a fluctuation as progress. Hard-coding
// "two days means lighting, two weeks means real" without reference to the
// spread would be exactly the kind of invention that was stripped out of the
// blur gate and the population curve.
const NOISE_SD = 1.32;

// Below this, a face has not changed shape. Body composition and skin move over
// weeks; nothing structural moves over a long weekend.
const STRUCTURAL_DAYS = 4;

export function readDelta(overall: number, daysAgo: number): DeltaReading {
  if (Math.abs(overall) < NOISE_SD) return "noise";
  return daysAgo < STRUCTURAL_DAYS ? "tooSoon" : "worthNoting";
}

const KEY = (sex: Sex) => `truemax:lastScan:${sex}`;

export function compareAndStore(report: Report): ScanDelta | null {
  let prev: StoredScan | null = null;
  try {
    const rawPrev = localStorage.getItem(KEY(report.sex));
    if (rawPrev) prev = JSON.parse(rawPrev) as StoredScan;
  } catch {
    prev = null;
  }

  const current: StoredScan = {
    date: new Date().toISOString(),
    sex: report.sex,
    overall: report.overall,
    regions: Object.fromEntries(report.regions.map((r) => [r.region, r.score])),
  };
  try {
    localStorage.setItem(KEY(report.sex), JSON.stringify(current));
  } catch {
    /* storage unavailable (private mode) — deltas just won't show */
  }

  if (!prev) return null;
  const daysAgo = Math.max(
    0,
    Math.round((Date.now() - new Date(prev.date).getTime()) / 86400000),
  );
  const overall = Math.round((report.overall - prev.overall) * 10) / 10;
  return {
    daysAgo,
    overall,
    reading: readDelta(overall, daysAgo),
    regions: report.regions
      .filter((r) => prev.regions[r.region] !== undefined)
      .map((r) => ({
        region: r.region,
        delta: Math.round((r.score - (prev.regions[r.region] as number)) * 10) / 10,
      })),
  };
}

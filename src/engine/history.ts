import type { RegionId, Report, Sex } from "./types.js";

// Device-local scan history (localStorage) — powers week-over-week deltas and
// the history view with no accounts and no backend. A capped log of scans is
// kept per sex, and it holds only numbers.
//
// Thumbnails of the photographs live separately, in IndexedDB, keyed by the
// same scan date — see engine/photoStore.ts for why they are stored at all and
// what that does and does not change about the privacy promise. Keeping them
// out of this file is deliberate: the log stays small, synchronous and cheap to
// read on every scan, and anything that clears the images cannot corrupt the
// numbers.

export interface StoredScan {
  date: string; // ISO
  sex: Sex;
  overall: number;
  regions: Partial<Record<RegionId, number>>;
}

export interface ScanDelta {
  daysAgo: number;
  overall: number; // signed score delta vs the previous scan
  // Signed delta against the mean of all PRIOR scans, and how many that mean is
  // drawn from. Null when this is the first scan. "vs last" answers "did it
  // move since Tuesday"; "vs average" answers "where do I usually land", which
  // is the more honest of the two against a noisy instrument — one prior scan
  // can be an outlier, the running mean cannot.
  vsAverage: number | null;
  averageOf: number;
  regions: Array<{ region: RegionId; delta: number }>;
  reading: DeltaReading;
}

// How many scans to keep per sex. Enough for a long trend without letting
// localStorage grow without bound; each entry is a few hundred bytes.
const LOG_CAP = 120;
const LOG_KEY = (sex: Sex) => `truemax:history:${sex}`;

export function readHistory(sex: Sex): StoredScan[] {
  try {
    const raw = localStorage.getItem(LOG_KEY(sex));
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredScan[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Every scan ever taken on this device, both sexes, newest first — for a
// history view that does not care which reference population each was against.
export function readAllHistory(): StoredScan[] {
  return [...readHistory("male"), ...readHistory("female")].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

function writeHistory(sex: Sex, log: StoredScan[]): void {
  try {
    localStorage.setItem(LOG_KEY(sex), JSON.stringify(log.slice(-LOG_CAP)));
  } catch {
    /* storage unavailable (private mode) — history just won't persist */
  }
}

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / (a.length || 1);

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
// 0.87, not the measured 1.32: scores now pass through the 0.66 measurement-
// noise shrinkage in scoring.ts, which compresses the same-face spread by the
// same factor (0.66 x 1.32 = 0.87). Leaving this at 1.32 would have called
// genuine, now-compressed progress "noise".
const NOISE_SD = 0.87;

// Below this, a face has not changed shape. Body composition and skin move over
// weeks; nothing structural moves over a long weekend.
const STRUCTURAL_DAYS = 4;

export function readDelta(overall: number, daysAgo: number): DeltaReading {
  if (Math.abs(overall) < NOISE_SD) return "noise";
  return daysAgo < STRUCTURAL_DAYS ? "tooSoon" : "worthNoting";
}

export function compareAndStore(report: Report): ScanDelta | null {
  const log = readHistory(report.sex);
  const prev = log.length ? log[log.length - 1] : null;

  const current: StoredScan = {
    date: new Date().toISOString(),
    sex: report.sex,
    overall: report.overall,
    regions: Object.fromEntries(report.regions.map((r) => [r.region, r.score])),
  };
  // Average is taken over PRIOR scans, before this one is appended, so a fresh
  // scan is compared to where the face usually lands rather than to itself.
  const priorMean = log.length ? mean(log.map((s) => s.overall)) : null;
  writeHistory(report.sex, [...log, current]);

  if (!prev) return null;
  const daysAgo = Math.max(
    0,
    Math.round((Date.now() - new Date(prev.date).getTime()) / 86400000),
  );
  const overall = Math.round((report.overall - prev.overall) * 10) / 10;
  return {
    daysAgo,
    overall,
    vsAverage: priorMean == null ? null : Math.round((report.overall - priorMean) * 10) / 10,
    averageOf: log.length,
    reading: readDelta(overall, daysAgo),
    regions: report.regions
      .filter((r) => prev.regions[r.region] !== undefined)
      .map((r) => ({
        region: r.region,
        delta: Math.round((r.score - (prev.regions[r.region] as number)) * 10) / 10,
      })),
  };
}

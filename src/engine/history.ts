import type { RegionId, Report, Sex } from "./types.js";
import { scopedStorageKey } from "./scanScope.js";
import { createScanId, isScanId } from "./scanSession.js";

// Device-local scan history (localStorage) — powers week-over-week deltas and
// the history view without putting scan data in the backend. A capped log of
// numbers is kept per active account/anonymous owner and sex.
//
// Thumbnails of the photographs live separately, in IndexedDB, keyed by the
// same immutable scan ID — see engine/photoStore.ts for why they are stored and
// what that does and does not change about the privacy promise. Keeping them
// out of this file is deliberate: the log stays small, synchronous and cheap to
// read on every scan, and anything that clears the images cannot corrupt the
// numbers.

export interface StoredScan {
  // Legacy entries used their timestamp as an implicit identity. Every new
  // entry has a UUID shared with its pending analysis, photos, and corrections.
  scanId?: string;
  date: string; // ISO
  sex: Sex;
  overall: number;
  regions: Partial<Record<RegionId, number>>;
  // Missing means the scan predates score calibration versioning. Scores from
  // different versions must never be joined into one trend or delta.
  scoreVersion?: number;
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
const LOG_KEY = (sex: Sex) => scopedStorageKey(`truemax:history:${sex}`);

export const CURRENT_SCORE_VERSION = 2;

export function isCurrentScore(scan: StoredScan): boolean {
  return scan.scoreVersion === CURRENT_SCORE_VERSION;
}

export function comparableScans(scans: StoredScan[]): StoredScan[] {
  return scans.filter(isCurrentScore);
}

export function readHistory(sex: Sex): StoredScan[] {
  try {
    const key = LOG_KEY(sex);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredScan[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Every scan belonging to the active device-local owner, both sexes, newest
// first — for a history view that does not care which reference population
// each was against.
export function readAllHistory(): StoredScan[] {
  return [...readHistory("male"), ...readHistory("female")].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function readComparableHistory(sex: Sex): StoredScan[] {
  return comparableScans(readHistory(sex));
}

export function readAllComparableHistory(): StoredScan[] {
  return comparableScans(readAllHistory());
}

export function scanStorageKey(scan: StoredScan): string {
  return isScanId(scan.scanId) ? scan.scanId : scan.date;
}

function writeHistory(sex: Sex, log: StoredScan[]): void {
  try {
    const key = LOG_KEY(sex);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(log.slice(-LOG_CAP)));
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

// Measured, not chosen. On the former uncalibrated display, rescanning the same
// person from different photographs moved the overall score with an SD of
// 1.32 — and that figure is an UPPER
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
// Aggregate scores now use the conservative 0.40 calibration in scoring.ts.
// The same measured spread therefore becomes about 0.53 points. We round the
// operational floor UP to 0.6: a slightly wide floor can hide slow progress;
// a narrow one invents progress from the camera.
export const DISPLAY_NOISE = 0.6;

// Below this, a face has not changed shape. Body composition and skin move over
// weeks; nothing structural moves over a long weekend.
const STRUCTURAL_DAYS = 4;

export function readDelta(overall: number, daysAgo: number): DeltaReading {
  if (Math.abs(overall) < DISPLAY_NOISE) return "noise";
  return daysAgo < STRUCTURAL_DAYS ? "tooSoon" : "worthNoting";
}

export function compareAndStore(report: Report, scanId = createScanId()): ScanDelta | null {
  if (!isScanId(scanId)) throw new Error("Scan ID is invalid");
  const log = readHistory(report.sex);
  const otherSex: Sex = report.sex === "male" ? "female" : "male";
  const otherLog = readHistory(otherSex);
  const otherIndex = otherLog.findIndex((scan) => scan.scanId === scanId);
  // Re-running one scan after a landmark correction updates its row. It must
  // not append a second "visit" or compare the corrected result against its
  // own first draft. Changing reference population also moves the same row
  // between the two logs rather than creating one scan under each population.
  const existingIndex = log.findIndex((scan) => scan.scanId === scanId);
  const existing = existingIndex >= 0
    ? log[existingIndex]
    : otherIndex >= 0
      ? otherLog[otherIndex]
      : null;
  const priorLog = existingIndex >= 0 ? log.filter((_, index) => index !== existingIndex) : log;
  const comparable = comparableScans(priorLog);
  const prev = comparable.length ? comparable[comparable.length - 1] : null;

  const current: StoredScan = {
    scanId,
    date: existing?.date ?? new Date().toISOString(),
    sex: report.sex,
    overall: report.overall,
    regions: Object.fromEntries(report.regions.map((r) => [r.region, r.score])),
    scoreVersion: CURRENT_SCORE_VERSION,
  };
  // Average is taken over PRIOR scans, before this one is appended, so a fresh
  // scan is compared to where the face usually lands rather than to itself.
  const priorMean = comparable.length ? mean(comparable.map((s) => s.overall)) : null;
  if (otherIndex >= 0) writeHistory(otherSex, otherLog.filter((_, index) => index !== otherIndex));
  if (existingIndex >= 0) {
    const next = [...log];
    next[existingIndex] = current;
    writeHistory(report.sex, next);
  } else {
    writeHistory(report.sex, [...log, current]);
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
    vsAverage: priorMean == null ? null : Math.round((report.overall - priorMean) * 10) / 10,
    averageOf: comparable.length,
    reading: readDelta(overall, daysAgo),
    regions: report.regions
      .filter((r) => prev.regions[r.region] !== undefined)
      .map((r) => ({
        region: r.region,
        delta: Math.round((r.score - (prev.regions[r.region] as number)) * 10) / 10,
      })),
  };
}

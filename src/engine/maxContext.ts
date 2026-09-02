import { REGION_NAMES } from "./scoring.js";
import type { Report, ScoredMetric } from "./types.js";
import type { VerdictTone } from "./analysisMode.js";
import { ordinal } from "./ordinal.js";

// ---------------------------------------------------------------------------
// What Max is allowed to know.
//
// The photograph never leaves the device, so the numbers computed from it are
// the only thing there is to send. This module decides which of them go, and
// the answer is deliberately not "all of them".
//
// Forty-one measurements is more context than any question needs and every
// token of it is billed on every message of the conversation. Worse, a model
// handed the full table tends to answer by reciting it. So the payload carries
// the headline figures, the region standings, and the handful of measurements
// that are actually doing something: the worst few, which is what somebody is
// asking about, and the best few, so Max can point at what is already working
// rather than only at what is not.
//
// Nothing here computes a score. Every number is copied out of a finished
// Report, because the moment this file derives its own figure the chat and the
// results screen can disagree about one face.
// ---------------------------------------------------------------------------

export interface MaxChatContext {
  sex: "male" | "female";
  tone: VerdictTone;
  overall: number;
  percentile: number;
  potential?: number;
  pillars: Array<{ label: string; score: number }>;
  regions: Array<{ label: string; percentile: number }>;
  measurements: Array<{ label: string; reading: string; target?: string; standing?: string }>;
  focus: string[];
  activePlan?: string[];
  scans: number;
  movement?: string;
}

// How many of each end of the table travel. Six and three: the weak end is what
// gets asked about, so it carries the detail, and three strong ones is enough
// for Max to have something true to say about what is already good.
const WEAKEST = 6;
const STRONGEST = 3;

function reading(m: ScoredMetric): string {
  return `${m.value.toFixed(m.def.decimals)}${m.def.unit}`;
}

function target(m: ScoredMetric): string {
  const [lo, hi] = m.idealRange;
  return `${lo.toFixed(m.def.decimals)} to ${hi.toFixed(m.def.decimals)}${m.def.unit}`;
}

// The measurement's own standing, in words rather than a z-score, because a
// model handed "-1.4" will happily invent what that means.
function standing(m: ScoredMetric): string {
  const p = Math.round(m.percentile);
  if (p >= 85) return `top ${100 - p}%, a strength`;
  if (p >= 60) return `${ordinal(p)} percentile, above average`;
  if (p >= 40) return `${ordinal(p)} percentile, average`;
  if (p >= 15) return `${ordinal(p)} percentile, below average`;
  return `${ordinal(p)} percentile, the weakest end`;
}

// Whether the measurement can move at all without surgery. Max is forbidden
// from discussing procedures, so a metric that only surgery touches must be
// labelled as such here rather than left for him to guess about, which is how
// a well-meaning model talks itself into naming one.
//
// These describe THE MEASUREMENT, not the anatomy, and the difference is not
// pedantry — it was a live contradiction. "Jaw : cheekbone width" carried
// "moves a lot with habit change", and Max, reading his own context, stopped
// mid-answer to say that could not be right because cheekbone width is bone.
// He was half right, which is the worst kind of wrong to hand a model: the
// bone does not move, but this ratio is read off a photographed silhouette,
// and the silhouette is soft tissue. The fixability number was fine. The
// sentence was describing the skull when it meant the outline.
function movability(m: ScoredMetric): string {
  if (m.def.fixability >= 0.5) {
    return "the photographed soft-tissue outline can change; this scan cannot tell whether body composition, hydration, sleep or capture conditions caused today's reading; the bone under it does not move";
  }
  if (m.def.fixability >= 0.2) {
    return "the photographed soft tissue can move a little; this scan does not identify the cause, and the underlying structure does not move";
  }
  return "essentially fixed skeletal geometry, not changeable";
}

export interface ContextInput {
  report: Report;
  tone: VerdictTone;
  scans: number;
  // Only sent when the account can actually see it. The ceiling is a paid
  // figure and quoting it into a chat for somebody who has not bought it would
  // route around the gate the results screen enforces.
  potential?: number;
  movement?: string;
  activePlan?: string[];
}

export function buildMaxContext({ report, tone, scans, potential, movement, activePlan }: ContextInput): MaxChatContext {
  const byStanding = [...report.metrics].sort((a, b) => a.zEff - b.zEff);
  const weakest = byStanding.slice(0, WEAKEST);
  const strongest = byStanding.slice(-STRONGEST).reverse();
  // A short table can overlap at both ends. Sending one measurement twice is
  // not harmful, but it wastes a row and reads as a bug if anybody looks.
  const seen = new Set<string>();
  const picked = [...weakest, ...strongest].filter((m) => {
    if (seen.has(m.def.id)) return false;
    seen.add(m.def.id);
    return true;
  });

  return {
    sex: report.sex,
    tone,
    overall: Math.round(report.overall * 10) / 10,
    percentile: Math.round(report.overallPercentile),
    potential: potential === undefined ? undefined : Math.round(potential * 10) / 10,
    pillars: Object.entries(report.pillars).map(([label, score]) => ({
      label,
      score: Math.round(score * 10) / 10,
    })),
    regions: report.regions.map((r) => ({
      label: REGION_NAMES[r.region],
      percentile: Math.round(r.percentile),
    })),
    measurements: picked.map((m) => ({
      label: m.def.name,
      reading: reading(m),
      target: target(m),
      standing: `${standing(m)}, ${movability(m)}`,
    })),
    // The weak end again, as the thing the plan points at. Named rather than
    // described, because the routine copy itself is long and Max writes his own
    // sentences anyway.
    focus: weakest.slice(0, 4).map((m) => `${m.def.name}, currently ${reading(m)}, ${movability(m)}`),
    activePlan: activePlan?.slice(0, 8),
    scans,
    movement,
  };
}

// ---------------------------------------------------------------------------
// The dashboard's view of a scan.
//
// The Coach tab used to open the chat with no context at all and a greeting
// that implied the opposite, so a paying member's first question on the
// dashboard was answered by a model that had never seen their numbers. The
// stored row cannot carry the metric table (see StoredScan for why), but it
// carries the overall, the percentile, the pillars and the region standings,
// and that is enough for Max to talk about the scan rather than around it.
//
// Same rule as buildMaxContext: nothing here computes a score. Every figure is
// copied out of the row the results screen wrote.
// ---------------------------------------------------------------------------

export interface StoredScanView {
  sex: "male" | "female";
  date: string;
  overall: number;
  overallPercentile?: number;
  pillars?: Partial<Record<string, number>>;
  regionPercentiles?: Partial<Record<string, number>>;
  potential?: number;
}

export interface StoredContextInput {
  latest: StoredScanView;
  previous?: StoredScanView | null;
  tone: VerdictTone;
  scans: number;
  // See ContextInput.potential: only sent when the account can see it.
  includePotential: boolean;
  activePlan?: string[];
  // Injected so a test can pin "days ago" without touching the clock.
  now?: number;
}

// The plain movement line for a chat opened away from the results screen. The
// results screen has the full delta reading and its copy; this has two rows
// and a date, and says only what those support.
export function storedMovement(latest: StoredScanView, previous: StoredScanView, now = Date.now()): string | undefined {
  const delta = latest.overall - previous.overall;
  const then = new Date(previous.date).getTime();
  const at = new Date(latest.date).getTime();
  if (!Number.isFinite(delta) || !Number.isFinite(then) || !Number.isFinite(at)) return undefined;
  const daysBetween = Math.max(0, Math.round((at - then) / 86_400_000));
  const daysSince = Math.max(0, Math.round((now - at) / 86_400_000));
  const size = Math.abs(delta).toFixed(1);
  const dir = delta >= 0 ? "up" : "down";
  const reading = Math.abs(delta) < 0.6
    ? "inside the spread two photographs of one face produce, so not a change"
    : daysBetween < 4
      ? "over too short a gap to be structural, so read as capture rather than change"
      : "outside normal capture spread, worth noting";
  return `${size} ${dir} between the last two scans (${daysBetween} days apart, the latest ${daysSince} days ago): ${reading}`;
}

export function contextFromStoredScan(input: StoredContextInput): MaxChatContext {
  const { latest, previous, tone, scans, includePotential, activePlan, now } = input;
  const regionNames = REGION_NAMES as Record<string, string>;
  return {
    sex: latest.sex,
    tone,
    overall: Math.round(latest.overall * 10) / 10,
    percentile: Math.round(latest.overallPercentile ?? 50),
    potential: includePotential && latest.potential !== undefined
      ? Math.round(latest.potential * 10) / 10
      : undefined,
    pillars: Object.entries(latest.pillars ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([label, score]) => ({ label, score: Math.round(score * 10) / 10 })),
    regions: Object.entries(latest.regionPercentiles ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([region, percentile]) => ({
        label: regionNames[region] ?? region,
        percentile: Math.round(percentile),
      })),
    // No metric table in the row, and no pretending: the server's context
    // block says so to Max when both of these are empty.
    measurements: [],
    focus: [],
    activePlan: activePlan?.slice(0, 8),
    scans,
    movement: previous ? storedMovement(latest, previous, now) : undefined,
  };
}

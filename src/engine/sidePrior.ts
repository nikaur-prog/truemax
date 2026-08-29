import { scopedStorageKey } from "./scanScope.js";
import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";

// ---------------------------------------------------------------------------
// The owner's own confirmed side points, kept as a prior for their next scan.
//
// The ear cluster — gonion, condylion, cervicale, tragion — is the one part
// of the seed no edge or extremum can find: it sits off the profile line, so
// it is placed from a population template through an estimated head width,
// and that estimate is where the residual error lives (6% of head height at
// the median on the labeled dataset, 20% at the tails). But a RETURNING
// person has already answered the question: their last confirmed points say
// exactly where their ear sits in their own head's frame, and a face does
// not move between scans. Seeding from that beats any template.
//
// Stored per owner in the same scoped localStorage the scan history uses,
// and NEVER written from a guest's scan — main.ts gates the write on the
// scan being the owner's own. Suspension covers the read side: while a guest
// is being scanned, the owner's ears must not be projected onto them.
// ---------------------------------------------------------------------------

export interface StoredSidePrior {
  points: SidePoints;
  width: number;
  height: number;
  at: number;
}

const KEY = () => scopedStorageKey("truemax:sidePrior");

let suspended = false;

/** While a guest is being scanned, the owner's prior must not apply. */
export function setSidePriorSuspended(on: boolean): void {
  suspended = on;
}

export function writeSidePrior(points: SidePoints, width: number, height: number): void {
  const key = KEY();
  if (!key) return;
  try {
    const copy = {} as SidePoints;
    for (const { id } of SIDE_POINTS) copy[id] = { x: points[id].x, y: points[id].y };
    localStorage.setItem(key, JSON.stringify({ points: copy, width, height, at: Date.now() }));
  } catch {
    /* storage full or disabled: the prior is a convenience, not a record */
  }
}

export function readSidePrior(): StoredSidePrior | null {
  if (suspended) return null;
  const key = KEY();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSidePrior;
    if (!parsed?.points || !parsed.width || !parsed.height) return null;
    for (const { id } of SIDE_POINTS) {
      const p = parsed.points[id];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

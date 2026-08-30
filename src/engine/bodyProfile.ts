// ---------------------------------------------------------------------------
// Height, weight, activity and goal: what the macro calculator reads from.
//
// LOCAL ONLY, and that is a decision rather than an omission. Height and weight
// are the most sensitive thing this app would hold about a person outside the
// photograph itself, they are of no use to any server-side feature we have, and
// nothing here is ever sent anywhere. Scoped to the signed-in account by the
// same key rule the scan allowance uses, so signing out and in as somebody else
// does not hand them the previous person's body.
//
// The spec assumed these were collected at Max signup. They are not, yet: no
// profile column exists for either. Until one does, the panel asks once and
// remembers, which is the same product behaviour from the person's side and
// leaves the schema decision to be made deliberately rather than as a side
// effect of this step.
// ---------------------------------------------------------------------------

import { scopedStorageKey } from "./scanScope.js";
import { ACTIVITY, GOAL_LABEL, bodyInputIsUsable } from "./macros.js";
import type { Activity, EnergyGoal } from "./macros.js";

const KEY = "truemax.body";

export interface StoredBody {
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: EnergyGoal;
  bodyFat?: number;
  /** When it was last confirmed, so the panel can ask again after a long gap. */
  savedAt: number;
}

/** Past this, weight is a guess about somebody's past rather than a reading. */
export const STALE_DAYS = 90;

export function readBody(): StoredBody | null {
  try {
    const key = scopedStorageKey(KEY);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return usable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBody(body: Omit<StoredBody, "savedAt">, now = Date.now()): boolean {
  const next = { ...body, savedAt: now };
  if (!usable(next)) return false;
  try {
    const key = scopedStorageKey(KEY);
    if (!key) return false;
    localStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Signing out, or an account change. The body does not follow the browser. */
export function clearBody(): void {
  try {
    const key = scopedStorageKey(KEY);
    if (key) localStorage.removeItem(key);
  } catch {
    /* a storage that refuses to delete is not a state we can improve on */
  }
}

/**
 * Old enough that the weight is probably wrong.
 *
 * Not cleared, because a stale height is still a height and re-asking for both
 * is worse than confirming one. The panel uses this to ask rather than to
 * forget.
 */
export function isStale(body: StoredBody, now = Date.now()): boolean {
  return now - body.savedAt > STALE_DAYS * 24 * 60 * 60 * 1000;
}

function usable(v: unknown): v is StoredBody {
  if (!v || typeof v !== "object") return false;
  const b = v as Partial<StoredBody>;
  if (!Number.isFinite(b.savedAt)) return false;
  if (!b.activity || !ACTIVITY[b.activity]) return false;
  if (!b.goal || !GOAL_LABEL[b.goal]) return false;
  // The same plausibility bounds the calculator enforces, applied on the way
  // in as well as on the way out: a stored body that the calculator would
  // refuse is a stored body that should never have been written.
  return bodyInputIsUsable({
    age: 30, // not stored here; the age gate reads date of birth separately
    sex: "male",
    heightCm: b.heightCm,
    weightKg: b.weightKg,
    activity: b.activity,
    goal: b.goal,
    bodyFat: b.bodyFat,
  });
}

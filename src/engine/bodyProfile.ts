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
// Since 3 September 2026 the two measurements also have a server row
// (public.body_profiles, api/body-profile.ts) so a plan follows the person
// across devices. This store is now the offline cache of that row: fetch
// hydrates it, save writes through, and migrate pushes a value that was only
// ever on this device up once, when the server has nothing. Activity, goal
// and body fat stay device-only; the server holds only height and weight.
// ---------------------------------------------------------------------------

import { scopedStorageKey } from "./scanScope.js";
import { ACTIVITY, GOAL_LABEL, bodyInputIsUsable } from "./macros.js";
import type { Activity, EnergyGoal } from "./macros.js";
import { bodyMetricUsable } from "./bodyUnits.js";
import type { BodyEntry, BodyMetric, UnitSystem } from "./bodyUnits.js";

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

// ---------------------------------------------------------------------------
// The server row.
// ---------------------------------------------------------------------------

export interface ServerBodyProfile {
  heightCm: number | null;
  weightKg: number | null;
  unit: UnitSystem;
  /** True when the account is an adult on Max and the two values are missing. */
  required: boolean;
  updatedAt: string | null;
}

function parseServerBody(value: unknown): ServerBodyProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    heightCm: num(raw.heightCm),
    weightKg: num(raw.weightKg),
    unit: raw.unit === "imperial" ? "imperial" : "metric",
    required: raw.required === true,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/**
 * Read the server row and refresh the device cache from it. A row with both
 * values overwrites the cache's height and weight (the server is the truth
 * once it has one); activity and goal on the device are kept.
 */
export async function fetchBodyProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<ServerBodyProfile | null> {
  const response = await fetcher("/api/body-profile", { headers: { authorization: `Bearer ${accessToken}` } }).catch(() => null);
  if (!response || !response.ok) return null;
  const server = parseServerBody(await response.json().catch(() => null));
  if (!server) return null;
  if (server.heightCm !== null && server.weightKg !== null) {
    const local = readBody();
    writeBody({
      heightCm: server.heightCm,
      weightKg: server.weightKg,
      activity: local?.activity ?? "moderate",
      goal: local?.goal ?? "hold",
      ...(local?.bodyFat ? { bodyFat: local.bodyFat } : {}),
    });
  }
  return server;
}

/** Write through: the server first, then the cache, so a failed save leaves nothing half-done. */
export async function saveBodyProfile(
  accessToken: string,
  entry: BodyEntry,
  source: "dialog" | "settings" = "dialog",
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; metric: BodyMetric } | { ok: false; message: string }> {
  const response = await fetcher("/api/body-profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ...entry, source }),
  }).catch(() => null);
  const payload = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response || !response.ok) {
    return { ok: false, message: typeof payload?.error === "string" ? payload.error : "Your details could not be saved just then." };
  }
  const server = parseServerBody(payload);
  if (!server || server.heightCm === null || server.weightKg === null) return { ok: false, message: "Your details could not be saved just then." };
  const metric = { heightCm: server.heightCm, weightKg: server.weightKg };
  const local = readBody();
  writeBody({ ...metric, activity: local?.activity ?? "moderate", goal: local?.goal ?? "hold", ...(local?.bodyFat ? { bodyFat: local.bodyFat } : {}) });
  return { ok: true, metric };
}

/**
 * A value that lived only on this device goes up once. The server keeps
 * whatever it already has (the request is marked as a migration and the
 * route refuses to overwrite), so two devices cannot fight, and a device
 * whose cache is empty or unusable sends nothing.
 */
export async function migrateLocalBodyProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const local = readBody();
  if (!local || !bodyMetricUsable(local)) return false;
  const response = await fetcher("/api/body-profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ unit: "metric", heightCm: local.heightCm, weightKg: local.weightKg, source: "device_migration" }),
  }).catch(() => null);
  return !!response && response.ok;
}

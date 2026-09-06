// ---------------------------------------------------------------------------
// Height, weight, activity and goal: what the macro calculator reads from.
//
// The two measurements have a private server row
// (public.body_profiles, api/body-profile.ts) so a plan follows the person
// across devices. This store is now the offline cache of that row: fetch
// hydrates it, save writes through, and migrate pushes a value that was only
// ever on this device up once, when the server has nothing. Activity, goal
// and body fat stay device-only; the server holds only height and weight.
// ---------------------------------------------------------------------------

import { activeScanOwner, scopedStorageKey } from "./scanScope.js";
import { ACTIVITY, GOAL_LABEL, bodyInputIsUsable } from "./macros.js";
import type { Activity, EnergyGoal } from "./macros.js";
import { bodyMetricUsable } from "./bodyUnits.js";
import type { BodyEntry, BodyMetric, UnitSystem } from "./bodyUnits.js";

const KEY = "truemax.body";
export const BODY_PROFILE_CHANGED = "truemax:body-profile-changed";

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

function serverHasBody(server: ServerBodyProfile): server is ServerBodyProfile & BodyMetric {
  return bodyMetricUsable({ heightCm: server.heightCm ?? undefined, weightKg: server.weightKg ?? undefined });
}

function parseServerBody(value: unknown): ServerBodyProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const num = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
  if (!num(raw.heightCm) || !num(raw.weightKg) || typeof raw.required !== "boolean"
    || (raw.unit !== "metric" && raw.unit !== "imperial")
    || (raw.updatedAt !== null && (typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))))) return null;
  const heightCm = raw.heightCm as number | null;
  const weightKg = raw.weightKg as number | null;
  if (heightCm !== null && weightKg !== null && !bodyMetricUsable({ heightCm, weightKg })) return null;
  return {
    heightCm, weightKg, unit: raw.unit, required: raw.required,
    updatedAt: raw.updatedAt as string | null,
  };
}

const operations = new Map<string, Promise<unknown>>();
const synced = new Set<string>();
const currentOwner = () => {
  const owner = activeScanOwner();
  return owner?.startsWith("user:") ? owner : null;
};
function tokenOwner(accessToken: string): string | null {
  const owner = currentOwner();
  if (!owner) return null;
  try {
    // This is only cache isolation, never authorization. The endpoint still
    // verifies the token. A session can switch between awaiting getSession
    // and entering this helper, so bind the captured scope to the token too.
    const payload = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
    return owner === `user:${payload.sub}` ? owner : null;
  } catch { return null; }
}
const sameOwner = (owner: string) => currentOwner() === owner;
const marker = (owner: string) => `${KEY}:serverSynced:${owner}`;

function markSynced(owner: string): void {
  synced.add(owner);
  try { localStorage.setItem(marker(owner), "1"); } catch { /* session marker still works */ }
}

function applyServer(owner: string, server: ServerBodyProfile): void {
  if (!sameOwner(owner)) return;
  const before = JSON.stringify(readBody());
  if (serverHasBody(server)) {
    const local = readBody();
    writeBody({
      heightCm: server.heightCm, weightKg: server.weightKg,
      activity: local?.activity ?? "moderate", goal: local?.goal ?? "hold",
      ...(local?.bodyFat !== undefined ? { bodyFat: local.bodyFat } : {}),
    }, server.updatedAt ? Date.parse(server.updatedAt) : Date.now());
  } else {
    // Clearing on another device must not leave an old usable calculator here.
    clearBody();
  }
  markSynced(owner);
  if (typeof window !== "undefined" && before !== JSON.stringify(readBody())) {
    window.dispatchEvent(new Event(BODY_PROFILE_CHANGED));
  }
}

function serialized<T>(owner: string, task: () => Promise<T>): Promise<T> {
  const previous = operations.get(owner) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  operations.set(owner, result);
  void result.finally(() => { if (operations.get(owner) === result) operations.delete(owner); }).catch(() => undefined);
  return result;
}

async function callBody(accessToken: string, method: string, fetcher: typeof fetch, body?: unknown): Promise<{
  server: ServerBodyProfile | null; message: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher("/api/body-profile", {
      method, signal: controller.signal,
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { server: response.ok ? parseServerBody(payload) : null,
      message: typeof payload?.error === "string" ? payload.error : "Your details could not be saved just then." };
  } catch {
    return { server: null, message: "Your details could not be saved. Check your connection and try again." };
  } finally { clearTimeout(timer); }
}

/**
 * Read the server row and refresh the device cache from it. A row with both
 * values overwrites the cache's height and weight (the server is the truth
 * once it has one); activity and goal on the device are kept.
 */
export async function fetchBodyProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<ServerBodyProfile | null> {
  const owner = tokenOwner(accessToken);
  if (!owner) return null;
  return serialized(owner, async () => {
    if (!sameOwner(owner)) return null;
    const { server } = await callBody(accessToken, "GET", fetcher);
    if (!server || !sameOwner(owner)) return null;
    applyServer(owner, server);
    return server;
  });
}

/** Write through: the server first, then the cache, so a failed save leaves nothing half-done. */
export async function saveBodyProfile(
  accessToken: string,
  entry: BodyEntry,
  source: "dialog" | "settings" = "dialog",
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; metric: BodyMetric } | { ok: false; message: string }> {
  const owner = tokenOwner(accessToken);
  if (!owner) return { ok: false, message: "Sign in again to save your details." };
  return serialized(owner, async () => {
    if (!sameOwner(owner)) return { ok: false, message: "Your account changed. Open your details again." };
    const { server, message } = await callBody(accessToken, "PUT", fetcher, { ...entry, source });
    if (!server || !serverHasBody(server)) return { ok: false, message };
    if (!sameOwner(owner)) return { ok: false, message: "Your account changed. Open your details again." };
    applyServer(owner, server);
    return { ok: true, metric: { heightCm: server.heightCm, weightKg: server.weightKg } };
  });
}

export async function deleteBodyProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<ServerBodyProfile | null> {
  const owner = tokenOwner(accessToken);
  if (!owner) return null;
  return serialized(owner, async () => {
    if (!sameOwner(owner)) return null;
    const { server } = await callBody(accessToken, "DELETE", fetcher);
    if (!server || !sameOwner(owner)) return null;
    applyServer(owner, server);
    return server;
  });
}

/**
 * A value that lived only on this device goes up once. The server keeps
 * whatever it already has (the request is marked as a migration and the
 * route refuses to overwrite), so two devices cannot fight, and a device
 * whose cache is empty or unusable sends nothing.
 */
export async function migrateLocalBodyProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const owner = tokenOwner(accessToken);
  if (!owner) return false;
  return serialized(owner, async () => {
    if (!sameOwner(owner) || synced.has(owner)) return false;
    try { if (localStorage.getItem(marker(owner)) === "1") return false; } catch { /* continue with session marker */ }
    const local = readBody();
    if (!local || !bodyMetricUsable(local)) return false;
    const previous = await callBody(accessToken, "GET", fetcher);
    if (!previous.server || !sameOwner(owner)) return false;
    // A row with a timestamp was already saved or explicitly cleared. Do not
    // resurrect cleared measurements from a stale second device's cache.
    if (previous.server.updatedAt !== null || serverHasBody(previous.server)) {
      applyServer(owner, previous.server);
      return false;
    }
    const { server } = await callBody(accessToken, "PUT", fetcher, {
      unit: "metric", heightCm: local.heightCm, weightKg: local.weightKg, source: "device_migration",
    });
    if (!server || !sameOwner(owner)) return false;
    applyServer(owner, server);
    return true;
  });
}

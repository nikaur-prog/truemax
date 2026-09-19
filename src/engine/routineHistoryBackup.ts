import { activeScanOwner, scopedStorageKey } from "./scanScope.js";
import { readProtocols, writeProtocols, normaliseStoredProtocol } from "./protocol.js";
import type { Protocol, CheckIn } from "./protocol.js";
import { RECS } from "./recommendations.js";

const FORMAT = "truemax-routine-history";
export const ROUTINE_BACKUP_MAX_BYTES = 2_000_000;
const DAY = 86_400_000;
const STATUSES = ["offered", "committed", "running", "declined", "judged"] as const;

interface RoutineBackup {
  format: typeof FORMAT;
  version: 1;
  owner: string;
  exportedAt: number;
  coverage: "device-retained-history";
  protocols: Protocol[];
}

export interface RoutineImportPreview {
  routines: number;
  ticks: number;
  checkIns: number;
  partialHistories: number;
  newRoutines: number;
}

function requireOwner(owner: string): void {
  if (!owner.startsWith("user:") || activeScanOwner() !== owner) {
    throw new Error("Sign in to the account that owns this routine backup.");
  }
}

function stamp(value: unknown, nullable: boolean, latest: number): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > latest) {
    throw new Error("The backup contains an invalid routine date. Nothing was imported.");
  }
  return value;
}

function string(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length > max || (pattern && !pattern.test(value))) {
    throw new Error("The backup contains an invalid routine field. Nothing was imported.");
  }
  return value;
}

function validateProtocol(value: unknown, now: number): Protocol {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid routine in backup.");
  const raw = value as Record<string, unknown>;
  const id = string(raw.id, 80, /^[a-zA-Z0-9_-]+$/);
  const recId = string(raw.recId, 40, /^[a-zA-Z0-9_-]+$/);
  const rec = RECS.find((item) => item.id === recId);
  if (!rec) throw new Error("This backup contains a routine this version cannot restore. Nothing was imported.");
  const title = string(raw.title, 120);
  if (!title.trim() || /[\u0000-\u001f\u007f]/.test(title)) throw new Error("Invalid routine title in backup.");
  if (raw.channel !== rec.channel || !STATUSES.includes(raw.status as Protocol["status"])) throw new Error("Invalid routine type in backup.");
  if (raw.start !== undefined && !["acquire", "book", "commit", "instant"].includes(String(raw.start))) throw new Error("Invalid routine start type.");
  if (typeof raw.weeksToJudge !== "number" || !Number.isFinite(raw.weeksToJudge) || raw.weeksToJudge < 0 || raw.weeksToJudge > 104) {
    throw new Error("Invalid routine review interval.");
  }
  const offeredAt = stamp(raw.offeredAt, false, now + DAY)!;
  const startedAt = stamp(raw.startedAt, true, now + DAY);
  const startBy = stamp(raw.startBy, true, now + 3660 * DAY);
  if (raw.status === "running" && startedAt === null) throw new Error("A running routine is missing its recorded start date.");
  if (raw.historyPartial !== undefined && typeof raw.historyPartial !== "boolean") throw new Error("Invalid history coverage in backup.");
  if (!Array.isArray(raw.checkIns) || raw.checkIns.length > 2_000) throw new Error("Too many or invalid check-ins in backup. Nothing was imported.");
  const checkIns: CheckIn[] = raw.checkIns.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid check-in in backup.");
    const check = item as Record<string, unknown>;
    if (![true, false, null].includes(check.using as boolean | null) || ![true, false, null].includes(check.noticing as boolean | null)) {
      throw new Error("Invalid check-in answer in backup.");
    }
    return { at: stamp(check.at, false, now + DAY)!, using: check.using as boolean | null, noticing: check.noticing as boolean | null };
  });
  const rawTicks = raw.ticks ?? [];
  if (!Array.isArray(rawTicks) || rawTicks.length > 5_000) throw new Error("Too many or invalid tick dates in backup. Nothing was imported.");
  const ticks = rawTicks.map((value: unknown) => {
    const day = string(value, 10, /^\d{4}-\d{2}-\d{2}$/);
    const at = Date.parse(`${day}T12:00:00Z`);
    if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== day || at > now + 2 * DAY) throw new Error("Invalid tick date in backup.");
    return day;
  });
  return normaliseStoredProtocol({ id, recId, title, channel: rec.channel, metricId: string(raw.metricId, 40, /^[a-zA-Z0-9_-]*$/),
    weeksToJudge: raw.weeksToJudge, offeredAt, startedAt, startBy, status: raw.status as Protocol["status"],
    ...(raw.start === undefined ? {} : { start: raw.start as Protocol["start"] }),
    ticks: [...new Set(ticks)].sort(), checkIns: mergeChecks([], checkIns),
    ...(raw.historyPartial === undefined ? {} : { historyPartial: raw.historyPartial as boolean }) });
}

function mergeChecks(previous: readonly CheckIn[], next: readonly CheckIn[]): CheckIn[] {
  const byDate = new Map<number, CheckIn>();
  for (const check of [...previous, ...next]) {
    const prior = byDate.get(check.at);
    byDate.set(check.at, prior ? { at: check.at,
      using: prior.using === check.using ? check.using : null,
      noticing: prior.noticing === check.noticing ? check.noticing : null } : check);
  }
  return [...byDate.values()].sort((a, b) => a.at - b.at);
}

/** Keeps terminal records as tombstones. Import never infers a start or awards points. */
export function mergeRoutineHistory(local: readonly Protocol[], incoming: readonly Protocol[], now = Date.now()): Protocol[] {
  if (local.length > 40 || incoming.length > 40) throw new Error("This device supports up to 40 routine records. Nothing was imported.");
  const byRec = new Map<string, Protocol>();
  const identities = new Map<string, string>();
  const stage = { offered: 0, committed: 1, running: 2, declined: 3, judged: 3 };
  for (const value of [...local, ...incoming]) {
    const next = validateProtocol(value, now);
    if (identities.has(next.id) && identities.get(next.id) !== next.recId) throw new Error("Conflicting routine identities in backup.");
    identities.set(next.id, next.recId);
    const prior = byRec.get(next.recId);
    if (!prior) { byRec.set(next.recId, next); continue; }
    const status = stage[prior.status] >= 3 || stage[prior.status] >= stage[next.status] ? prior.status : next.status;
    byRec.set(next.recId, { ...prior, status, startedAt: prior.startedAt ?? next.startedAt,
      startBy: Math.max(prior.startBy ?? 0, next.startBy ?? 0) || null,
      ticks: [...new Set([...(prior.ticks ?? []), ...(next.ticks ?? [])])].sort(),
      checkIns: mergeChecks(prior.checkIns, next.checkIns),
      // An import cannot prove that the gaps in either partial record were filled.
      historyPartial: Boolean(prior.historyPartial || next.historyPartial) });
  }
  if (byRec.size > 40) throw new Error("The merged history exceeds this device's 40-routine limit. Nothing was imported.");
  return [...byRec.values()].map((routine) => validateProtocol(routine, now));
}

function parseBackup(json: string, owner: string, now: number): RoutineBackup {
  requireOwner(owner);
  if (new TextEncoder().encode(json).length > ROUTINE_BACKUP_MAX_BYTES) throw new Error("This routine backup exceeds the 2 MB limit. Nothing was imported.");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("This file is not valid routine-backup JSON."); }
  if (!value || typeof value !== "object") throw new Error("Invalid routine backup.");
  const raw = value as Record<string, unknown>;
  if (raw.format !== FORMAT || raw.version !== 1 || raw.coverage !== "device-retained-history") throw new Error("This routine backup format is not supported.");
  if (raw.owner !== owner) throw new Error("This routine backup belongs to a different account. Nothing was imported.");
  if (!Array.isArray(raw.protocols)) throw new Error("This routine backup is missing its records.");
  return { format: FORMAT, version: 1, owner, exportedAt: stamp(raw.exportedAt, false, now + DAY)!,
    coverage: "device-retained-history", protocols: mergeRoutineHistory([], raw.protocols, now) };
}

function readRetainedHistory(owner: string, now: number): Protocol[] {
  requireOwner(owner);
  // The ordinary tracker reader repairs legacy entries in storage. A download
  // or import preview must be strictly read-only, including for those entries.
  const raw = localStorage.getItem(scopedStorageKey("truemax:protocols")!);
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The device's routine history could not be read. Nothing was replaced."); }
  if (!Array.isArray(value)) throw new Error("The device's routine history has an unsupported format. Nothing was replaced.");
  return mergeRoutineHistory([], value, now);
}

/** Private download, not an upload or a claim that previously discarded history exists. */
export function exportRoutineHistory(owner: string, now = Date.now()): string {
  requireOwner(owner);
  const backup: RoutineBackup = { format: FORMAT, version: 1, owner, exportedAt: now,
    coverage: "device-retained-history", protocols: readRetainedHistory(owner, now) };
  const json = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(json).length > ROUTINE_BACKUP_MAX_BYTES) throw new Error("This device's routine history exceeds the 2 MB backup limit. Nothing was downloaded.");
  return json;
}

export function previewRoutineHistoryImport(json: string, owner: string, now = Date.now()): RoutineImportPreview {
  const backup = parseBackup(json, owner, now);
  const current = readRetainedHistory(owner, now);
  mergeRoutineHistory(current, backup.protocols, now);
  return { routines: backup.protocols.length,
    ticks: backup.protocols.reduce((sum, p) => sum + (p.ticks?.length ?? 0), 0),
    checkIns: backup.protocols.reduce((sum, p) => sum + p.checkIns.length, 0),
    partialHistories: backup.protocols.filter((p) => p.historyPartial).length,
    newRoutines: backup.protocols.filter((p) => !current.some((local) => local.recId === p.recId)).length };
}

/** Call only after the person reviews the import preview and explicitly confirms. */
export function importRoutineHistory(json: string, owner: string, now = Date.now()): RoutineImportPreview {
  const preview = previewRoutineHistoryImport(json, owner, now);
  const backup = parseBackup(json, owner, now);
  const merged = mergeRoutineHistory(readRetainedHistory(owner, now), backup.protocols, now);
  requireOwner(owner);
  writeProtocols(merged);
  if (activeScanOwner() !== owner || JSON.stringify(readProtocols()) !== JSON.stringify(merged)) {
    throw new Error("Routine history could not be saved on this device. Check available storage and retry.");
  }
  return preview;
}

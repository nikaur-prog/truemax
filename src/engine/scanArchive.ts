import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Report, ScoredMetric } from "./types.js";
import { METRICS } from "./metrics.js";
import { SIDE_METRICS } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import { activeScanOwner } from "./scanScope.js";

// ---------------------------------------------------------------------------
// Everything needed to REOPEN a scan interactively, not just to chart it.
//
// The localStorage history row is deliberately tiny — an overall, region
// scores, a percentile — because it lives against a 120-entry cap and powers
// trends. That is the right decision for the log and the wrong ceiling for
// recall: the one thing somebody wants from a scan dated three weeks ago is
// to walk it again — hover the measurements, watch the lines draw on their
// own face — and none of that exists without the landmarks and the full
// metric array.
//
// So those live here, in IndexedDB beside the photo thumbnails, keyed by the
// same owner + immutable scan ID and pruned by the same history list. Scans
// taken before this shipped have no archive and never will; the recall sheet
// simply does not offer the button for them, in keeping with the standing
// rule that a missing record is said plainly rather than reconstructed.
//
// SERIALISATION: a ScoredMetric carries its MetricDef, which is code-owned
// reference data, not scan data. Archiving forty copies of the def per scan
// would freeze old ideal bands and weights into storage and desynchronise
// them from the engine that renders them. So defs are stripped to their id
// on write and rehydrated from the live METRICS / SIDE_METRICS tables on
// read; a metric whose id no longer exists in the engine is dropped rather
// than resurrected half-shaped.
// ---------------------------------------------------------------------------

const DB_NAME = "truemax";
const STORE = "scanArchive";
// MUST match engine/photoStore.ts and engine/faceLibrary.ts, which share this
// database. Bumped to 3 when this store was added; all three modules create
// all three stores in their upgrade handlers, because any of them can be the
// one that triggers the upgrade.
const DB_VERSION = 3;

export interface ScanArchive {
  /** The merged report, defs stripped on disk and rehydrated on load. */
  report: Report;
  /** The side half of a merged report, same treatment. */
  sideReport?: Report | null;
  landmarks: NormalizedLandmark[];
  sidePoints?: SidePoints | null;
  /** Present when the scan was of somebody other than the account holder. */
  subjectName?: string;
  /** ISO date of the scan, for the recalled screen's own label. */
  date: string;
}

const OWNER_SEPARATOR = "\u001f";
const key = (owner: string, scanKey: string): string => `${owner}${OWNER_SEPARATOR}${scanKey}`;
const ownerPrefix = (owner: string): string => `${owner}${OWNER_SEPARATOR}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!("indexedDB" in globalThis)) return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("scanPhotos")) db.createObjectStore("scanPhotos");
        if (!db.objectStoreNames.contains("faceLibrary")) db.createObjectStore("faceLibrary");
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Strip every metric's def down to its id, via a JSON round-trip. */
function dehydrate<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (k, v: unknown) =>
      k === "def" && v && typeof v === "object" && "id" in (v as { id?: unknown })
        ? { id: (v as { id: string }).id }
        : v,
    ),
  ) as T;
}

/** Rebuild a report's metrics against the LIVE def tables. Exported for tests. */
export function rehydrateReport(stored: Report): Report {
  const defs = new Map([...METRICS, ...SIDE_METRICS].map((d) => [d.id, d]));
  const fixed = new Map<string, ScoredMetric>();
  const metrics: ScoredMetric[] = [];
  for (const m of stored.metrics ?? []) {
    const def = defs.get((m.def as { id: string }).id);
    if (!def) continue;
    const whole = { ...m, def };
    fixed.set(def.id, whole);
    metrics.push(whole);
  }
  return {
    ...stored,
    metrics,
    // Regions reference the SAME objects, so a metric looked up by id from
    // either list is one measurement, not two copies that can disagree.
    regions: (stored.regions ?? []).map((r) => ({
      ...r,
      metrics: r.metrics
        .map((m) => fixed.get((m.def as { id: string }).id))
        .filter((m): m is ScoredMetric => Boolean(m)),
    })),
  };
}

export async function saveArchive(scanKey: string, archive: ScanArchive): Promise<void> {
  const owner = activeScanOwner();
  if (!owner) return;
  const stored: ScanArchive = {
    ...archive,
    report: dehydrate(archive.report),
    sideReport: archive.sideReport ? dehydrate(archive.sideReport) : null,
  };
  await tx("readwrite", (s) => s.put(stored, key(owner, scanKey)));
}

export async function loadArchive(scanKey: string): Promise<ScanArchive | null> {
  const owner = activeScanOwner();
  if (!owner) return null;
  const raw = await tx<ScanArchive>("readonly", (s) => s.get(key(owner, scanKey)));
  if (!raw || !raw.report) return null;
  return {
    ...raw,
    report: rehydrateReport(raw.report),
    sideReport: raw.sideReport ? rehydrateReport(raw.sideReport) : null,
  };
}

export async function hasArchive(scanKey: string): Promise<boolean> {
  const owner = activeScanOwner();
  if (!owner) return false;
  const found = await tx<number>("readonly", (s) => s.count(key(owner, scanKey)));
  return (found ?? 0) > 0;
}

/** Drop archives for scans no longer in the owner's history, like pruneTo. */
export async function pruneArchivesTo(keepScanKeys: string[]): Promise<void> {
  const owner = activeScanOwner();
  if (!owner) return;
  const keep = new Set(keepScanKeys.map((k) => key(owner, k)));
  const all = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  if (!all) return;
  for (const k of all) {
    if (typeof k !== "string" || !k.startsWith(ownerPrefix(owner))) continue;
    if (!keep.has(k)) await tx("readwrite", (s) => s.delete(k));
  }
}

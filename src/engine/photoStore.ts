// ---------------------------------------------------------------------------
// Scan thumbnails, on the device.
//
// The scan log has always stored numbers and never pixels. This adds pixels,
// and it is worth being exact about what that does and does not change.
//
// This store never uploads: an IndexedDB record does not leave the machine it
// was written on and there is no network call anywhere in this file. Optional,
// separately consented side-landmark feedback is handled by another module and
// never reads these history thumbnails. What changes here is that a photograph
// PERSISTS on the device rather than living only for the length of a session,
// so it survives a refresh and can be shown against a past scan.
//
// Two consequences follow, and both are handled rather than hoped about:
//
//   - Size. A full capture is a megabyte; a hundred would blow past any sane
//     quota. So what is stored is a 320px JPEG thumbnail at quality 0.72 —
//     enough to recognise the shot next to a number, far too small to re-run
//     the engine on, which is the correct trade for something whose only job is
//     to be looked at.
//   - Deletion. Anything stored has to be removable, so clearAllPhotos() exists
//     and the history screen can call it. A store you cannot empty is a liability.
//
// IndexedDB rather than localStorage because localStorage is a ~5MB string
// store, synchronous, and would be full after a handful of faces.
// ---------------------------------------------------------------------------

const DB_NAME = "truemax";
const STORE = "scanPhotos";
const DB_VERSION = 1;

// Long edge of the stored thumbnail, in pixels.
const THUMB = 320;
const QUALITY = 0.72;

export interface ScanPhotos {
  front?: string; // data URL
  side?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!("indexedDB" in globalThis)) return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      // Private browsing, disabled storage, quota refusal. All of these mean
      // "no thumbnails", never "no app".
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

// Shrink to a thumbnail and encode. Kept here so nothing upstream has to
// remember that full-size frames must never reach the store.
export function toThumb(src: HTMLCanvasElement): string | null {
  try {
    const scale = Math.min(1, THUMB / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", QUALITY);
  } catch {
    return null;
  }
}

// Keyed by the scan's ISO date, which is what the scan log already uses as its
// identity, so the two cannot drift apart.
export async function savePhotos(scanDate: string, photos: ScanPhotos): Promise<void> {
  if (!photos.front && !photos.side) return;
  await tx("readwrite", (s) => s.put(photos, scanDate));
}

export async function loadPhotos(scanDate: string): Promise<ScanPhotos | null> {
  const v = await tx<ScanPhotos>("readonly", (s) => s.get(scanDate));
  return v ?? null;
}

export async function clearAllPhotos(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}

// Drop thumbnails whose scan is no longer in the log, so the store cannot grow
// past the capped history it belongs to.
export async function pruneTo(keepDates: string[]): Promise<void> {
  const keep = new Set(keepDates);
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  if (!keys) return;
  for (const k of keys) {
    if (typeof k === "string" && !keep.has(k)) await tx("readwrite", (s) => s.delete(k));
  }
}

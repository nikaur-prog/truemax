import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { activeScanOwner } from "./scanScope.js";

// ---------------------------------------------------------------------------
// The saved-face library.
//
// /quick exists to film social clips, and the slow part was never the scan —
// it was finding a face to scan. Every take meant hunting for the photo again,
// re-uploading it and waiting through detection, for a face that had already
// been measured that morning. This keeps them.
//
// LOCAL ONLY, and that is not a shortcut. The landing page promises the
// photograph never leaves the device, and a library that synced faces to a
// server would make that sentence false for anyone who used it. IndexedDB
// keeps the promise, costs nothing to run, and is faster than a round trip
// would be. If a shared library is ever wanted it needs its own consent flow
// and its own copy on the page, not a quiet upload behind a feature that
// looks local.
//
// The landmarks are stored beside the picture, so re-loading a face skips
// detection entirely and re-scores instantly. That is the whole point: a
// producer switching reference population or re-filming a take should never
// wait for the model again.
// ---------------------------------------------------------------------------

const DB_NAME = "truemax";
// Its own store inside the existing database. A second database would mean a
// second version ladder to keep in step for no benefit.
const STORE = "faceLibrary";
// Bumped from 1: photoStore.ts owns version 1 and creates scanPhotos. All
// three modules sharing this database (photoStore, this, scanArchive) must
// agree on the version and every upgrade handler must be idempotent, or
// whichever opens second fails and takes its feature with it. Bumped to 3
// when scan archives were added.
const DB_VERSION = 3;

// Enough for a filming session with room to spare. Beyond this the oldest go,
// because an unbounded store of face photographs on somebody's device is a
// liability that grows quietly.
const MAX_FACES = 40;

export interface SavedFace {
  // Absent only on quarantined legacy entries. New reads require an exact
  // match with the active browser/account owner.
  owner?: string;
  id: string;
  label: string;
  // A data URL. Full resolution rather than a thumbnail: this is re-scanned
  // and re-filmed, and a thumbnail would visibly soften a clip.
  photo: string;
  width: number;
  height: number;
  landmarks: NormalizedLandmark[];
  // For the strip, so a face can be shown with what it scored without
  // re-running the engine to draw a list.
  score: number;
  savedAt: number;
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
        // Both stores are created defensively here. An upgrade from version 1
        // runs this handler with scanPhotos already present, and a fresh
        // install runs it with neither — the contains() checks cover both, and
        // mean this file never destroys the other feature's data.
        if (!db.objectStoreNames.contains("scanPhotos")) db.createObjectStore("scanPhotos");
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains("scanArchive")) db.createObjectStore("scanArchive");
      };
      req.onsuccess = () => resolve(req.result);
      // Private browsing, disabled storage, quota refusal. Every one of these
      // means "no library", never "no page".
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

export async function saveFace(face: Omit<SavedFace, "id" | "savedAt">): Promise<SavedFace | null> {
  const owner = activeScanOwner();
  if (!owner) return null;
  const entry: SavedFace = {
    ...face,
    owner,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  const ok = await tx("readwrite", (s) => s.put(entry, faceKey(owner, entry.id)));
  if (ok === null) return null;
  await prune();
  return entry;
}

export async function listFaces(): Promise<SavedFace[]> {
  const owner = activeScanOwner();
  if (!owner) return [];
  const all = await tx<SavedFace[]>("readonly", (s) => s.getAll() as IDBRequest<SavedFace[]>);
  if (!all) return [];
  if (activeScanOwner() !== owner) return [];
  // Newest first: the face you just saved is the one you are most likely to
  // want back.
  return all.filter((face) => face.owner === owner).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteFace(id: string): Promise<void> {
  const owner = activeScanOwner();
  if (!owner) return;
  await tx("readwrite", (s) => s.delete(faceKey(owner, id)) as unknown as IDBRequest<undefined>);
}

export async function clearFaces(): Promise<void> {
  const owner = activeScanOwner();
  if (!owner) return;
  const prefix = `${owner}\u001f`;
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  if (!keys) return;
  for (const key of keys) {
    if (typeof key === "string" && key.startsWith(prefix)) {
      await tx("readwrite", (s) => s.delete(key) as unknown as IDBRequest<undefined>);
    }
  }
}

async function prune(): Promise<void> {
  const all = await listFaces();
  for (const face of all.slice(MAX_FACES)) await deleteFace(face.id);
}

function faceKey(owner: string, id: string): string {
  return `${owner}\u001f${id}`;
}

// Turn a stored data URL back into something the renderer can draw. Returns
// null rather than throwing, because a corrupt entry should cost one face, not
// the page.
export function faceToCanvas(face: SavedFace): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = face.width;
        canvas.height = face.height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, face.width, face.height);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = face.photo;
  });
}

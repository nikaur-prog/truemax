import { activeScanOwner } from "./scanScope.js";

const DB_NAME = "truemax-clips";
const STORE = "clips";
const DB_VERSION = 1;
const MAX_ITEMS = 30;
export const MAX_CLIP_BYTES = 120 * 1024 * 1024;

export type LibraryMediaKind = "image" | "video";

export interface LibraryClip {
  id: string;
  owner: string;
  name: string;
  type: string;
  kind: LibraryMediaKind;
  size: number;
  savedAt: number;
  blob: Blob;
}

export type ClipValidation =
  | { ok: true; kind: LibraryMediaKind }
  | { ok: false; reason: string };

export function validateLibraryFile(file: Pick<File, "type" | "size">): ClipValidation {
  const kind = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("image/")
      ? "image"
      : null;
  if (!kind) return { ok: false, reason: "Choose a video or image file." };
  if (file.size <= 0) return { ok: false, reason: "That file is empty." };
  if (file.size > MAX_CLIP_BYTES) {
    return { ok: false, reason: "Keep each library item under 120 MB." };
  }
  return { ok: true, kind };
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!("indexedDB" in globalThis)) return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function key(owner: string, id: string): string {
  return `${owner}\u001f${id}`;
}

export async function saveLibraryFile(file: File): Promise<{ entry?: LibraryClip; error?: string }> {
  const owner = activeScanOwner();
  if (!owner) return { error: "Sign in again before saving clips." };
  const valid = validateLibraryFile(file);
  if (!valid.ok) return { error: valid.reason };
  const entry: LibraryClip = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    owner,
    name: file.name || `${valid.kind}-${Date.now()}`,
    type: file.type,
    kind: valid.kind,
    size: file.size,
    savedAt: Date.now(),
    blob: file,
  };
  const saved = await tx("readwrite", (store) => store.put(entry, key(owner, entry.id)));
  if (saved === null) return { error: "This browser could not store that file." };
  await prune(owner);
  return { entry };
}

export async function listLibraryClips(): Promise<LibraryClip[]> {
  const owner = activeScanOwner();
  if (!owner) return [];
  const entries = await tx<LibraryClip[]>("readonly", (store) => store.getAll() as IDBRequest<LibraryClip[]>);
  if (!entries || activeScanOwner() !== owner) return [];
  return entries
    .filter((entry) => entry.owner === owner && entry.blob instanceof Blob)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteLibraryClip(id: string): Promise<void> {
  const owner = activeScanOwner();
  if (!owner) return;
  await tx("readwrite", (store) => store.delete(key(owner, id)) as unknown as IDBRequest<undefined>);
}

export async function clearLibraryClips(): Promise<void> {
  const owner = activeScanOwner();
  if (!owner) return;
  const keys = await tx<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  if (!keys) return;
  const prefix = `${owner}\u001f`;
  await Promise.all(keys
    .filter((value): value is string => typeof value === "string" && value.startsWith(prefix))
    .map((value) => tx("readwrite", (store) => store.delete(value) as unknown as IDBRequest<undefined>)));
}

export function libraryClipToFile(entry: LibraryClip): File {
  return new File([entry.blob], entry.name, { type: entry.type || entry.blob.type });
}

async function prune(owner: string): Promise<void> {
  const entries = await listLibraryClips();
  if (activeScanOwner() !== owner) return;
  for (const entry of entries.slice(MAX_ITEMS)) await deleteLibraryClip(entry.id);
}

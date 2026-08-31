import type { ExportKind } from "./saveFile.js";

// ---------------------------------------------------------------------------
// Saving into a folder you chose, instead of into Downloads.
//
// A plain `<a download>` cannot pick a destination — the browser owns that, and
// every file lands in one pile. The File System Access API can, and the part
// that matters here is that it REMEMBERS: showDirectoryPicker() hands back a
// handle that survives being stored, so the folder is chosen once and every
// export afterwards is written straight into it with no dialog at all.
//
// That is the whole feature. Not "a save dialog every time" — that is a prompt
// per file, which is worse than Downloads for somebody exporting thirty clips
// in an evening. One choice, then silence.
//
// WHO GETS IT. Chromium desktop (Chrome, Edge, Arc, Brave) implements the API.
// Safari and Firefox do not, and there is no shim worth having, so those fall
// through to the ordinary download and Downloads keeps working exactly as it
// did. Phones are excluded on purpose even where the API exists: a file made on
// a phone is going into the camera roll and then into TikTok, and the share
// sheet already does that in one tap.
//
// PERMISSION IS NOT PERMANENT BY DEFAULT. A handle read back in a new session
// starts as "prompt", and re-granting requires a user gesture — the same
// constraint that broke phone video exports, for the same reason. So a write
// that finds itself needing permission with no gesture in hand does not throw
// and does not silently fail: it reports that, and the caller falls back to a
// normal download. Chrome offers "allow on every visit" in the prompt, which
// makes the re-grant a one-time cost rather than a per-session one.
// ---------------------------------------------------------------------------

// Minimal shape of the bits of the API this uses. Typed here rather than
// pulled from lib.dom because the definitions are still not in every
// TypeScript release, and a `declare global` would fight whichever version is
// installed.
interface FsWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
interface FsDirectoryHandle {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FsDirectoryHandle>;
};

const DB = "truemax.save";
const STORE = "handles";
const KEY = "root";

/** Whether this browser can be pointed at a folder at all. */
export function canChooseSaveFolder(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof (window as PickerWindow).showDirectoryPicker !== "function") return false;
  // Phones are excluded even where the API exists — see the note above.
  if (typeof window.matchMedia !== "function") return true;
  return !(window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-hover: hover)").matches);
}

// A directory handle is structured-cloneable but not stringifiable, so it goes
// in IndexedDB rather than localStorage. Everything here resolves rather than
// rejects: a browser with storage disabled should lose the preference, not the
// export.
function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function put(value: FsDirectoryHandle | null): Promise<void> {
  return new Promise((resolve) => {
    void idb().then((db) => {
      if (!db) return resolve();
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        if (value) store.put(value, KEY);
        else store.delete(KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

function get(): Promise<FsDirectoryHandle | null> {
  return new Promise((resolve) => {
    void idb().then((db) => {
      if (!db) return resolve(null);
      try {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve((request.result as FsDirectoryHandle) ?? null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** The chosen folder's name, for the settings line. Null when none is set. */
export async function saveFolderName(): Promise<string | null> {
  const handle = await get();
  return handle?.name ?? null;
}

/**
 * Ask for a folder. Must be called from a click — the picker is gated on a
 * user gesture. Returns the folder's name, or null if the person cancelled.
 */
export async function chooseSaveFolder(): Promise<string | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    // `id` makes the browser reopen at the same place next time, which matters
    // when the answer is nearly always the same folder.
    const handle = await picker({ mode: "readwrite", id: "truemax-exports" });
    await put(handle);
    return handle.name;
  } catch {
    // Cancelling rejects with AbortError. Nothing to report — they closed a
    // dialog they opened.
    return null;
  }
}

export async function clearSaveFolder(): Promise<void> {
  await put(null);
}

/** One subfolder per kind, matching what the download sorter would have made. */
const FOLDER: Record<ExportKind, string> = {
  reel: "Reels",
  rundown: "Rundowns",
  card: "Verdict cards",
  carousel: "Carousels",
  scan: "Scans",
};

export type FiledResult =
  /** Written into the chosen folder. `where` is "TrueMax/Reels" style. */
  | { ok: true; where: string }
  /** Nothing was written. The caller should fall back to a download. */
  | { ok: false; reason: "unset" | "permission" | "failed" };

/**
 * Write one export into the chosen folder, creating the per-kind subfolder.
 *
 * Never throws. Every failure is a reason the caller can act on, because the
 * caller's fallback — an ordinary download — is always available and always
 * better than losing the file.
 */
export async function fileIntoSaveFolder(
  blob: Blob,
  filename: string,
  kind: ExportKind,
): Promise<FiledResult> {
  const root = await get();
  if (!root) return { ok: false, reason: "unset" };

  try {
    // Permission first. A handle from a previous session commonly reads
    // "prompt", and requestPermission needs a gesture — if there is none, say
    // so rather than raising a dialog that will be refused.
    const state = (await root.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (state !== "granted") {
      const asked = (await root.requestPermission?.({ mode: "readwrite" })) ?? "denied";
      if (asked !== "granted") return { ok: false, reason: "permission" };
    }

    const dir = await root.getDirectoryHandle(FOLDER[kind], { create: true });
    const file = await dir.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return { ok: true, where: `${root.name}/${FOLDER[kind]}` };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

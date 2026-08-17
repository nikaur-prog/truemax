// ---------------------------------------------------------------------------
// Getting a finished file off the device it was made on.
//
// `<a download>` is a desktop idea. On iOS Safari the attribute is ignored for
// blob URLs — the video either opens in place or does nothing at all, which is
// how a working export reads as a broken button on the one platform this
// product is filmed on. Android Chrome honours it, but drops the file into
// Downloads rather than the camera roll, so it is missing from the picker when
// somebody goes to post it.
//
// The Web Share API is the fix, and it is not a fallback — it is the better
// path everywhere it exists. It hands the file to the OS share sheet, where
// "Save Video" writes to Photos (iOS) or Gallery (Android) and every other
// destination — Messages, the TikTok app itself — is one tap away. On a phone
// that is strictly better than a download, because the next thing that happens
// to this file is being posted.
//
// The order is therefore: share sheet if the browser can share THIS FILE, then
// the anchor, then a plain tab as the last resort. canShare({ files }) has to
// be asked about the actual file: Safari reports navigator.share exists while
// refusing video payloads on older versions, and calling share() anyway throws
// after the user gesture has been spent.
//
// ALL OF THAT IS AN ARGUMENT ABOUT PHONES, and it was being applied to
// desktops. macOS Chrome and Safari both implement canShare({ files }), so a
// laptop got the same treatment: press "Breakdown MP4" and an AirDrop / Mail /
// Messages / Notes sheet appears, when the file was always going to end up in
// a folder on the way to an editing timeline. There is no camera roll on a
// laptop for the sheet to be better than — it is a detour with a "Save to
// Files" at the bottom of it.
//
// So the sheet is offered where its argument actually holds — a device whose
// primary input is a finger — and everywhere else the file downloads. The
// override exists on top of that because the rule is a heuristic about hardware
// and the person pressing the button knows better than the heuristic does.
// ---------------------------------------------------------------------------

export type SaveOutcome = "shared" | "downloaded" | "opened" | "cancelled";

const DIRECT_KEY = "truemax.saveDirect";

/**
 * Is this a phone or a tablet — a device where "Save Video" writes to a camera
 * roll and the next thing that happens to the file is being posted?
 *
 * Pointer and hover rather than a user-agent string. A UA string is a claim
 * about a browser; these are claims about the input hardware, which is the
 * thing the share sheet's argument actually rests on. A laptop with a
 * touchscreen still has a mouse, so `any-hover` keeps it on the download path.
 */
function isHandheld(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-hover: hover)").matches;
}

/** Has the operator asked for files to download rather than open a share sheet? */
export function savesDirectly(): boolean {
  try {
    return localStorage.getItem(DIRECT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSavesDirectly(on: boolean): void {
  try {
    if (on) localStorage.setItem(DIRECT_KEY, "1");
    else localStorage.removeItem(DIRECT_KEY);
  } catch {
    // A browser with storage disabled loses the preference between reloads and
    // keeps the platform default, which is the right thing to degrade to.
  }
}

/** Whether saveFile will actually reach for the share sheet on this device. */
function willShare(file: File): boolean {
  if (savesDirectly() || !isHandheld()) return false;
  return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}

// A share sheet dismissed by the user rejects with AbortError. That is a
// deliberate "no", not a failure, and must not fall through to also triggering
// a download — the person would get the thing they just declined.
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type });

  if (willShare(file)) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
      // Anything else (a share target that failed, a policy block) falls
      // through to the download path rather than stranding the file.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    // Must be in the document for the click to count in some browsers.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Whether the download actually started is not observable, so this is a
    // claim about what we asked for, not about what happened. The caller's
    // copy says "saved or shared" for that reason.
    return "downloaded";
  } finally {
    // Long enough for the browser to have taken the blob. Revoking straight
    // away cancels the download on some Android builds.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// Whether saving a file of this type will open the OS share sheet. Used only to
// pick the button's WORDS — "Save or share" against "Download" — so the label
// matches what pressing it will actually do, including when the operator has
// turned the sheet off.
export function canShareFiles(type = "video/mp4"): boolean {
  if (savesDirectly() || !isHandheld()) return false;
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([new Blob([], { type })], `probe.${type.split("/")[1]}`, { type })] });
  } catch {
    return false;
  }
}

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
// ---------------------------------------------------------------------------

export type SaveOutcome = "shared" | "downloaded" | "opened" | "cancelled";

// A share sheet dismissed by the user rejects with AbortError. That is a
// deliberate "no", not a failure, and must not fall through to also triggering
// a download — the person would get the thing they just declined.
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type });

  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
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

// Whether the OS share sheet is available for a file of this type. Used only to
// pick the button's WORDS — "Save or share" against "Download" — so the label
// matches what tapping it will actually do.
export function canShareFiles(type = "video/mp4"): boolean {
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([new Blob([], { type })], `probe.${type.split("/")[1]}`, { type })] });
  } catch {
    return false;
  }
}

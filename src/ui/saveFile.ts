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

export type SaveOutcome = "shared" | "downloaded" | "opened" | "cancelled" | "filed";

// ---------------------------------------------------------------------------
// What a saved file is called.
//
// A browser cannot choose which folder a download lands in — that is the OS's
// decision and every file goes to the same one. The only lever the app has is
// the NAME, and the old names wasted it: `truemax-1755738291043.png` says
// nothing a person can read, sits next to `truemax-rundown-...mp4` and
// `truemax-card-...png` under three different naming schemes, and leaves a
// folder that can only be sorted by hand.
//
// So every export now agrees on one shape:
//
//   truemax-<kind>-[label-]YYYY-MM-DD-HHMM.<ext>
//
// The kind comes first because that is what a filter or a sorting rule keys
// on, and it is a fixed vocabulary rather than whatever the call site felt
// like. The timestamp is local wall-clock rather than epoch milliseconds:
// the person filing these lives in a timezone and remembers "the ones I made
// on Tuesday night", not 1755738291043. It also sorts correctly as text, which
// epoch does only by accident of digit count.
// ---------------------------------------------------------------------------

/** The fixed vocabulary. One folder per kind, if somebody wants folders. */
export type ExportKind =
  /** A finished vertical video: the analysis breakdown or a produced reel. */
  | "reel"
  /** The narrated walk down one face. */
  | "rundown"
  /** A score card / verdict still. */
  | "card"
  /** The scanned photograph with its landmarks. */
  | "scan";

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function exportName(kind: ExportKind, ext: string, label?: string): string {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}` +
    `-${two(now.getHours())}${two(now.getMinutes())}`;
  const tag = label ? slugify(label) : "";
  return ["truemax", kind, tag, stamp].filter(Boolean).join("-") + `.${ext}`;
}

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

// Whether the browser still considers us inside a user gesture.
//
// navigator.share() only works within moments of a real tap, and that is the
// difference between the image saves and the video saves on a phone. A PNG is
// encoded in milliseconds, so share() runs inside the tap that asked for it. An
// MP4 renders frame by frame for tens of seconds, so by the time the file
// exists the tap that asked for it has expired — share() then throws
// NotAllowedError, the catch fell through to the <a download> path, and iOS
// Safari treats a blob-URL download badly enough that the export simply
// vanished. A working encoder, a written file, and nothing on the phone.
//
// Browsers without the API return true, which routes into the direct share()
// attempt whose catch handles a stale gesture anyway — the query is an
// optimisation of WHEN to ask for a fresh tap, not the safety net itself.
function hasFreshActivation(): boolean {
  const activation = navigator.userActivation;
  return activation ? activation.isActive : true;
}

// One fresh tap, so the share sheet is legal again.
//
// The dialog exists because the alternative was silence: the OS will not open a
// share sheet on a spent gesture, and no amount of code can restore one. What
// it can do is ask for a new one — a single button whose click handler calls
// share() synchronously inside the click. "Download instead" degrades to the
// anchor path deliberately, for the person who wanted the file in Files after
// all. Dismissing (Escape) resolves "cancelled": they were offered the file
// and declined it, which is the same outcome as dismissing the sheet itself.
//
// Reuses the side-feedback dialog classes, which live in style.css and are
// loaded by both pages that save files, so this carries no CSS of its own.
function shareWithFreshTap(file: File): Promise<SaveOutcome | "fallback"> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "side-feedback-backdrop";
    const video = file.type.startsWith("video/");
    backdrop.innerHTML = `<section class="side-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="save-ready-title">
      <span class="klabel">RENDER FINISHED</span>
      <h2 id="save-ready-title">Your ${video ? "video" : "file"} is ready</h2>
      <p>The render outlived the tap that started it, and the share sheet needs a
      fresh one. ${video ? "“Save Video” in the sheet puts it straight in your camera roll." : ""}</p>
      <div class="side-feedback-actions">
        <button type="button" class="btn gho" data-choice="download">Download instead</button>
        <button type="button" class="btn pri" data-choice="share">Save or share</button>
      </div>
    </section>`;
    document.body.appendChild(backdrop);
    let done = false;
    const finish = (outcome: SaveOutcome | "fallback") => {
      if (done) return;
      done = true;
      backdrop.remove();
      resolve(outcome);
    };
    backdrop.querySelector<HTMLButtonElement>('[data-choice="download"]')!.onclick = () => finish("fallback");
    const share = backdrop.querySelector<HTMLButtonElement>('[data-choice="share"]')!;
    share.onclick = () => {
      // Called directly in the click handler — this is the entire point.
      navigator.share({ files: [file] }).then(
        () => finish("shared"),
        (error) => finish(isAbort(error) ? "cancelled" : "fallback"),
      );
    };
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish("cancelled");
    });
    share.focus();
  });
}

/**
 * The user-facing sentence for a save outcome.
 *
 * "Downloaded" was the message for every non-share outcome, and on a phone it
 * is a lie of omission: the file went to the Files app's Downloads folder,
 * which is not where anybody looks for a video, and the button gave no clue.
 * One helper so every export button tells the same truth about where the
 * file actually went — and so the phrasing is edited in one place.
 */
export function outcomeMessage(outcome: SaveOutcome): string {
  switch (outcome) {
    case "shared":
      return "Sent to your share sheet";
    case "filed":
      return "Saved to your chosen folder";
    case "opened":
      return "Opened — save it from there";
    case "cancelled":
      return "Not saved";
    default:
      return isHandheld() ? "Saved to Files › Downloads" : "Downloaded";
  }
}

export async function saveFile(
  blob: Blob,
  filename: string,
  // The category, when the caller knows it. Only used to pick the subfolder
  // inside a chosen save location — every other path ignores it, so callers
  // that have not been updated keep working unchanged.
  kind?: ExportKind,
): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type });

  // A folder the operator picked wins over a download, on the desktops that
  // can offer one. Checked before the share sheet only in the sense that the
  // share sheet is phone-only and this is not — the two never contend.
  if (kind && !isHandheld()) {
    const { fileIntoSaveFolder } = await import("./saveLocation.js");
    const filed = await fileIntoSaveFolder(blob, filename, kind);
    if (filed.ok) return "filed";
    // "unset" is the ordinary case for anybody who never picked a folder, and
    // "permission"/"failed" are cases where a download is the right answer
    // rather than an error message. All three fall through.
  }

  if (willShare(file)) {
    if (hasFreshActivation()) {
      try {
        await navigator.share({ files: [file] });
        return "shared";
      } catch (error) {
        if (isAbort(error)) return "cancelled";
        // A stale gesture the API failed to report, or a share target that
        // fell over. One fresh tap fixes the first and costs the second
        // nothing; only if that also declines does the download run.
        const retried = await shareWithFreshTap(file);
        if (retried !== "fallback") return retried;
      }
    } else {
      const offered = await shareWithFreshTap(file);
      if (offered !== "fallback") return offered;
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

// ---------------------------------------------------------------------------
// Ctrl/Cmd-V a photo instead of hunting for it in a file picker.
//
// Every photo somebody wants to scan has usually just been looked at: cropped
// in Photos, sent in a DM, screenshotted off a camera roll. It is already on
// the clipboard. Making them save it, open a picker, and find it again is three
// steps to arrive where they started — and on a page people reach from a video,
// three steps is most of the drop-off.
//
// Two sources, because browsers disagree about which one fires:
//
//   paste — the real event, carrying files on `clipboardData`. Free, needs no
//   permission, works everywhere. Screenshots and copied image files both land
//   here.
//
//   drag and drop — the same intent with a mouse, and it costs four lines once
//   the paste path exists.
//
// Deliberately NOT navigator.clipboard.read(): it prompts for a scary-sounding
// clipboard permission, which on an app that has just promised your face never
// leaves the device is the wrong thing to ask for the sake of saving a click.
// ---------------------------------------------------------------------------

const IMAGE = /^image\//;

function imageFrom(items: DataTransferItemList | null | undefined): File | null {
  for (const item of items ?? []) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && IMAGE.test(file.type)) return file;
  }
  return null;
}

export interface PasteOptions {
  // Ignored while true — a paste during the scan animation, or while a dialog
  // is open over the page, should do nothing rather than restart the flow.
  busy?: () => boolean;
  // Drop target. Defaults to the whole document.
  dropZone?: HTMLElement | null;
  onImage: (file: File) => void;
}

export function enablePhotoPaste(opts: PasteOptions): () => void {
  const accept = (file: File | null): boolean => {
    if (!file || opts.busy?.()) return false;
    opts.onImage(file);
    return true;
  };

  const onPaste = (event: ClipboardEvent) => {
    // A paste into a text box is somebody typing, not somebody supplying a
    // photo — the settings and onboarding forms live on these same pages.
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return;
    if (accept(imageFrom(event.clipboardData?.items))) event.preventDefault();
  };

  const zone = opts.dropZone ?? document.body;
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    zone.classList.add("paste-hot");
  };
  const onDragLeave = () => zone.classList.remove("paste-hot");
  const onDrop = (event: DragEvent) => {
    zone.classList.remove("paste-hot");
    if (accept(imageFrom(event.dataTransfer?.items))) event.preventDefault();
  };

  document.addEventListener("paste", onPaste);
  zone.addEventListener("dragover", onDragOver);
  zone.addEventListener("dragleave", onDragLeave);
  zone.addEventListener("drop", onDrop);

  return () => {
    document.removeEventListener("paste", onPaste);
    zone.removeEventListener("dragover", onDragOver);
    zone.removeEventListener("dragleave", onDragLeave);
    zone.removeEventListener("drop", onDrop);
  };
}

// Touch keyboards have no Ctrl-V and no drag, so the hint is only true on a
// device with a pointer. Telling a phone user to press a key combination they
// do not have is worse than saying nothing.
export function pasteHintApplies(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

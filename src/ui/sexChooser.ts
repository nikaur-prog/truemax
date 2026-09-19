import type { Sex } from "../engine/types.js";

export interface SexChooserOptions {
  /** Local preview of the photo this choice applies to. Never uploaded here. */
  photo?: Blob | HTMLCanvasElement;
  /** Select, review, then Continue. Existing callers retain one-tap selection. */
  confirm?: boolean;
}

let disposeActive: (() => void) | null = null;

const escapeHTML = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A reference choice belongs to this invocation, never to the previous photo. */
export function openSexChooser(
  onPick: (sex: Sex) => void,
  preselect?: Sex,
  onCancel?: () => void,
  subjectName?: string,
  options: SexChooserOptions = {},
): void {
  close();
  const origin = document.activeElement as HTMLElement | null;
  const el = document.createElement("div");
  const confirm = options.confirm === true;
  el.className = `sexpick${confirm ? " sexpick-confirm" : ""}`;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "sexpick-title");
  const title = subjectName ? `What gender is ${escapeHTML(subjectName)}?`
    : confirm ? "Which reference fits this photo?" : "First, what gender is being analysed?";
  el.innerHTML = `${confirm ? '<section class="sexpick-confirm-card">' : ""}
    <div class="sexpick-head"><h2 id="sexpick-title">${title}</h2>
      ${confirm ? "<p>Choose for the person in this photo. You can change your choice before continuing.</p>" : ""}</div>
    <button class="sexpick-cancel" type="button" aria-label="Cancel">${confirm ? "Back" : "Cancel"}</button>
    ${options.photo ? '<figure class="sexpick-preview"><div class="sexpick-preview-image"></div><figcaption>Selected photo · previewed on this device</figcaption><p class="sexpick-preview-error" role="status" hidden>This photo could not be previewed. Go back and choose another photo.</p></figure>' : ""}
    <div class="sexpick-split">
      <button type="button" class="sexpick-side man${preselect === "male" ? " was" : ""}" data-sex="male">
        <span class="sexpick-glow"></span><span class="sexpick-ic">♂</span><b>Man</b><span class="sexpick-sub">Scored against men</span>
      </button>
      <button type="button" class="sexpick-side woman${preselect === "female" ? " was" : ""}" data-sex="female">
        <span class="sexpick-glow"></span><span class="sexpick-ic">♀</span><b>Woman</b><span class="sexpick-sub">Scored against women</span>
      </button>
    </div>
    ${confirm ? '<button type="button" class="btn pri sexpick-continue" disabled>Continue</button></section>' : ""}`;

  let done = false;
  let selected: Sex | undefined = confirm ? preselect : undefined;
  let photoReady = !options.photo;
  let previewUrl: string | null = null;
  let previewImage: HTMLImageElement | null = null;
  let previewCanvas: HTMLCanvasElement | null = null;
  let entranceFrame = 0;
  const choices = [...el.querySelectorAll<HTMLButtonElement>(".sexpick-side")];
  const continueButton = el.querySelector<HTMLButtonElement>(".sexpick-continue");
  const paint = () => {
    for (const choice of choices) {
      const active = selected === choice.dataset.sex;
      choice.classList.toggle("selected", active);
      choice.setAttribute("aria-pressed", String(active));
    }
    if (continueButton) continueButton.disabled = !selected || !photoReady;
  };
  const finish = (sex: Sex) => {
    if (done) return;
    close();
    onPick(sex);
  };
  const cancel = () => {
    if (done) return;
    close();
    onCancel?.();
  };
  for (const choice of choices) {
    choice.onclick = () => {
      if (done) return;
      const sex = choice.dataset.sex as Sex;
      if (!confirm) { finish(sex); return; }
      selected = sex;
      paint();
    };
  }
  if (continueButton) continueButton.onclick = () => {
    if (selected && photoReady) finish(selected);
  };
  const back = el.querySelector<HTMLButtonElement>(".sexpick-cancel")!;
  back.onclick = cancel;
  el.onclick = (event) => { if (event.target === el) cancel(); };
  const onKey = (event: KeyboardEvent) => {
    if (done) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === "Tab") {
      const buttons = [...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  // Keep native button activation, but do not advance a scanner behind this dialog.
  const stopScannerKeys = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  };
  const disposed = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(entranceFrame);
    document.removeEventListener("keydown", onKey, true);
    el.removeEventListener("keydown", stopScannerKeys);
    if (previewImage) { previewImage.onload = previewImage.onerror = null; previewImage.removeAttribute("src"); }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (previewCanvas) previewCanvas.width = previewCanvas.height = 1;
    el.remove();
    if (origin?.isConnected) origin.focus();
  };
  disposeActive = disposed;
  document.addEventListener("keydown", onKey, true);
  el.addEventListener("keydown", stopScannerKeys);
  document.body.appendChild(el);

  const failPreview = () => {
    if (done) return;
    photoReady = false;
    el.querySelector<HTMLElement>(".sexpick-preview-error")!.hidden = false;
    paint();
  };
  if (options.photo) {
    const host = el.querySelector<HTMLElement>(".sexpick-preview-image")!;
    try {
      if (options.photo instanceof Blob) {
        previewImage = document.createElement("img");
        previewImage.alt = "The selected photo for this reference choice";
        previewImage.onload = () => {
          if (done) return;
          photoReady = Boolean(previewImage?.naturalWidth);
          if (!photoReady) failPreview();
          else paint();
        };
        previewImage.onerror = failPreview;
        previewUrl = URL.createObjectURL(options.photo);
        previewImage.src = previewUrl;
        host.appendChild(previewImage);
      } else {
        const source = options.photo;
        if (!(source.width > 0 && source.height > 0)) throw new Error("Empty photo");
        previewCanvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / Math.max(source.width, source.height));
        previewCanvas.width = Math.max(1, Math.round(source.width * scale));
        previewCanvas.height = Math.max(1, Math.round(source.height * scale));
        previewCanvas.setAttribute("role", "img");
        previewCanvas.setAttribute("aria-label", "The selected photo for this reference choice");
        const context = previewCanvas.getContext("2d");
        if (!context) throw new Error("Preview unavailable");
        context.drawImage(source, 0, 0, previewCanvas.width, previewCanvas.height);
        host.appendChild(previewCanvas);
        photoReady = true;
      }
    } catch { failPreview(); }
  }
  paint();
  back.focus();
  entranceFrame = requestAnimationFrame(() => { if (!done) el.classList.add("in"); });
}

/** External reset/replacement disposes without claiming the user cancelled. */
export function close(): void {
  const dispose = disposeActive;
  disposeActive = null;
  dispose?.();
}

export type ScanConfirmTone = "primary" | "positive";

/**
 * One worked example shown inside the dialog, before anybody has committed.
 *
 * Distinct from `preview`, which shows the photograph you just took. A teaser
 * shows the photograph you are being ASKED for, which is a different job: the
 * profile is the shot people get wrong, and "turn your head 90 degrees" does
 * not land until you have seen the difference between a full quarter turn and
 * the three-quarter view almost everybody produces instead.
 */
export interface ScanConfirmTeaser {
  src: string;
  alt: string;
  caption: string;
  /** A right answer or a wrong one. Drives the tick, the cross and the tone. */
  kind: "do" | "dont";
}

export interface ScanConfirmOptions {
  eyebrow?: string;
  title: string;
  copy: string;
  confirmLabel: string;
  cancelLabel: string;
  preview?: HTMLCanvasElement;
  /**
   * Examples shown above the copy. Two, never more: this card already carries
   * an eyebrow, a heading, a paragraph and two buttons, and on a short phone a
   * third figure is what pushes the buttons off the bottom of the screen.
   */
  teasers?: readonly ScanConfirmTeaser[];
  tone?: ScanConfirmTone;
}

let closeActive: (() => void) | null = null;

const PREVIEW_LONG_EDGE = 1040;

export function scanConfirmPreviewSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Close an in-flight confirmation when the scan owning it is torn down. */
export function closeScanConfirm(): void {
  closeActive?.();
}

/**
 * A real, body-level confirmation for scan actions.
 *
 * Mobile in-app browsers can suppress `window.confirm`, which made the New
 * photo control look dead on the exact devices where an accidental tap is
 * most likely. This dialog is app UI, so it is visible and answerable in the
 * same way everywhere. Only refresh/tab close remains a native browser
 * prompt, because browsers do not allow custom UI during `beforeunload`.
 */
export function confirmScanAction(options: ScanConfirmOptions): Promise<boolean> {
  closeActive?.();

  return new Promise((resolve) => {
    let settled = false;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const backdrop = document.createElement("div");
    backdrop.className = "scan-confirm-backdrop";

    const card = document.createElement("section");
    card.className = "scan-confirm-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "scan-confirm-title");

    const eyebrow = document.createElement("span");
    eyebrow.className = "klabel";
    eyebrow.textContent = options.eyebrow ?? "ONE QUESTION";
    card.appendChild(eyebrow);

    const title = document.createElement("h2");
    title.id = "scan-confirm-title";
    title.textContent = options.title;
    card.appendChild(title);

    if (options.preview) {
      const figure = document.createElement("figure");
      figure.className = "scan-confirm-preview";
      const canvas = document.createElement("canvas");
      const size = scanConfirmPreviewSize(options.preview.width, options.preview.height);
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")?.drawImage(options.preview, 0, 0, size.width, size.height);
      canvas.setAttribute("aria-label", "The front photo you just captured");
      figure.appendChild(canvas);
      card.appendChild(figure);
    }

    // Above the copy, not below it. The examples are what makes the paragraph
    // legible rather than the other way round, and somebody who understands
    // the picture can act without reading the sentence at all.
    if (options.teasers?.length) {
      const strip = document.createElement("div");
      strip.className = "scan-confirm-teasers";
      for (const teaser of options.teasers) {
        const figure = document.createElement("figure");
        figure.className = `scan-confirm-teaser ${teaser.kind}`;
        const img = document.createElement("img");
        img.src = teaser.src;
        img.alt = teaser.alt;
        // Eager: this dialog is the whole screen at the moment it opens, so a
        // lazy image here is a blank rectangle exactly when it is being looked
        // at. Sizes are declared so the card does not reflow as they land.
        img.decoding = "async";
        const caption = document.createElement("figcaption");
        const mark = document.createElement("span");
        mark.className = "scan-confirm-teaser-mark";
        mark.textContent = teaser.kind === "do" ? "✓" : "✕";
        mark.setAttribute("aria-hidden", "true");
        caption.append(mark, document.createTextNode(teaser.caption));
        figure.append(img, caption);
        strip.appendChild(figure);
      }
      card.appendChild(strip);
    }

    const copy = document.createElement("p");
    copy.className = "scan-confirm-copy";
    copy.textContent = options.copy;
    card.appendChild(copy);

    const actions = document.createElement("div");
    actions.className = "scan-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn gho";
    cancel.textContent = options.cancelLabel;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = `btn ${options.tone === "positive" ? "positive" : "pri"}`;
    confirm.textContent = options.confirmLabel;
    actions.append(cancel, confirm);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    document.body.classList.add("scan-confirm-open");

    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      document.body.classList.remove("scan-confirm-open");
      closeActive = null;
      previouslyFocused?.focus({ preventScroll: true });
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };
    closeActive = () => finish(false);
    document.addEventListener("keydown", onKey);
    cancel.onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    confirm.focus({ preventScroll: true });
  });
}

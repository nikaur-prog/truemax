// ---------------------------------------------------------------------------
// Retake, in the corner of the photograph it applies to.
//
// The way out of a bad photo used to be a word in a row of words under the
// frame — "Retake" among "All points at once", "One by one", "Points are
// wrong" and "Confirm". That is the wrong place for it twice over. It reads as
// one more thing to consider rather than as an escape hatch, and it is nowhere
// near the thing it acts on: you decide you dislike a photograph while looking
// at the photograph.
//
// So it lives ON the picture, bottom right, opposite the landmark guide in the
// top left. Two arrows chasing each other round a circle — the gesture everyone
// already reads as "do that again" — and it turns a full revolution when
// pressed, so the press is acknowledged before the screen changes.
//
// What it deliberately does NOT do is spin on its own. A permanently rotating
// ring is the universal sign that something is loading, and this screen has
// real loading states — a camera opening, a placement being computed. An idle
// control wearing a busy animation would be lying about which is which.
// ---------------------------------------------------------------------------

export interface RetakeHandle {
  destroy(): void;
}

/**
 * Anchor a retake control to the bottom-right of `host`, which must be a
 * positioned box (the photo frame). `label` names what is being retaken, for
 * the accessible name and the tooltip.
 */
export function mountRetakeGlyph(host: HTMLElement, label: string, onRetake: () => void): RetakeHandle {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "retake-glyph";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
         stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 5.5V11h-5.5"/>
      <path d="M3 18.5V13h5.5"/>
      <path d="M3.6 9.4a8.6 8.6 0 0 1 14.2-3.2L21 9.4"/>
      <path d="M20.4 14.6a8.6 8.6 0 0 1-14.2 3.2L3 14.6"/>
    </svg>
    <span>RETAKE</span>`;

  btn.onclick = () => {
    // Let the revolution start before the screen is torn down. The class is
    // removed on animationend so a second press can restart it.
    btn.classList.add("spun");
    onRetake();
  };
  btn.addEventListener("animationend", () => btn.classList.remove("spun"));

  host.appendChild(btn);
  return {
    destroy(): void {
      btn.remove();
    },
  };
}

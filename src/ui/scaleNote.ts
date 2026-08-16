import { LADDER, SPREAD, spreadLine, varianceLine } from "../engine/rarity.js";
import { REFERENCE_N } from "../engine/precision.js";
import type { Sex } from "../engine/types.js";

// ---------------------------------------------------------------------------
// "What does this number actually mean?"
//
// Every offended tester this product has produced was offended by the same
// thing: a number on a ten-point scale, with nothing next to it. The reader
// supplies the missing context from the only ten-point scale they have ever
// been graded on, which is school, and on that scale a six is a pass you would
// keep to yourself.
//
// This is the correction, and it is deliberately NOT a second scale. Inflating
// the number would make the product feel better and mean less — the same trade
// analysisMode.ts already refuses for the verdict wording, and the trade the
// name TrueMax exists to not make. What is missing is not a kinder number, it
// is the curve the number was read off.
//
// Opened from the affordance beside any headline score, on every depth. Not a
// modal with a locked backdrop like the tone prompt: that question had to be
// answered before the product could show anything, and this one is a reader
// choosing to look something up. Escape and a backdrop tap both close it.
// ---------------------------------------------------------------------------

let host: HTMLElement | null = null;

// The affordance. A button rather than a bare glyph so it is reachable by
// keyboard and announced by a screen reader as the question it opens.
export function scaleTrigger(): string {
  return `<button type="button" class="scale-q" data-scale-note
    aria-label="What this number means on this scale">?</button>`;
}

function ladderHTML(): string {
  return LADDER.map(
    (r) => `<div class="scale-rung">
      <b>${r.score.toFixed(1)}</b>
      <span>${r.capped ? `rarer than 1 in ${r.oneIn}` : `about 1 in ${r.oneIn}`}</span>
    </div>`,
  ).join("");
}

export function openScaleNote(sex: Sex): void {
  close();
  host = document.createElement("div");
  host.className = "scalenote";
  host.innerHTML = `
    <div class="scalenote-card" role="dialog" aria-modal="true" aria-labelledby="scalenote-title">
      <button type="button" class="scalenote-x" aria-label="Close">&times;</button>
      <span class="klabel">THE SCALE</span>
      <h2 id="scalenote-title">This is a curve, not a school grade</h2>

      <p>The scale is a position in a population, not a mark out of ten.
        <b>${SPREAD.median.toFixed(1)} is the exact middle</b> — not a pass mark, the median
        face. ${spreadLine(sex)}</p>

      <p>So it is tight, and that is what catches people out. Most of the range
        you assume exists is not where anybody lives. Moving from
        ${SPREAD.median.toFixed(1)} to ${SPREAD.high.toFixed(1)} is not one notch better,
        it steps past two thirds of everyone.</p>

      <div class="scale-ladder">${ladderHTML()}</div>

      <p class="scalenote-foot">Read that column again if a number here
        disappointed you: on this scale a 6 is uncommon and a 7 is rare. Nothing
        above the top rung is stated as a count, because a reference set of about
        ${REFERENCE_N} faces per sex cannot resolve one.</p>

      <p class="scalenote-foot">${varianceLine()}</p>
    </div>`;
  document.body.appendChild(host);

  host.querySelector<HTMLButtonElement>(".scalenote-x")!.onclick = close;
  // Backdrop tap, but only the backdrop — a tap that started inside the card
  // and drifted out while selecting text must not dismiss it.
  host.onclick = (e) => {
    if (e.target === host) close();
  };
  document.addEventListener("keydown", onKey);
  host.querySelector<HTMLButtonElement>(".scalenote-x")!.focus();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

function close(): void {
  document.removeEventListener("keydown", onKey);
  host?.remove();
  host = null;
}

// ---------------------------------------------------------------------------
// The primer, shown once, BEFORE the first number this person ever sees.
//
// The explainer above is a lookup for a reader who chose to ask. That is the
// wrong shape for the problem it was built for, because the person who most
// needs it is the one who already read their score, already felt insulted, and
// has no reason to go looking for a footnote that explains why they should not
// have. By then the damage is done and a "?" beside the number reads as
// excuse-making.
//
// So the curve is taught first and the score second. Thirty seconds, one
// screen, before the reveal.
//
// It gates the FIRST RESULT rather than living in the onboarding quiz, and
// that is deliberate: the quiz belongs to the trial funnel, but people reach a
// number from /quick, from a shared link and from a rescan without ever
// touching it. Gating the result is the only hook every one of those paths
// goes through, so the guarantee is real — nobody is shown a score on this
// scale without first being told what the scale is.
// ---------------------------------------------------------------------------

const PRIMER_KEY = "truemax.scalePrimerSeen";

export function needsScalePrimer(): boolean {
  try {
    return localStorage.getItem(PRIMER_KEY) !== "1";
  } catch {
    // Storage disabled: show it. Repeating the primer is a mild annoyance;
    // skipping it hands somebody the number this whole screen exists to frame.
    return true;
  }
}

function markPrimerSeen(): void {
  try {
    localStorage.setItem(PRIMER_KEY, "1");
  } catch {
    /* storage disabled: it will show again next visit, which is the safe way */
  }
}

// Resolves when it has been acknowledged. Resolves immediately if it has been
// seen before, so callers can await unconditionally.
export function showScalePrimer(sex: Sex): Promise<void> {
  if (!needsScalePrimer()) return Promise.resolve();

  return new Promise((resolve) => {
    close();
    host = document.createElement("div");
    host.className = "scalenote primer";
    host.innerHTML = `
      <div class="scalenote-card" role="dialog" aria-modal="true" aria-labelledby="primer-title">
        <span class="klabel">BEFORE YOUR NUMBER</span>
        <h2 id="primer-title">Read this scale like a curve</h2>

        <p>Your score is a <b>position among people</b>, not a mark out of ten.
          ${SPREAD.median.toFixed(1)} is not a pass — it is the exact middle face.
          ${spreadLine(sex)}</p>

        <div class="scale-ladder">${ladderHTML()}</div>

        <p>That column is the part worth thirty seconds. A 7 here is not a
          school seven: it is rarer than one person in twenty. Almost nobody
          is an 8, and the top of the scale is not somewhere real faces go —
          scan anyone you consider good-looking and they will land lower than
          you expect.</p>

        <p class="scalenote-foot">${varianceLine()}</p>

        <button type="button" class="btn primer-go">Got it — show my scan</button>
      </div>`;
    document.body.appendChild(host);

    const go = host.querySelector<HTMLButtonElement>(".primer-go")!;
    // No backdrop close and no escape here, unlike the explainer. This one is
    // not a lookup somebody opened, it is the frame around the number behind
    // it, and a stray tap dismissing it would deliver the naked score this
    // screen exists to prevent.
    go.onclick = () => {
      markPrimerSeen();
      close();
      resolve();
    };
    go.focus();
  });
}

// Delegated, and bound once for the life of the page. The results screen
// re-renders its whole panel on every mode switch, so per-render wiring would
// leak a listener each time somebody toggled depth.
let bound = false;

export function wireScaleNote(sexOf: () => Sex): void {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.("[data-scale-note]");
    if (t) {
      e.preventDefault();
      openScaleNote(sexOf());
    }
  });
}

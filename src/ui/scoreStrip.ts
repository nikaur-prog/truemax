import { countUp, prefersReducedMotion } from "./countUp.js";
import { percentileLine } from "./templates.js";
import { renderShareCard, shareCard } from "./shareCard.js";
import { verdictFor } from "../engine/analysisMode.js";
import { DEFAULT_VERDICT_TONE, loadVerdictTone } from "../engine/analysisMode.js";
import type { Report } from "../engine/types.js";

// ---------------------------------------------------------------------------
// The numbers, directly under the photograph.
//
// On a phone the results page is one column: photograph first, analysis
// underneath. So the moment the scan finished, the screen showed a face and
// nothing else, and the score, the ranking and every measurement were below the
// fold. People sat looking at their own photo waiting for a result that had
// already been computed, and a good number of them never scrolled.
//
// This is the fix, and it is deliberately not "move the analysis up". The
// analysis is long and belongs where it is. What belongs against the
// photograph is the answer: one score, where it ranks, and the word for it.
// Everything else stays a scroll away, which is now a scroll somebody takes
// because they have a reason to.
//
// Two behaviours make it work on a small screen:
//
//   - the photograph SHRINKS once you start reading, because a face taking up
//     two thirds of the viewport is worth exactly one look and then becomes an
//     obstacle between the reader and the thing they came for;
//   - it grows back at the top, because that is where somebody has scrolled up
//     to look at the face again, which is the only reason to scroll up.
//
// The score itself counts up and the ranking types out. Both are pure
// presentation over numbers computed before this module is called: nothing
// here derives a figure, so the strip and the full analysis cannot disagree.
// ---------------------------------------------------------------------------

// How far down the page the shrink triggers, and how far back up it releases.
// Two different numbers on purpose: a single threshold makes the photograph
// flicker between sizes when somebody rests a thumb near it, because the
// shrink itself changes the page height and can push the scroll position back
// across the line it just crossed.
const SHRINK_AT = 40;
const GROW_AT = 12;

let detach: (() => void) | null = null;

export function clearScoreStrip(): void {
  detach?.();
  detach = null;
  document.getElementById("scorestrip")?.remove();
  document.querySelector(".pane-photo")?.classList.remove("shrunk");
}

export function renderScoreStrip(report: Report): void {
  clearScoreStrip();
  const pane = document.querySelector<HTMLElement>(".pane-photo");
  if (!pane) return;

  const verdict = verdictFor(report, loadVerdictTone() ?? DEFAULT_VERDICT_TONE);
  const strip = document.createElement("div");
  strip.className = "scorestrip";
  strip.id = "scorestrip";
  strip.innerHTML = `
    <div class="ss-score">
      <b><span class="ss-n">0.0</span><small>/10</small></b>
      <span class="ss-word">${verdict.word}</span>
    </div>
    <p class="ss-rank"></p>
    <div class="ss-foot">
      <span class="ss-more" aria-hidden="true">Full breakdown below</span>
      <button type="button" class="ss-share" id="ss-share">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>
        </svg>Share
      </button>
    </div>`;

  // After the quality chips, which describe the photograph, so the reading
  // order stays "here is the photo, here is what was wrong with it, here is
  // what it measured".
  pane.appendChild(strip);

  const number = strip.querySelector<HTMLElement>(".ss-n")!;
  const rank = strip.querySelector<HTMLElement>(".ss-rank")!;
  const reduced = prefersReducedMotion();

  // percentileLine already contains the ranking; pairing it with rankShort
  // printed "Top 39% of men · Top 39%", which is the same fact stated twice.
  const rankText = percentileLine(report.overallPercentile, report.sex);
  if (reduced) {
    number.textContent = report.overall.toFixed(1);
    rank.textContent = rankText;
  } else {
    countUp(number, report.overall, { duration: 760 });
    // The ranking starts typing as the count-up lands, so the two read as one
    // movement rather than as two animations competing for the same eye.
    typeInto(rank, rankText, 620);
  }

  // Share sits ON the score, not four screens down.
  //
  // The card was already reachable — as a ghost button in a row of four at the
  // bottom of the overview, which is to say after everything somebody has to
  // scroll past. The moment a person wants to send their score to somebody is
  // the moment they read it, and this is where they read it.
  const share = strip.querySelector<HTMLButtonElement>("#ss-share");
  if (share) {
    share.onclick = async () => {
      const photo = document.getElementById("photo-canvas") as HTMLCanvasElement | null;
      if (!photo) return;
      share.disabled = true;
      try {
        const card = await renderShareCard(report, photo);
        await shareCard(card, report.overall);
      } finally {
        share.disabled = false;
      }
    };
  }

  detach = watchScroll(pane);
}


function typeInto(el: HTMLElement, text: string, delay: number): void {
  // The height is claimed before the first character so the strip does not
  // grow a line partway through and shove the analysis under the reader.
  el.textContent = text;
  const height = el.offsetHeight;
  el.style.minHeight = `${height}px`;
  el.textContent = "";
  window.setTimeout(() => {
    if (!el.isConnected) return;
    let i = 0;
    const tick = window.setInterval(() => {
      if (!el.isConnected) {
        clearInterval(tick);
        return;
      }
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(tick);
        el.style.minHeight = "";
      }
    }, 16);
  }, delay);
}

// The shrink. Returns its own teardown, so a re-render or a new scan cannot
// leave a scroll listener behind pointing at a detached element.
function watchScroll(pane: HTMLElement): () => void {
  let shrunk = false;
  let queued = false;

  // How far down the screen the pinned photo column reaches, published so the
  // tab row can pin directly under it instead of behind it.
  //
  // Measured rather than assumed because the height is not a constant: the
  // column shrinks on scroll, the score strip grows a line when the ranking
  // wraps, and the quality chips move in and out of it at the breakpoint. A
  // hard-coded offset would be right in exactly one of those states.
  const main = pane.closest<HTMLElement>("#v-main") ?? pane.parentElement;
  const publish = (): void => {
    if (!main || !pane.isConnected) return;
    main.style.setProperty("--pin-top", `${Math.round(pane.getBoundingClientRect().height)}px`);
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
  ro?.observe(pane);
  publish();

  const measure = (): void => {
    queued = false;
    if (!pane.isConnected) return;
    const y = window.scrollY;
    if (!shrunk && y > SHRINK_AT) {
      shrunk = true;
      pane.classList.add("shrunk");
    } else if (shrunk && y < GROW_AT) {
      shrunk = false;
      pane.classList.remove("shrunk");
    }
  };
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  measure();
  return () => {
    window.removeEventListener("scroll", onScroll);
    ro?.disconnect();
    main?.style.removeProperty("--pin-top");
    pane.classList.remove("shrunk");
  };
}

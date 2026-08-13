import { loadVerdictTone, saveVerdictTone } from "../engine/analysisMode.ts";
import type { VerdictTone } from "../engine/analysisMode.ts";

// ---------------------------------------------------------------------------
// "How do you want this said?"
//
// Asked once, the first time somebody chooses the verdict mode — from the quiz,
// from the results screen, from settings, from /quick, from a request to Max.
// The question belongs to the MODE, not to the place it was chosen, which is
// why it lives here rather than in the onboarding quiz: someone who picked full
// analysis on day one and switches to one-word answers in month two has still
// never been asked, and must be.
//
// Two things it is doing at once.
//
// The obvious one: some people want to be called chopped by a face app and some
// do not, and no photograph tells you which.
//
// The one that matters commercially: consent. A person who was asked and chose
// the blunt wording opted into the joke. A person who was never asked was
// insulted by a product. Those are different events — to them, to an app-store
// reviewer, and to a parent reading it over a fifteen-year-old's shoulder — and
// the difference is one dialog.
//
// Deliberately NOT phrased as "are you easily offended". That reads as a dare,
// which pressures exactly the people the question exists to protect into
// picking the harsher option to avoid looking soft. Asking what they want to
// read has no wrong answer to be embarrassed by.
// ---------------------------------------------------------------------------

let host: HTMLElement | null = null;

export function needsTonePrompt(): boolean {
  return loadVerdictTone() === null;
}

// Resolves with the chosen tone. Resolves immediately with the stored one if
// the question has already been answered, so callers can await unconditionally.
export function askVerdictTone(force = false): Promise<VerdictTone> {
  const stored = loadVerdictTone();
  if (stored && !force) return Promise.resolve(stored);

  return new Promise((resolve) => {
    close();
    host = document.createElement("div");
    host.className = "toneask";
    host.innerHTML = `
      <div class="toneask-card" role="dialog" aria-modal="true" aria-labelledby="toneask-title">
        <span class="klabel">ONE-WORD RESULTS</span>
        <h2 id="toneask-title">How do you want it put?</h2>
        <p>The measurement is identical either way — the same score, the same
          percentile, the same numbers underneath. This is only the wording on
          top of it.</p>
        <div class="toneask-opts">
          <button type="button" class="toneask-opt" data-tone="blunt">
            <b>Straight up</b>
            <span>The real words people use. Expect “chopped”, “mid” and “mogger”.</span>
          </button>
          <button type="button" class="toneask-opt" data-tone="kind">
            <b>Keep it civil</b>
            <span>Same result, said plainly. No slang, nothing designed to sting.</span>
          </button>
        </div>
        <p class="toneask-foot">You can change this whenever you like.</p>
      </div>`;
    document.body.appendChild(host);

    for (const b of host.querySelectorAll<HTMLButtonElement>(".toneask-opt")) {
      b.onclick = () => {
        const tone = b.dataset.tone === "kind" ? "kind" : "blunt";
        saveVerdictTone(tone);
        close();
        resolve(tone);
      };
    }
    // No dismiss and no backdrop close on purpose. Escaping the question would
    // land somebody on a default they never picked, which is the exact state
    // this exists to prevent — and it is two buttons, not an interrogation.
  });
}

function close(): void {
  host?.remove();
  host = null;
}

import { loadVerdictTone, saveVerdictTone } from "../engine/analysisMode.js";
import type { VerdictTone } from "../engine/analysisMode.js";

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
// What this is for, now that no register carries slang.
//
// It used to be a consent gate: one option handed people "chopped" and
// "mogger", and being asked first is the difference between opting into a joke
// and being insulted by a product. Those words are gone from every ladder, so
// that job is done in the data rather than in a dialog.
//
// What remains is a real preference, and it is not about how harsh the words
// are. Every register says the same thing at the same percentile; they differ
// in what they describe. One describes the FACE ("average looking", "great
// looking"), the other describes the PERSON'S POSITION and what is left to
// work with ("plenty to work with", "turns heads"). People screenshot the
// first and act on the second.
//
// Still deliberately NOT phrased as "are you easily offended". That reads as a
// dare, which pressures exactly the people the question exists to protect into
// picking the option that sounds tougher. Asking what they want to read has no
// wrong answer to be embarrassed by.
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
        <p>The measurement is identical either way: the same score, the same
          percentile, the same numbers underneath. This is only the wording on
          top of it.</p>
        <div class="toneask-opts">
          <button type="button" class="toneask-opt" data-tone="blunt">
            <b>Describe the face</b>
            <span>What it looks like, said plainly. “Average looking”, “good looking”, “great looking”.</span>
          </button>
          <button type="button" class="toneask-opt" data-tone="kind">
            <b>Tell me where I stand</b>
            <span>The same result, framed around what there is to work with.</span>
          </button>
        </div>
        <p class="toneask-foot">You can change this whenever you like.</p>
      </div>`;
    document.body.appendChild(host);

    for (const b of host.querySelectorAll<HTMLButtonElement>(".toneask-opt")) {
      b.onclick = () => {
        const raw = b.dataset.tone;
        const tone: VerdictTone = raw === "kind" ? "kind" : raw === "blunt" ? "blunt" : "polite";
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

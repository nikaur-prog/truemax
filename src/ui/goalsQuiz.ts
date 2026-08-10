import { GOALS, QUIET_TOPICS, loadProfile, saveProfile } from "../engine/goals.ts";
import type { AdviceChannel, Profile } from "../engine/goals.ts";
import type { RegionId } from "../engine/types.ts";

// ---------------------------------------------------------------------------
// The quiz, split by moment.
//
// PRE-SCAN is one card: what do you want to change. It is light, optional, and
// it earns its place immediately by reordering the plan.
//
// POST-SCAN is the rest, and it only opens the first time someone reaches their
// plan. Asking "anything you'd rather I didn't write about?" before a person has
// seen a single number means asking them to name an insecurity to a stranger
// with no idea what the app even measures — the highest-friction, lowest-
// information moment in the whole flow. After a scan they have the numbers in
// front of them and the question answers itself.
//
// The protection is not tied to the coach shipping. The deterministic plan
// already writes paragraphs about specific regions today, and a template lands
// as hard as a conversation does.
// ---------------------------------------------------------------------------

export type Phase = "pre" | "post" | "all";

interface Step {
  id: string;
  kicker: string;
  question: string;
  note: string;
  render(p: Profile): string;
  // Apply a click and report nothing — the DOM is synced separately, never by
  // re-rendering the card. Re-rendering replayed the whole slide-in animation
  // on every chip tap, which is the flicker this indirection exists to kill.
  pick?(key: string, p: Profile): void;
  wire?(root: HTMLElement, p: Profile): void;
  // Which chips should read as selected, given current state
  selected(p: Profile): Set<string>;
}

const chip = (label: string, key: string, sub = "") =>
  `<button class="q-chip" data-key="${key}" aria-pressed="false">
     <span class="q-chip-l">${label}</span>
     ${sub ? `<span class="q-chip-s">${sub}</span>` : ""}
   </button>`;

function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const GOALS_STEP: Step = {
  id: "goals",
  kicker: "GOALS",
  question: "What are you actually trying to change?",
  note: "Pick as many as apply. This reorders your plan so the levers you care about come first — it never changes a single measurement.",
  render: () =>
    `<div class="q-grid">${GOALS.map((g) => chip(g.label, g.id, g.blurb)).join("")}</div>
     <p class="q-foot">Skin, teeth and muscle aren't things a face mesh can measure. Pick them anyway — they'll appear in your plan labelled honestly as unmeasured.</p>`,
  pick: (k, p) => {
    p.goals = toggleIn(p.goals, k);
  },
  selected: (p) => new Set(p.goals),
};

const BOUNDARIES_STEP: Step = {
  id: "quiet",
  kicker: "BOUNDARIES",
  question: "Anything you'd rather I didn't write about?",
  note: "Optional, and it changes nothing about the analysis. Every number is still measured and still shown — a scanner that quietly skipped things would be worthless. This only stops the written plan from making a topic into a project.",
  render: () =>
    `<div class="q-grid two">${QUIET_TOPICS.map((t) => chip(t.label, t.region)).join("")}</div>
     <p class="q-foot">You can change this any time from your plan.</p>`,
  pick: (k, p) => {
    p.quiet = toggleIn(p.quiet, k as RegionId);
  },
  selected: (p) => new Set(p.quiet),
};

const ADVICE_STEP: Step = {
  id: "advice",
  kicker: "COACHING",
  question: "What kind of advice is welcome?",
  note: "Turn either off and the plan keeps the measurement but drops the recommendation.",
  render: () =>
    `<div class="q-grid two">
       ${chip("Food and drink", "adv:diet", "Body fat, sodium, alcohol")}
       ${chip("Sleep and habits", "adv:lifestyle", "Rest, posture, routine")}
     </div>
     <p class="q-foot">Nothing here is medical advice, and there is nothing to buy — no supplements, no procedures, ever.</p>`,
  pick: (k, p) => {
    const c = k.slice(4) as AdviceChannel;
    p.advice[c] = !p.advice[c];
  },
  selected: (p) =>
    new Set(
      (["diet", "lifestyle"] as AdviceChannel[]).filter((c) => p.advice[c]).map((c) => `adv:${c}`),
    ),
};

const ENDGOAL_STEP: Step = {
  id: "endGoal",
  kicker: "THE POINT",
  question: "What does the finish line look like?",
  note: "One line, in your words. It sits at the top of your plan so every scan is measured against the thing you actually came here for.",
  render: (p) =>
    `<input class="q-input" id="q-endgoal" maxlength="90" placeholder="e.g. look sharp at my brother's wedding in June"
       value="${p.endGoal.replace(/"/g, "&quot;")}" />
     <p class="q-foot">Stored on this device only, like everything else here.</p>`,
  wire: (root, p) => {
    const input = root.querySelector<HTMLInputElement>("#q-endgoal");
    if (!input) return;
    input.oninput = () => {
      p.endGoal = input.value;
    };
    setTimeout(() => input.focus(), 120);
  },
  selected: () => new Set(),
};

const PHASES: Record<Phase, Step[]> = {
  pre: [GOALS_STEP],
  post: [BOUNDARIES_STEP, ADVICE_STEP, ENDGOAL_STEP],
  all: [GOALS_STEP, BOUNDARIES_STEP, ADVICE_STEP, ENDGOAL_STEP],
};

let host: HTMLElement | null = null;

export function openQuiz(onDone: (p: Profile) => void, phase: Phase = "all"): void {
  const p = loadProfile();
  const steps = PHASES[phase];
  let step = 0;

  host?.remove();
  host = document.createElement("div");
  host.className = "q-overlay";
  document.body.appendChild(host);
  document.body.style.overflow = "hidden";

  const close = (save: boolean) => {
    if (save) {
      if (phase !== "post") p.preDone = true;
      if (phase !== "pre") p.postDone = true;
      saveProfile(p);
    }
    host?.remove();
    host = null;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (save) onDone(p);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close(false);
    if (e.key === "Enter" && step < steps.length - 1) next();
  };
  document.addEventListener("keydown", onKey);

  const next = () => {
    if (step < steps.length - 1) {
      step++;
      draw();
    } else close(true);
  };

  // Sync selection state onto the existing buttons. No innerHTML, so the card
  // does not re-animate and the colour transition on .q-chip is what the user
  // actually sees: a tap that slides to green.
  const sync = () => {
    if (!host) return;
    const on = steps[step].selected(p);
    for (const b of host.querySelectorAll<HTMLButtonElement>(".q-chip")) {
      const isOn = on.has(b.dataset.key!);
      b.classList.toggle("on", isOn);
      b.setAttribute("aria-pressed", String(isOn));
    }
  };

  const draw = () => {
    if (!host) return;
    const s = steps[step];
    host.innerHTML = `
      <div class="q-card" role="dialog" aria-modal="true" aria-label="${s.question}">
        <div class="q-top">
          <div class="q-rail">${steps
            .map((_, i) => `<i class="${i < step ? "done" : i === step ? "now" : ""}"></i>`)
            .join("")}</div>
          <button class="q-x" id="q-x" aria-label="Close">✕</button>
        </div>
        <div class="q-body">
          <div class="q-kicker">${s.kicker}${steps.length > 1 ? ` · ${step + 1} OF ${steps.length}` : ""}</div>
          <h2>${s.question}</h2>
          <p class="q-note">${s.note}</p>
          ${s.render(p)}
        </div>
        <div class="q-actions">
          <button class="btn gho" id="q-back">${step === 0 ? "Skip for now" : "Back"}</button>
          <button class="btn pri" id="q-next">${step === steps.length - 1 ? "Save and continue" : "Continue"}</button>
        </div>
      </div>`;

    if (s.pick) {
      for (const b of host.querySelectorAll<HTMLButtonElement>(".q-chip")) {
        b.onclick = () => {
          s.pick!(b.dataset.key!, p);
          sync();
        };
      }
    }
    s.wire?.(host, p);
    sync();

    host.querySelector<HTMLButtonElement>("#q-x")!.onclick = () => close(false);
    host.querySelector<HTMLButtonElement>("#q-back")!.onclick = () => {
      if (step === 0) close(true); // skipping is a valid answer; don't re-ask
      else {
        step--;
        draw();
      }
    };
    host.querySelector<HTMLButtonElement>("#q-next")!.onclick = next;
  };

  draw();
}

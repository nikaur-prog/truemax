import {
  GOALS,
  QUIET_TOPICS,
  loadProfile,
  saveProfile,
} from "../engine/goals.ts";
import type { AdviceChannel, Profile } from "../engine/goals.ts";
import type { RegionId } from "../engine/types.ts";

// ---------------------------------------------------------------------------
// The pre-quiz.
//
// Four questions, one per card, because a single long form reads as paperwork
// and this is the moment someone decides whether the thing understands them.
// Everything is skippable and everything is re-editable — an answer given once
// under pressure is worth less than one someone can change later.
//
// The third and fourth cards are the ones that matter. They are where someone
// tells us what NOT to talk about, and we honour it in the plan copy without
// ever hiding a measurement.
// ---------------------------------------------------------------------------

interface Step {
  kicker: string;
  question: string;
  note: string;
  render(p: Profile, rerender: () => void): string;
  wire(root: HTMLElement, p: Profile, rerender: () => void): void;
}

const chip = (label: string, on: boolean, key: string, sub = "") =>
  `<button class="q-chip${on ? " on" : ""}" data-key="${key}">
     <span class="q-chip-l">${label}</span>
     ${sub ? `<span class="q-chip-s">${sub}</span>` : ""}
   </button>`;

function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function wireChips(root: HTMLElement, onPick: (key: string) => void): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>(".q-chip")) {
    b.onclick = () => onPick(b.dataset.key!);
  }
}

const STEPS: Step[] = [
  {
    kicker: "GOALS",
    question: "What are you actually trying to change?",
    note: "Pick as many as apply. This reorders your plan so the levers you care about come first — it never changes a single measurement.",
    render: (p) =>
      `<div class="q-grid">${GOALS.map((g) =>
        chip(g.label, p.goals.includes(g.id), g.id, g.blurb),
      ).join("")}</div>
       <p class="q-foot">Skin, teeth and muscle aren't things a face mesh can measure. Pick them anyway — they'll appear in your plan labelled honestly as unmeasured.</p>`,
    wire: (root, p, rerender) =>
      wireChips(root, (k) => {
        p.goals = toggleIn(p.goals, k);
        rerender();
      }),
  },
  {
    kicker: "BOUNDARIES",
    question: "Anything you'd rather I didn't write about?",
    note: "Optional, and it changes nothing about the analysis. Every number is still measured and still shown — a scanner that quietly skipped things would be worthless. This only stops the written plan from making a topic into a project.",
    render: (p) =>
      `<div class="q-grid two">${QUIET_TOPICS.map((t) =>
        chip(t.label, p.quiet.includes(t.region), t.region),
      ).join("")}</div>
       <p class="q-foot">You can change this any time from your plan.</p>`,
    wire: (root, p, rerender) =>
      wireChips(root, (k) => {
        p.quiet = toggleIn(p.quiet, k as RegionId);
        rerender();
      }),
  },
  {
    kicker: "COACHING",
    question: "What kind of advice is welcome?",
    note: "Turn either off and the plan keeps the measurement but drops the recommendation.",
    render: (p) =>
      `<div class="q-grid two">
         ${chip("Food and drink", p.advice.diet, "adv:diet", "Body fat, sodium, alcohol")}
         ${chip("Sleep and habits", p.advice.lifestyle, "adv:lifestyle", "Rest, posture, routine")}
       </div>
       <div class="q-sub">Average sleep a night</div>
       <div class="q-grid five">
         ${[
           ["4", "Under 5h"],
           ["5.5", "5–6h"],
           ["6.5", "6–7h"],
           ["7.5", "7–8h"],
           ["8.5", "8h+"],
         ]
           .map(([v, l]) => chip(l, p.sleepHours === +v, `sleep:${v}`))
           .join("")}
       </div>
       <p class="q-foot">Nothing here is medical advice, and there is nothing to buy — no supplements, no procedures, ever.</p>`,
    wire: (root, p, rerender) =>
      wireChips(root, (k) => {
        if (k.startsWith("adv:")) {
          const c = k.slice(4) as AdviceChannel;
          p.advice[c] = !p.advice[c];
        } else if (k.startsWith("sleep:")) {
          const v = +k.slice(6);
          p.sleepHours = p.sleepHours === v ? null : v;
        }
        rerender();
      }),
  },
  {
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
  },
];

let host: HTMLElement | null = null;

export function openQuiz(onDone: (p: Profile) => void): void {
  const p = loadProfile();
  let step = 0;

  host?.remove();
  host = document.createElement("div");
  host.className = "q-overlay";
  document.body.appendChild(host);
  document.body.style.overflow = "hidden";

  const close = (save: boolean) => {
    if (save) {
      p.done = true;
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
    if (e.key === "Enter" && step < STEPS.length - 1) next();
  };
  document.addEventListener("keydown", onKey);

  const next = () => {
    if (step < STEPS.length - 1) {
      step++;
      draw();
    } else close(true);
  };

  const draw = () => {
    if (!host) return;
    const s = STEPS[step];
    host.innerHTML = `
      <div class="q-card" role="dialog" aria-modal="true" aria-label="${s.question}">
        <div class="q-top">
          <div class="q-rail">${STEPS.map(
            (_, i) => `<i class="${i < step ? "done" : i === step ? "now" : ""}"></i>`,
          ).join("")}</div>
          <button class="q-x" id="q-x" aria-label="Close">✕</button>
        </div>
        <div class="q-body" key="${step}">
          <div class="q-kicker">${s.kicker} · ${step + 1} OF ${STEPS.length}</div>
          <h2>${s.question}</h2>
          <p class="q-note">${s.note}</p>
          ${s.render(p, draw)}
        </div>
        <div class="q-actions">
          <button class="btn gho" id="q-back">${step === 0 ? "Skip for now" : "Back"}</button>
          <button class="btn pri" id="q-next">${step === STEPS.length - 1 ? "Save and continue" : "Continue"}</button>
        </div>
      </div>`;

    s.wire(host, p, draw);
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

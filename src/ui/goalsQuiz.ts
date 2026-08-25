import { GOALS, QUIET_TOPICS, SKIN_CONCERNS, loadProfile, saveProfile } from "../engine/goals.js";
import type { AdviceChannel, Profile } from "../engine/goals.js";
import type { RegionId } from "../engine/types.js";
import { ETHNICITY_OPTIONS } from "./subjectChooser.js";

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
  // Steps that are only relevant to some people. Evaluated when the quiz
  // opens, so answers given on an earlier card can gate a later one.
  when?(p: Profile): boolean;
}

const chip = (label: string, key: string, sub = "") =>
  `<button class="q-chip" data-key="${key}" aria-pressed="false">
     <span class="q-chip-l">${label}</span>
     ${sub ? `<span class="q-chip-s">${sub}</span>` : ""}
   </button>`;

function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const railHTML = (n: number, at: number): string =>
  Array.from({ length: n }, (_, i) => `<i class="${i < at ? "done" : i === at ? "now" : ""}"></i>`).join("");

const GOALS_STEP: Step = {
  id: "goals",
  kicker: "GOALS",
  question: "What are you actually trying to change?",
  note: "Pick as many as apply. This reorders your plan so the levers you care about come first. It never changes a single measurement.",
  render: () =>
    `<div class="q-grid">${GOALS.map((g) => chip(g.label, g.id, g.blurb)).join("")}</div>
     <p class="q-foot">Skin, teeth and muscle aren't things a face mesh can measure. Pick them anyway, and they'll appear in your plan labelled honestly as unmeasured.</p>`,
  pick: (k, p) => {
    p.goals = toggleIn(p.goals, k);
  },
  selected: (p) => new Set(p.goals),
};

const BOUNDARIES_STEP: Step = {
  id: "quiet",
  kicker: "BOUNDARIES",
  question: "Anything you'd rather I didn't write about?",
  note: "Optional, and it changes nothing about the analysis. Every number is still measured and still shown, because a scanner that quietly skipped things would be worthless. This only stops the written plan from making a topic into a project.",
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
     <p class="q-foot">Nothing here is medical advice. There are no supplements or at-home procedures; professional options are clearly labelled and require a qualified clinician.</p>`,
  pick: (k, p) => {
    const c = k.slice(4) as AdviceChannel;
    p.advice[c] = !p.advice[c];
  },
  selected: (p) =>
    new Set(
      (["diet", "lifestyle"] as AdviceChannel[]).filter((c) => p.advice[c]).map((c) => `adv:${c}`),
    ),
};

const DIET_STEP: Step = {
  id: "diet",
  kicker: "FOOD",
  question: "Anything I should work around?",
  note: "Only used so a food suggestion never names something you don't eat. It is not a health question and nothing here affects a single measurement.",
  render: () =>
    `<div class="q-grid two">
       ${chip("Vegetarian", "vegetarian")}
       ${chip("Vegan", "vegan")}
       ${chip("Dairy-free", "dairy-free")}
       ${chip("No shellfish", "no-shellfish")}
     </div>
     <p class="q-foot">Nothing on your plan is a supplement, a pill or a calorie target. Food appears as facts about food, and that is all.</p>`,
  pick: (k, p) => {
    p.diet = toggleIn(p.diet, k);
  },
  selected: (p) => new Set(p.diet),
};

// Only shown to people who said skin was a goal. Asking everyone to itemise
// what is wrong with their skin, unprompted, is the single most intrusive
// question in the app; asking the people who raised it themselves is just
// listening.
const SKIN_STEP: Step = {
  id: "skin",
  kicker: "SKIN",
  question: "What would you call the problem?",
  note: "You tell us, because the scan can't. It measures how evenly your face reflects light, and that cannot tell breakouts from eczema from rosacea. Your answer only decides which over-the-counter options are worth showing you.",
  when: (p) => p.goals.includes("skin"),
  render: () =>
    `<div class="q-grid two">${SKIN_CONCERNS.map((c) => chip(c.label, c.id, c.blurb)).join("")}</div>
     <p class="q-foot">Not a diagnosis, not stored anywhere but this device, and it never touches a single measurement or your score. Anything persistent, painful or spreading is worth showing to a pharmacist or a doctor rather than an app.</p>`,
  pick: (k, p) => {
    // "None of these" is exclusive in both directions — it cannot coexist with
    // a named concern without one of them being wrong.
    if (k === "none") p.skin = p.skin.includes("none") ? [] : ["none"];
    else p.skin = toggleIn(p.skin.filter((s) => s !== "none"), k);
  },
  selected: (p) => new Set(p.skin),
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

// Asked once, at signup, so a scan of your own face never has to ask again.
// Only shown while unanswered — a returning member is not re-interrogated.
const ABOUT_STEP: Step = {
  id: "about",
  kicker: "ABOUT YOU",
  question: "Which population should your face be scored against?",
  note: "This is the single largest input you control: the same face scored against the other group moves by a median of 0.7 points and up to 4.5. Asked once here so every scan of your own face can skip it.",
  render: (p) => `
    <div class="q-row">
      ${chip("Men", "male", "Scored against men")}
      ${chip("Women", "female", "Scored against women")}
    </div>
    <label class="q-sublabel" for="q-eth">Background <em>optional</em></label>
    <select class="q-input" id="q-eth">
      <option value="">Prefer not to say</option>
      ${ETHNICITY_OPTIONS.filter((o) => o !== "Prefer not to say")
        .map((o) => `<option value="${o}"${p.ethnicity === o ? " selected" : ""}>${o}</option>`)
        .join("")}
    </select>
    <p class="q-foot">The background question changes no measurement and selects no different standard — there is one scale, the same for everybody. It is recorded only so we can say honestly who our reference set actually covers.</p>`,
  pick: (key, p) => {
    if (key === "male" || key === "female") p.sex = key;
  },
  wire: (root, p) => {
    const sel = root.querySelector<HTMLSelectElement>("#q-eth");
    if (sel) sel.onchange = () => { p.ethnicity = sel.value || undefined; };
  },
  selected: (p) => new Set(p.sex ? [p.sex] : []),
  when: (p) => !p.sex,
};

const PHASES: Record<Phase, Step[]> = {
  pre: [ABOUT_STEP, GOALS_STEP],
  post: [BOUNDARIES_STEP, SKIN_STEP, ADVICE_STEP, DIET_STEP, ENDGOAL_STEP],
  all: [ABOUT_STEP, GOALS_STEP, BOUNDARIES_STEP, SKIN_STEP, ADVICE_STEP, DIET_STEP, ENDGOAL_STEP],
};

let host: HTMLElement | null = null;

export function openQuiz(onDone: (p: Profile) => void, phase: Phase = "all"): void {
  const p = loadProfile();
  // Visibility is recomputed on every navigation rather than fixed when the
  // quiz opens, because a conditional card can be gated on an answer given two
  // cards earlier in the same run — picking "Skin quality" must make the skin
  // card appear now, not on the next visit. Position is therefore tracked by
  // step id, since the index it sits at moves underneath it.
  //
  // A card that has already been PUT ON SCREEN stays on screen, even if its own
  // `when` has since gone false. That case is real: the population card is
  // gated on `!p.sex` and answering it is what sets p.sex, so the card
  // vanished from under the tap that answered it — the chip never lit (sync
  // painted the next step's selection onto it), the counter jumped to the next
  // card's title, and Continue skipped a whole question because index 0 was no
  // longer the card being looked at. Sticky-once-shown keeps the tap, the
  // count, the rail and Back all describing the thing in front of the person.
  const shown = new Set<string>();
  const visible = () => PHASES[phase].filter((s) => shown.has(s.id) || !s.when || s.when(p));
  let curId = visible()[0].id;
  shown.add(curId);
  const idx = () => Math.max(0, visible().findIndex((s) => s.id === curId));

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
    if (e.key === "Enter" && idx() < visible().length - 1) next();
  };
  document.addEventListener("keydown", onKey);

  const next = () => {
    const v = visible();
    const i = idx();
    if (i < v.length - 1) {
      curId = v[i + 1].id;
      shown.add(curId);
      draw();
    } else close(true);
  };

  // Sync selection state onto the existing buttons. No innerHTML, so the card
  // does not re-animate and the colour transition on .q-chip is what the user
  // actually sees: a tap that slides to green.
  const sync = () => {
    if (!host) return;
    const v = visible();
    const i = idx();
    const on = v[i].selected(p);
    for (const b of host.querySelectorAll<HTMLButtonElement>(".q-chip")) {
      const isOn = on.has(b.dataset.key!);
      b.classList.toggle("on", isOn);
      b.setAttribute("aria-pressed", String(isOn));
    }
    // A tap can add or remove a later card, so the counter and the rail have to
    // move with it — without re-rendering, which is what the flicker fix bought.
    const kicker = host.querySelector<HTMLElement>("#q-kicker");
    if (kicker) kicker.textContent = v.length > 1 ? `${v[i].kicker} · ${i + 1} OF ${v.length}` : v[i].kicker;
    const rail = host.querySelector<HTMLElement>("#q-rail");
    if (rail) rail.innerHTML = railHTML(v.length, i);
    const nextBtn = host.querySelector<HTMLButtonElement>("#q-next");
    if (nextBtn) nextBtn.textContent = i === v.length - 1 ? "Save and continue" : "Continue";
  };

  const draw = () => {
    if (!host) return;
    const v = visible();
    const i = idx();
    const s = v[i];
    host.innerHTML = `
      <div class="q-card" role="dialog" aria-modal="true" aria-label="${s.question}">
        <div class="q-top">
          <div class="q-rail" id="q-rail">${railHTML(v.length, i)}</div>
          <button class="q-x" id="q-x" aria-label="Close">✕</button>
        </div>
        <div class="q-body">
          <div class="q-kicker" id="q-kicker">${s.kicker}${v.length > 1 ? ` · ${i + 1} OF ${v.length}` : ""}</div>
          <h2>${s.question}</h2>
          <p class="q-note">${s.note}</p>
          ${s.render(p)}
        </div>
        <div class="q-actions">
          <button class="btn gho" id="q-back">${i === 0 ? "Skip for now" : "Back"}</button>
          <button class="btn pri" id="q-next">${i === v.length - 1 ? "Save and continue" : "Continue"}</button>
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
      const vv = visible();
      const i2 = idx();
      if (i2 === 0) close(true); // skipping is a valid answer; don't re-ask
      else {
        curId = vv[i2 - 1].id;
        draw();
      }
    };
    host.querySelector<HTMLButtonElement>("#q-next")!.onclick = next;
  };

  draw();
}

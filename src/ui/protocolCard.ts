import {
  commitProtocol,
  judge,
  nextPrompt,
  readProtocols,
  startKindOf,
  verdictCopy,
  writeProtocols,
} from "../engine/protocol.js";
import type { Protocol, ProtocolPrompt } from "../engine/protocol.js";
import { DISPLAY_NOISE } from "../engine/history.js";
import type { ScanDelta } from "../engine/history.js";

// ---------------------------------------------------------------------------
// The check-in, on the report.
//
// engine/protocol.ts decides WHETHER Max has anything to say about a running
// protocol and WHAT. This renders that, takes the answer, and writes it back.
//
// It is one question with two pre-set replies and nothing else. Every version
// of this that grows a free-text box, a slider or a "remind me later" turns a
// two-second tap into a form, and a check-in nobody answers is worse than no
// check-in at all — it is the adherence data the whole clock depends on, and
// the only way to get it is to make answering cheaper than ignoring.
//
// Renders NOTHING most of the time. nextPrompt returns null while a protocol
// is waiting on a date somebody gave, inside the six-day gap between check-ins,
// or once it has been judged, and this respects that literally: no card, no
// empty container, no "nothing to check in on today" placeholder. A coach with
// something to say every visit is noise.
// ---------------------------------------------------------------------------

/** How the card reports what happened, so the caller can re-render. */
export interface ProtocolCardHandle {
  destroy(): void;
}

const now = (): number => Date.now();

function save(list: Protocol[], updated: Protocol): void {
  writeProtocols(list.map((p) => (p.id === updated.id ? updated : p)));
}

/**
 * Apply an answer.
 *
 * Exported and pure-ish so the tests can walk a protocol through the whole
 * ladder without a DOM. The status transitions live here rather than in the
 * click handler because they are the part that must not drift: a wrong one
 * silently restarts somebody's eight-week clock.
 */
export function applyAnswer(p: Protocol, prompt: ProtocolPrompt, yes: boolean, at: number): Protocol {
  switch (prompt.kind) {
    case "decide":
      // A yes does NOT start the clock. What it queues depends on how the
      // thing begins: a product still needs a date it will be in hand, while a
      // commitment or an instant job gets a near check-back set for it — see
      // commitProtocol. A protocol starts when it starts, in every case.
      return yes ? commitProtocol(p, at) : { ...p, status: "declined" };
    case "started":
      return yes
        ? { ...p, status: "running", startedAt: at }
        // Not yet. Push the expected date out a week rather than nagging
        // tomorrow, and leave the status alone.
        : { ...p, startBy: at + 7 * 24 * 60 * 60 * 1000 };
    case "adherence":
      return { ...p, checkIns: [...p.checkIns, { at, using: yes, noticing: null }] };
    case "judge":
      return {
        ...p,
        status: "judged",
        checkIns: [...p.checkIns, { at, using: true, noticing: yes }],
      };
    case "when":
      return p; // handled by answerWhen, which needs a date rather than a yes/no
  }
}

/** The "when will you have it" answer, in whole days from today. */
export function answerWhen(p: Protocol, days: number, at: number): Protocol {
  return { ...p, startBy: at + Math.max(0, days) * 24 * 60 * 60 * 1000 };
}

// Rough options rather than a date picker. Nobody knows exactly when a parcel
// lands, the clock does not need the precision, and three taps to set a date
// for a thing you have not bought yet is where people quit.
const WHEN_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: "This week", days: 5 },
  { label: "Next week", days: 12 },
  { label: "Not sure yet", days: 21 },
];

/**
 * Mount the check-in card, if there is anything to check in on.
 *
 * `delta` is the scan movement, used only when a protocol comes due: the
 * verdict needs to know whether the face actually moved, and that judgement is
 * made here against DISPLAY_NOISE rather than inside the engine, so the engine
 * can never be handed a raw number and talked into calling a 0.2 wobble a win.
 */
export function mountProtocolCard(
  host: HTMLElement | null,
  delta: ScanDelta | null,
  onChange?: () => void,
): ProtocolCardHandle | null {
  if (!host) return null;
  const list = readProtocols();
  if (!list.length) return null;

  // The most advanced thing with something to say. A protocol at its judge
  // date matters more than one on a week-three adherence ping, and two cards
  // at once is a form.
  const order: Record<ProtocolPrompt["kind"], number> = {
    judge: 0, started: 1, decide: 2, when: 3, adherence: 4,
  };
  let best: { protocol: Protocol; prompt: ProtocolPrompt } | null = null;
  for (const p of list) {
    const prompt = nextPrompt(p, now());
    if (!prompt) continue;
    if (!best || order[prompt.kind] < order[best.prompt.kind]) best = { protocol: p, prompt };
  }
  if (!best) return null;

  const card = document.createElement("div");
  card.className = `protocard protocard-${best.prompt.kind}`;
  render(card, best.protocol, best.prompt);
  host.appendChild(card);

  function render(el: HTMLElement, p: Protocol, prompt: ProtocolPrompt): void {
    const replies = prompt.kind === "when"
      ? WHEN_OPTIONS.map((o, i) => `<button type="button" class="protocard-pill" data-when="${i}">${o.label}</button>`).join("")
      : `<button type="button" class="protocard-pill pri" data-yes>${"yes" in prompt ? prompt.yes : "Yes"}</button>
         <button type="button" class="protocard-pill" data-no>${"no" in prompt ? prompt.no : "No"}</button>`;
    el.innerHTML = `
      <span class="klabel">${prompt.kind === "judge" ? "TIME TO CALL IT" : "CHECKING IN"}</span>
      <p class="protocard-ask">${escapeHTML(prompt.ask)}</p>
      <div class="protocard-pills">${replies}</div>`;

    for (const b of el.querySelectorAll<HTMLButtonElement>("[data-when]")) {
      b.onclick = () => {
        const opt = WHEN_OPTIONS[Number(b.dataset.when)]!;
        const updated = answerWhen(p, opt.days, now());
        save(readProtocols(), updated);
        // The clock is explicit, because a promise with a vague date is not a
        // promise. Said as the date it starts, not as "in five days".
        settle(el, `Nice one. I'll check in once you've started. Remember the ${p.weeksToJudge} weeks runs from the day you actually begin, not from today.`);
      };
    }
    const yes = el.querySelector<HTMLButtonElement>("[data-yes]");
    const no = el.querySelector<HTMLButtonElement>("[data-no]");
    if (yes) yes.onclick = () => answer(el, p, prompt, true);
    if (no) no.onclick = () => answer(el, p, prompt, false);
  }

  function answer(el: HTMLElement, p: Protocol, prompt: ProtocolPrompt, said: boolean): void {
    const at = now();
    const updated = applyAnswer(p, prompt, said, at);
    save(readProtocols(), updated);

    if (prompt.kind === "judge") {
      // Their answer and the scan's are two different readings and both get
      // said. "worthNoting" is history.ts's own grade against DISPLAY_NOISE —
      // the raw number never reaches the verdict.
      const scanMoved = delta != null && delta.reading === "worthNoting" && delta.overall > 0;
      const v = judge(updated, at, scanMoved || said);
      const disagree = said !== scanMoved
        ? said
          ? ` The scan hasn't caught up with you yet, and that's normal — you see your own face every day and it only needs to shift a little for you to clock it. ${DISPLAY_NOISE.toFixed(1)} points is the smallest thing I can call.`
          : ` For what it's worth, the scan does think something moved. Worth another few weeks before you write it off.`
        : "";
      settle(el, verdictCopy(v) + disagree);
      onChange?.();
      return;
    }
    // An instant thing that just got done has nothing to "keep up" — the next
    // conversation is the verdict, so say that instead of promising check-ins.
    const instantDone = said && prompt.kind === "started" && startKindOf(p) === "instant";
    settle(el, said
      ? instantDone
        ? "Good. Have a proper look in decent light, and next time you're here I'll ask whether you can see it."
        : "Good. I'll leave you to it and check in next week."
      : prompt.kind === "adherence"
        ? "Fair enough, and thanks for being straight with me. Nothing changes yet. Pick it back up when you can and the clock carries on from where it was."
        : "No problem. I'll ask again in a week.");
    onChange?.();
  }

  // The card does not vanish on answer. A control that disappears the instant
  // you touch it leaves you unsure it registered, and Max having the last word
  // is the whole texture of this thing.
  function settle(el: HTMLElement, said: string): void {
    el.classList.add("protocard-done");
    el.innerHTML = `<p class="protocard-ask">${escapeHTML(said)}</p>`;
  }

  return { destroy: () => card.remove() };
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

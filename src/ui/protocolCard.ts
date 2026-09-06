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
import { localDay } from "../engine/dailyStreak.js";
import { tickProtocol, tickedOn } from "../engine/protocol.js";
import { recordStreakAction } from "./streakLamp.js";
import { activeScanOwner } from "../engine/scanScope.js";

// ---------------------------------------------------------------------------
// The check-in, in the performance tracker.
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
  const owner = activeScanOwner();
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
        if (!owner || activeScanOwner() !== owner || !el.isConnected) return;
        const opt = WHEN_OPTIONS[Number(b.dataset.when)]!;
        const list = readProtocols();
        const latest = list.find((entry) => entry.id === p.id);
        if (!latest || nextPrompt(latest, now())?.kind !== prompt.kind) return;
        const updated = answerWhen(latest, opt.days, now());
        save(list, updated);
        onChange?.();
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
    if (!owner || activeScanOwner() !== owner || !el.isConnected) return;
    const at = now();
    const list = readProtocols();
    const latest = list.find((entry) => entry.id === p.id);
    if (!latest || nextPrompt(latest, at)?.kind !== prompt.kind) return;
    // The daily tick can change this record while the check-in remains open.
    // Answer the latest record so that answering never erases today's tick.
    const updated = applyAnswer(latest, prompt, said, at);
    save(list, updated);

    // An answered check-in is a plan action, so it counts the day. Only the
    // kinds that record a check-in: deciding or dating a protocol is
    // paperwork, not doing the thing.
    if (prompt.kind === "adherence" || prompt.kind === "judge") recordStreakAction("checkin");

    if (prompt.kind === "judge") {
      // Their answer and the scan's are two different readings and both get
      // said. "worthNoting" is history.ts's own grade against DISPLAY_NOISE —
      // the raw number never reaches the verdict.
      const scanMoved = delta != null && delta.reading === "worthNoting" && delta.overall > 0;
      const v = judge(updated, at, scanMoved || said);
      const disagree = said !== scanMoved
        ? said
          ? ` The scan hasn't caught up with you yet, and that's normal: you see your own face every day and it only needs to shift a little for you to clock it. ${DISPLAY_NOISE.toFixed(1)} points is the smallest thing I can call.`
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

// ---------------------------------------------------------------------------
// "Did it today" — the daily tick.
//
// One tap a day on each running protocol. This is the daily action the
// product lacked: the tick record is what lets the judge read adherence
// from evidence instead of a memory (adherenceFromTicks), and a tick is
// what counts the day for the streak. Idempotent per day per protocol, and
// a protocol already ticked today renders as done rather than vanishing,
// so the tap visibly registered.
// ---------------------------------------------------------------------------

export function tickRowMarkup(list: Protocol[], day: string): string {
  const running = list.filter((p) => p.status === "running");
  if (!running.length) return "";
  return running.map((p) => {
    const done = tickedOn(p, day);
    return `<button type="button" class="protick${done ? " done" : ""}" data-tick="${escapeHTML(p.id)}"${done ? " disabled" : ""}>
      <i aria-hidden="true">${done ? "✓" : ""}</i>
      <span>${done ? "Done today" : "Did it today"} · ${escapeHTML(p.title)}</span>
    </button>`;
  }).join("");
}

const tickMounts = new WeakMap<HTMLElement, { refresh(): void; destroy(): void }>();

/** Mount the tick row for every running protocol. Renders nothing without one. */
export function mountDailyTicks(host: HTMLElement | null): void {
  if (!host) return;
  tickMounts.get(host)?.destroy();
  const owner = activeScanOwner();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const abort = new AbortController();
  const destroy = () => {
    stopped = true;
    clearTimeout(timer);
    abort.abort();
    detached.disconnect();
    tickMounts.delete(host);
  };
  const draw = () => {
    clearTimeout(timer);
    if (stopped) return;
    if (!host.isConnected || activeScanOwner() !== owner) {
      host.innerHTML = "";
      destroy();
      return;
    }
    const day = localDay();
    host.innerHTML = tickRowMarkup(readProtocols(), day);
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-tick]:not([disabled])")) {
      button.onclick = () => {
        if (!owner || activeScanOwner() !== owner || !host.isConnected) return;
        const list = readProtocols();
        const protocol = list.find((p) => p.id === button.dataset.tick);
        if (!protocol) return;
        // A tab may have stayed open overnight. The action's day is the tap,
        // not the calendar day on which its button was first drawn.
        const ticked = tickProtocol(protocol, localDay());
        if (ticked === protocol) return;
        save(list, ticked);
        recordStreakAction("routine");
        draw();
      };
    }
    const nextDay = new Date();
    nextDay.setHours(24, 0, 0, 50);
    timer = setTimeout(draw, Math.max(50, nextDay.getTime() - Date.now()));
  };
  const detached = new MutationObserver(() => {
    if (!host.isConnected) destroy();
  });
  // Dashboard removal is a direct body mutation; observing only that level
  // avoids inspecting every animated node and releases the timer immediately.
  detached.observe(document.body, { childList: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") draw();
  }, { signal: abort.signal });
  window.addEventListener("focus", draw, { signal: abort.signal });
  window.addEventListener("storage", (event) => {
    if (event.key === `truemax:protocols:${owner}`) draw();
  }, { signal: abort.signal });
  tickMounts.set(host, { refresh: draw, destroy });
  draw();
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

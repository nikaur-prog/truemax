import { scopedStorageKey } from "./scanScope.js";
import type { AdviceChannel } from "./goals.js";

// ---------------------------------------------------------------------------
// A protocol is a promise with a clock on it.
//
// Max recommends something. Somebody either takes it or does not. If they take
// it, there is a date they expect to have it, a date it could first honestly be
// judged, and a run of weeks in between where the only useful question is "are
// you actually doing it". This module is that clock.
//
// It exists because the read had no concept of time and was therefore free to
// say something unprofessional. Its rescan copy asked "have you been running
// the plan?" and offered to rebuild it whenever a number went flat — which,
// on a salicylic acid routine that needs eight weeks before anybody can tell,
// could fire at day nine. A coach who tells you to change product two weeks
// into an eight-week protocol is not being responsive, he is being useless,
// and the person following him never completes anything.
//
// THREE RULES, and they are the whole design:
//
// 1. NOTHING IS JUDGED EARLY. Every recommendation carries its own honest
//    time-to-effect (Rec.weeksToJudge). Before that date Max may ask whether
//    somebody is still running it. He may not suggest it is not working, and
//    he may not offer an alternative. There is nothing to know yet.
//
// 2. YOU ADD, YOU DO NOT SWAP. When a protocol has had its full run and the
//    face has not moved, the answer is not "drop that, try this" — the first
//    thing might well be doing something, and pulling it out to test a second
//    thing destroys the only evidence there was. Max keeps it and adds
//    alongside, and says so in those words.
//
// 3. ADHERENCE IS ASKED IN BOTH DIRECTIONS. "Are you using it" gets asked when
//    the number rises as well as when it falls. Asked only on a fall it is not
//    a question, it is an accusation; asked only on a rise it is flattery. It
//    is also the single most valuable thing anybody can tell this product,
//    because a working routine and a good month are identical from the scan.
//
// Everything is local. A protocol is a note about what somebody said they
// would do, kept in the same owner-scoped localStorage the scan history uses,
// and it never leaves the device.
// ---------------------------------------------------------------------------

/** The soonest anything here may be called a failure, whatever it is. */
export const MIN_WEEKS_TO_JUDGE = 4;

/**
 * How long a protocol must have run, and been flat, before Max may suggest
 * adding something alongside it.
 *
 * Eight weeks rather than "a few". Skin actives are the fastest thing in the
 * catalogue and the honest ones still say six to eight weeks before judging.
 * Composition and hair are slower again. A shorter bar produces the behaviour
 * this module exists to prevent.
 */
export const WEEKS_BEFORE_ADDING = 8;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface CheckIn {
  at: number;
  /** Did they say they were still running it? Null means they did not answer. */
  using: boolean | null;
  /**
   * Did THEY notice a difference? Only ever asked at or past the judge date —
   * asking somebody to evaluate a result before the result exists teaches them
   * that the answer does not matter.
   */
  noticing: boolean | null;
}

export type ProtocolStatus =
  /** Offered and not yet answered. */
  | "offered"
  /** They said no. Kept, so Max does not offer the same thing every scan. */
  | "declined"
  /** They said yes and named a date they would have it. */
  | "committed"
  /** They confirmed they had started. The clock to the judge date runs. */
  | "running"
  /** Past the judge date and assessed. */
  | "judged";

export interface Protocol {
  id: string;
  recId: string;
  /** What it is, in the words Max used. */
  title: string;
  channel: AdviceChannel;
  /** The metric this was picked to move, so a rescan can look at the right one. */
  metricId: string;
  /** Honest weeks-to-effect for this specific thing. */
  weeksToJudge: number;
  offeredAt: number;
  /** When they said they would have it in hand. */
  startBy: number | null;
  /** When they confirmed they had actually begun. The judge clock starts here. */
  startedAt: number | null;
  checkIns: CheckIn[];
  status: ProtocolStatus;
}

const KEY = () => scopedStorageKey("truemax:protocols");

export function readProtocols(): Protocol[] {
  const key = KEY();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Protocol[]).filter(isProtocol) : [];
  } catch {
    return [];
  }
}

export function writeProtocols(list: Protocol[]): void {
  const key = KEY();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-40)));
  } catch {
    /* storage full or disabled: the protocol is a convenience, not a record */
  }
}

function isProtocol(p: unknown): p is Protocol {
  const x = p as Protocol;
  return Boolean(x && typeof x.id === "string" && typeof x.recId === "string"
    && typeof x.weeksToJudge === "number");
}

/** Weeks elapsed since a protocol actually started. Null until it has. */
export function weeksRunning(p: Protocol, now: number): number | null {
  if (p.startedAt == null) return null;
  return Math.max(0, (now - p.startedAt) / WEEK_MS);
}

/**
 * Is it fair to judge this yet?
 *
 * The one function that stops rule 1 being forgotten. Everything that wants to
 * say a word about whether something worked has to come through here first.
 */
export function ripeForJudgement(p: Protocol, now: number): boolean {
  const weeks = weeksRunning(p, now);
  return weeks != null && weeks >= Math.max(MIN_WEEKS_TO_JUDGE, p.weeksToJudge);
}

// ---------------------------------------------------------------------------
// What Max should say next about a protocol, if anything.
//
// Returning null is a first-class answer and the most common one. A coach who
// has something to say every single time you open the app is not attentive, he
// is noise, and the whole point of the clock is knowing when to keep quiet.
// ---------------------------------------------------------------------------

export type ProtocolPrompt =
  /** They have not said yes or no yet. */
  | { kind: "decide"; protocol: Protocol; ask: string; yes: string; no: string }
  /** They said yes but never named a date. */
  | { kind: "when"; protocol: Protocol; ask: string }
  /** The date they named has passed and they never confirmed starting. */
  | { kind: "started"; protocol: Protocol; ask: string; yes: string; no: string }
  /** Mid-run. Adherence only — no verdict, no alternative. */
  | { kind: "adherence"; protocol: Protocol; ask: string; yes: string; no: string; weeks: number }
  /** At or past the judge date. Their read first, then the scan's. */
  | { kind: "judge"; protocol: Protocol; ask: string; yes: string; no: string; weeks: number };

/** At most one check-in per week, so a daily opener does not become nagging. */
const CHECKIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;

export function nextPrompt(p: Protocol, now: number): ProtocolPrompt | null {
  if (p.status === "declined" || p.status === "judged") return null;

  const thing = p.title.toLowerCase();
  if (p.status === "offered") {
    return {
      kind: "decide",
      protocol: p,
      ask: `Are you going to give ${thing} a go? No pressure either way, I just want to know whether to start the clock on it.`,
      yes: "Yeah, I'm getting it",
      no: "Not right now",
    };
  }

  if (p.status === "committed" && p.startBy == null) {
    return {
      kind: "when",
      protocol: p,
      ask: `When do you reckon you'll actually have it in your hands? Rough is fine. I only ask because ${thing} needs about ${p.weeksToJudge} weeks before anyone could honestly tell you whether it worked, and that clock starts the day you start, not today.`,
    };
  }

  if (p.status === "committed") {
    // The date they named has come round. Did they actually begin?
    if (p.startBy != null && now >= p.startBy) {
      return {
        kind: "started",
        protocol: p,
        ask: `You reckoned you'd have ${thing} by about now. Have you started on it?`,
        yes: "Started",
        no: "Not yet",
      };
    }
    return null; // Still waiting on the date they gave. Nothing to ask.
  }

  // Running. Adherence until the judge date, verdict after it, never before.
  const weeks = weeksRunning(p, now) ?? 0;
  const last = p.checkIns[p.checkIns.length - 1];
  if (last && now - last.at < CHECKIN_GAP_MS) return null;

  const w = Math.floor(weeks);
  if (!ripeForJudgement(p, now)) {
    return {
      kind: "adherence",
      protocol: p,
      ask: w < 1
        ? `First week on ${thing}. Are you actually keeping it up?`
        : `Week ${w} on ${thing}. Still running it?`,
      yes: "Still on it",
      no: "Fallen off",
      weeks: w,
    };
  }

  return {
    kind: "judge",
    protocol: p,
    ask: `That's ${w} weeks on ${thing}, which is long enough to actually call it. Forget the score for a second: are YOU seeing a difference?`,
    yes: "Yeah, I can see it",
    no: "Honestly, no",
    weeks: w,
  };
}

// ---------------------------------------------------------------------------
// The verdict, once a protocol is genuinely ripe.
// ---------------------------------------------------------------------------

export type Verdict =
  /** Ran it, gave it the time, and something moved. */
  | { kind: "worked"; protocol: Protocol; weeks: number }
  /** Ran it, gave it the time, nothing moved. ADD alongside, never replace. */
  | { kind: "addAlongside"; protocol: Protocol; weeks: number }
  /** Never really ran it. Not a failure of the protocol. */
  | { kind: "notRun"; protocol: Protocol; weeks: number }
  /** Not ripe. Say nothing about whether it worked. */
  | { kind: "tooEarly"; protocol: Protocol; weeksLeft: number };

/**
 * Judge a protocol, given whether the scan moved beyond capture noise.
 *
 * `scanMoved` is the caller's business and must already have been graded
 * against DISPLAY_NOISE — this function will not turn a 0.2 wobble into a
 * result, because it never sees the raw number.
 */
export function judge(p: Protocol, now: number, scanMoved: boolean): Verdict {
  const weeks = weeksRunning(p, now) ?? 0;
  const need = Math.max(MIN_WEEKS_TO_JUDGE, p.weeksToJudge);
  if (!ripeForJudgement(p, now)) {
    return { kind: "tooEarly", protocol: p, weeksLeft: Math.max(1, Math.ceil(need - weeks)) };
  }
  // Adherence beats everything. A protocol nobody ran has not been tested, and
  // calling it a failure would retire a perfectly good recommendation on no
  // evidence and send somebody off to buy a second thing they also will not use.
  const answered = p.checkIns.filter((c) => c.using != null);
  const kept = answered.filter((c) => c.using).length;
  if (answered.length >= 2 && kept / answered.length < 0.5) {
    return { kind: "notRun", protocol: p, weeks: Math.floor(weeks) };
  }
  if (scanMoved) return { kind: "worked", protocol: p, weeks: Math.floor(weeks) };
  return { kind: "addAlongside", protocol: p, weeks: Math.floor(weeks) };
}

/**
 * What Max says about a verdict.
 *
 * The addAlongside wording is the load-bearing part of this whole module. It
 * must never read as "that didn't work, try this instead": the first protocol
 * may well be holding something steady, and pulling it out to test a second
 * one destroys the only evidence there was. Keep it, stack the new thing on
 * top, change one variable at a time.
 */
export function verdictCopy(v: Verdict): string {
  const thing = v.protocol.title.toLowerCase();
  switch (v.kind) {
    case "tooEarly":
      return `Still early on ${thing}. Give it another ${v.weeksLeft} ${v.weeksLeft === 1 ? "week" : "weeks"} before either of us reads anything into the number. I'd rather say nothing than have you chopping and changing on noise.`;
    case "notRun":
      return `${v.weeks} weeks in on ${thing}, but by your own answers it hasn't really been running. That's not a failure of the protocol, it just hasn't been tested yet. No point swapping it for something else you'd also skip. Want to restart it properly, or would something easier to stick to suit you better?`;
    case "worked":
      return `${v.weeks} weeks on ${thing} and the scan agrees with you. That's a real result and it's yours. Keep it exactly as it is. We only change what isn't working.`;
    case "addAlongside":
      return `${v.weeks} weeks on ${thing}, you stuck with it, and the number hasn't moved. Here's what I'm NOT going to do: tell you to bin it. It might be holding something steady, and if we pull it out now we lose the only evidence we've got. Keep it running. What I'd do is add one thing alongside it, so we're only ever changing one variable at a time.`;
  }
}

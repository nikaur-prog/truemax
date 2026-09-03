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

/**
 * How a recommendation actually begins, which decides what question makes
 * sense after somebody says yes.
 *
 *   acquire  a product that has to arrive. "When will you have it in your
 *            hands" is a real question with a real answer, and the clock
 *            cannot start before the parcel does.
 *   book     an appointment. There is a date, but it is a booking rather
 *            than a delivery, so the question is when it will happen.
 *   commit   a diet or a habit. Nothing arrives and nothing is booked; the
 *            only honest question is whether they are going to start and
 *            stick with it. Asking when a diet will be "in your hands" was
 *            the sound of one flow being worn by three different things.
 *   instant  cosmetic and immediate, like a brow tint. It shows the day it
 *            is done, so there is no waiting clock and no delivery question.
 *            The only questions are "will you", "did you", and "can you see
 *            it".
 */
export type StartKind = "acquire" | "book" | "commit" | "instant";

const DAY_MS = 24 * 60 * 60 * 1000;

// These three recommendations were shipped before `start` existed. A stored
// entry from that build defaults to `acquire`, which turns an immediate salon
// or grooming job into a parcel and asks when it will be "in your hands". The
// catalogue now marks them correctly, but existing localStorage rows need the
// same correction or the bad conversation survives every deploy.
const INSTANT_RECOMMENDATIONS = new Set(["brow-tint", "brow-shape", "hair-colour"]);

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
  /** How it begins. Absent on entries stored before the field existed. */
  start?: StartKind;
  offeredAt: number;
  /** When they said they would have it in hand. */
  startBy: number | null;
  /** When they confirmed they had actually begun. The judge clock starts here. */
  startedAt: number | null;
  checkIns: CheckIn[];
  /**
   * Days (YYYY-MM-DD, local) the person tapped "Did it today" while the
   * protocol was running. The record the judge reads adherence from instead
   * of a memory, and the daily action the streak counts. Absent on rows
   * stored before the tick existed.
   */
  ticks?: string[];
  status: ProtocolStatus;
}

/**
 * Start tracking something Max recommended.
 *
 * The entry point to the whole ladder, and it deliberately creates the
 * protocol in "offered" rather than "running": recommending a thing and
 * somebody actually doing it are different events, and conflating them is how
 * an app ends up congratulating you for a routine you never started. Nothing
 * has a clock until they say yes and then say when.
 *
 * Idempotent per recommendation. Offering the same product on every scan until
 * somebody caves is the behaviour of an upsell, not a coach — so an existing
 * entry for this recId wins, including a declined one.
 */
export function offerProtocol(
  rec: {
    id: string;
    title: string;
    channel: AdviceChannel;
    weeksToJudge?: number;
    group?: "topical" | "food" | "habit" | "professional";
    start?: StartKind;
  },
  metricId: string,
  at: number = Date.now(),
): Protocol {
  const existing = readProtocols().find((p) => p.recId === rec.id);
  if (existing) return existing;
  const start = startKindFor(rec);
  const p: Protocol = {
    id: `${rec.id}-${at}`,
    recId: rec.id,
    title: rec.title,
    channel: rec.channel,
    metricId,
    // The floor protects rule 1, and rule 1 is about biology that needs time.
    // An instant cosmetic has no biology to wait on — flooring brow tinting to
    // four weeks made Max ask a month of questions about a thing that was
    // finished the day it happened.
    weeksToJudge:
      start === "instant"
        ? Math.max(1, rec.weeksToJudge ?? 1)
        : Math.max(MIN_WEEKS_TO_JUDGE, rec.weeksToJudge ?? MIN_WEEKS_TO_JUDGE),
    offeredAt: at,
    startBy: null,
    startedAt: null,
    checkIns: [],
    status: "offered",
    start,
  };
  writeProtocols([...readProtocols(), p]);
  return p;
}

/** The start kind, explicit or derived from what kind of thing this is. */
export function startKindFor(rec: {
  group?: "topical" | "food" | "habit" | "professional";
  start?: StartKind;
}): StartKind {
  if (rec.start) return rec.start;
  if (rec.group === "professional") return "book";
  if (rec.group === "food" || rec.group === "habit") return "commit";
  return "acquire";
}

/** How a stored protocol begins, defaulting entries that predate the field. */
export function startKindOf(p: Protocol): StartKind {
  return p.start ?? "acquire";
}

/**
 * The yes on a decision, with the right next question queued.
 *
 * A product still needs a delivery date, so acquire and book leave startBy
 * unset and the "when" question follows. A commitment can start at the next
 * meal and an instant job just needs doing, so both get a near date instead —
 * the next thing Max asks is "have you started", never "when will you have it
 * in your hands".
 */
export function commitProtocol(p: Protocol, at: number): Protocol {
  const kind = startKindOf(p);
  const soonDays = kind === "commit" ? 3 : kind === "instant" ? 7 : null;
  return {
    ...p,
    status: "committed",
    startBy: soonDays == null ? p.startBy : at + soonDays * DAY_MS,
  };
}

/** Has this recommendation already been offered, taken or turned down? */
export function protocolFor(recId: string): Protocol | null {
  return readProtocols().find((p) => p.recId === recId) ?? null;
}

const KEY = () => scopedStorageKey("truemax:protocols");

/** Repair rows written before recommendation start kinds were persisted. */
export function normaliseStoredProtocol(protocol: Protocol): Protocol {
  if (!INSTANT_RECOMMENDATIONS.has(protocol.recId)) return protocol;
  const startBy = protocol.status === "committed" && protocol.startBy == null
    ? protocol.offeredAt + 7 * DAY_MS
    : protocol.startBy;
  if (protocol.start === "instant" && protocol.weeksToJudge === 1 && startBy === protocol.startBy) {
    return protocol;
  }
  return { ...protocol, start: "instant", weeksToJudge: 1, startBy };
}

export function readProtocols(): Protocol[] {
  const key = KEY();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let changed = false;
    const list = (parsed as Protocol[]).filter(isProtocol).map((protocol) => {
      // A legacy yes had no date because the old flow was waiting to ask for
      // delivery. Give that commitment the same seven-day check-back a new
      // instant choice receives, so the next question names the service and
      // asks whether it happened instead of asking about an unnamed parcel.
      const normalised = normaliseStoredProtocol(protocol);
      if (normalised !== protocol) changed = true;
      return normalised;
    });
    if (changed) localStorage.setItem(key, JSON.stringify(list.slice(-40)));
    return list;
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

// ---------------------------------------------------------------------------
// The daily tick.
//
// One tap a day on a running protocol. Idempotent per day, so two devices
// or two taps make one record. Only a running protocol takes a tick: before
// they have started there is nothing to have done today, and after the
// judgement the record is closed.
// ---------------------------------------------------------------------------

const TICK_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function tickedOn(p: Protocol, day: string): boolean {
  return Boolean(p.ticks?.includes(day));
}

export function tickProtocol(p: Protocol, day: string): Protocol {
  if (p.status !== "running" || !TICK_DAY_RE.test(day) || tickedOn(p, day)) return p;
  const ticks = [...(p.ticks ?? []), day].sort();
  return { ...p, ticks: ticks.slice(-400) };
}

export interface Adherence {
  /** Calendar days the protocol has been running, today included. */
  days: number;
  ticked: number;
  /** ticked over days, capped at one. */
  fraction: number;
}

/**
 * Adherence read from the tick record. Null when there is no record to
 * read: the protocol has not started, or it was never ticked at all, which
 * is as likely to mean the button went unnoticed as the routine did, and
 * the judge falls back to the check-in answers in that case.
 */
export function adherenceFromTicks(p: Protocol, now: number): Adherence | null {
  if (p.startedAt == null || !p.ticks?.length) return null;
  const days = Math.max(1, Math.floor((now - p.startedAt) / DAY_MS) + 1);
  const ticked = p.ticks.length;
  return { days, ticked, fraction: Math.min(1, ticked / days) };
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
  // Instant things are ripe the moment they are done. The whole point of the
  // clock is not judging biology early; a brow tint has no biology to wait on
  // and the result is on the face the same day.
  if (startKindOf(p) === "instant") return p.startedAt != null;
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
  const kind = startKindOf(p);
  if (p.status === "offered") {
    // The decision question has to match what saying yes actually means.
    // "Are you getting it" is right for a parcel and nonsense for a diet —
    // nothing arrives; the only thing they can commit to is doing it.
    const ask =
      kind === "commit"
        ? `Are you going to start ${thing} and actually commit to it? No pressure either way, I just want to know whether to start the clock on it.`
        : kind === "instant"
          ? `Are you going to give ${thing} a go? It shows straight away, so there is no waiting clock on this one. I will just ask how it turned out.`
          : kind === "book"
            ? `Are you going to get ${thing} booked in? No pressure either way, I just want to know whether to follow it up.`
            : `Are you going to give ${thing} a go? No pressure either way, I just want to know whether to start the clock on it.`;
    return {
      kind: "decide",
      protocol: p,
      ask,
      yes:
        kind === "commit" ? "Yeah, I'm starting"
        : kind === "instant" ? "Yeah, I'll do it"
        : kind === "book" ? "Yeah, I'll book it"
        : "Yeah, I'm getting it",
      no: "Not right now",
    };
  }

  if (p.status === "committed" && p.startBy == null) {
    // Only things that wait on the world get the date question — a delivery or
    // an appointment. Commitments and instant jobs had a near date set the
    // moment they said yes, so this prompt never fires for them.
    return {
      kind: "when",
      protocol: p,
      ask:
        kind === "book"
          ? `When do you reckon you'll actually get it done? Rough is fine, I'll check back in after that.`
          : `When do you reckon you'll actually have it in your hands? Rough is fine. I only ask because ${thing} needs about ${p.weeksToJudge} weeks before anyone could honestly tell you whether it worked, and that clock starts the day you start, not today.`,
    };
  }

  if (p.status === "committed") {
    // The date they named has come round. Did they actually begin?
    if (p.startBy != null && now >= p.startBy) {
      const ask =
        kind === "commit"
          ? `You said you'd start ${thing}. Have you actually begun?`
          : kind === "instant" || kind === "book"
            ? `Have you had ${thing} done yet?`
            : `You reckoned you'd have ${thing} by about now. Have you started on it?`;
      return {
        kind: "started",
        protocol: p,
        ask,
        yes: kind === "instant" || kind === "book" ? "Done" : "Started",
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
    // An instant thing is judged the visit after it happened, not after a run
    // of weeks — asking "that's 0 weeks on brow tinting" would be the clock
    // talking about itself.
    ask:
      kind === "instant"
        ? `You've had ${thing} done. Forget the score for a second: can YOU see the difference?`
        : `That's ${w} ${w === 1 ? "week" : "weeks"} on ${thing}, which is long enough to actually call it. Forget the score for a second: are YOU seeing a difference?`,
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
  //
  // The tick record beats the check-in memory when there is one. A run of
  // ticks covering half the days or more says it ran, whatever a weekly
  // answer recalled; a record two weeks long with fewer than half the days
  // ticked says it did not. Without a record, the check-in answers decide
  // as before.
  const record = adherenceFromTicks(p, now);
  if (record && record.days >= 14 && record.fraction < 0.5) {
    return { kind: "notRun", protocol: p, weeks: Math.floor(weeks) };
  }
  if (!(record && record.fraction >= 0.5)) {
    const answered = p.checkIns.filter((c) => c.using != null);
    const kept = answered.filter((c) => c.using).length;
    if (answered.length >= 2 && kept / answered.length < 0.5) {
      return { kind: "notRun", protocol: p, weeks: Math.floor(weeks) };
    }
  }
  if (scanMoved) return { kind: "worked", protocol: p, weeks: Math.floor(weeks) };
  return { kind: "addAlongside", protocol: p, weeks: Math.floor(weeks) };
}

/**
 * What Max says about a verdict.
 *
 * The addAlongside wording is the load-bearing part of this module, and the
 * first version got it wrong in a way worth recording. It opened with "Here's
 * what I'm NOT going to do: tell you to bin it" and went on about losing "the
 * only evidence we've got" — a coach explaining his own reasoning at the
 * reader, in language nobody uses. Announcing what you are not about to say is
 * a tell; a person just says the thing.
 *
 * The rule underneath is unchanged and non-negotiable: keep what they are
 * doing, add alongside, never swap. It is simply said plainly now. Stay on it,
 * the change might not be visible yet, and here is one more thing worth adding.
 */
export function verdictCopy(v: Verdict): string {
  const thing = v.protocol.title.toLowerCase();
  // An instant thing was judged the visit after it happened, so "N weeks on"
  // framing would be counting a clock that never ran.
  const quick = v.kind !== "tooEarly" && startKindOf(v.protocol) === "instant";
  const weeks = v.kind === "tooEarly" ? 0 : v.weeks;
  const span = `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  switch (v.kind) {
    case "tooEarly":
      return `Still early on ${thing}. Give it another ${v.weeksLeft} ${v.weeksLeft === 1 ? "week" : "weeks"} before we read anything into the number. Changing things this soon just means neither of us finds out what worked.`;
    case "notRun":
      return `${span} in on ${thing}, but from your answers it hasn't really been running. So we don't know yet whether it works for you. Want to give it a proper go from here, or would something easier to stick to suit you better?`;
    case "worked":
      return quick
        ? `${thing} done and you can see it. That's a clean win, and the scan will pick it up next capture. Keep it maintained.`
        : `${span} on ${thing} and the scan agrees with you. That's a real result and it's yours. Keep doing exactly what you're doing.`;
    case "addAlongside":
      return quick
        ? `You've had ${thing} done and it isn't reading better to you yet. Give it one more look in decent light before you call it. If it still isn't landing, ask me and I'll pick the next thing for the same area alongside it.`
        : `${span} on ${thing} and you stuck with it, but the number hasn't moved yet. Stay on it. The change might just not be showing up in a scan yet, and stopping now means we never find out. What I'd recommend as well is adding one more thing alongside it. Ask me and I'll tell you which one I'd pick for you and why.`;
  }
}

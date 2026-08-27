import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_WEEKS_TO_JUDGE,
  WEEKS_BEFORE_ADDING,
  judge,
  nextPrompt,
  ripeForJudgement,
  verdictCopy,
  weeksRunning,
} from "./protocol.js";
import type { Protocol } from "./protocol.js";
import { RECS } from "./recommendations.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const T0 = 1_760_000_000_000; // fixed epoch; nothing here may depend on "now"

function running(overrides: Partial<Protocol> = {}): Protocol {
  return {
    id: "p1",
    recId: "salicylic",
    title: "the salicylic acid cleanser",
    channel: "grooming",
    metricId: "skinClarity",
    weeksToJudge: 8,
    offeredAt: T0,
    startBy: T0,
    startedAt: T0,
    checkIns: [],
    status: "running",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1: nothing is judged early.
//
// This is the rule the whole module exists for. The read used to offer to
// rebuild the plan whenever a number went flat, which on an eight-week acne
// routine could fire at day nine — the exact behaviour that makes a coach
// useless and stops anybody ever completing a protocol.
// ---------------------------------------------------------------------------

test("a protocol cannot be judged before its own time-to-effect", () => {
  const p = running({ weeksToJudge: 8 });
  for (const w of [0, 1, 2, 4, 7, 7.9]) {
    assert.equal(ripeForJudgement(p, T0 + w * WEEK), false, `judged at week ${w}`);
  }
  assert.equal(ripeForJudgement(p, T0 + 8 * WEEK), true);
});

test("nothing before the judge date asks whether it worked", () => {
  const p = running({ weeksToJudge: 8 });
  for (const w of [0, 1, 3, 6, 7.5]) {
    const prompt = nextPrompt(p, T0 + w * WEEK);
    assert.ok(prompt, `no prompt at week ${w}`);
    assert.equal(prompt.kind, "adherence", `week ${w} asked a verdict question`);
    // The wording must not invite a judgement either.
    assert.doesNotMatch(prompt.ask, /working|difference|results?\b/i);
  }
  assert.equal(nextPrompt(p, T0 + 8 * WEEK)?.kind, "judge");
});

test("judging early returns tooEarly and says how long is left, whatever the scan did", () => {
  const p = running({ weeksToJudge: 8 });
  for (const moved of [true, false]) {
    const v = judge(p, T0 + 2 * WEEK, moved);
    assert.equal(v.kind, "tooEarly");
    assert.equal(v.kind === "tooEarly" && v.weeksLeft, 6);
    assert.match(verdictCopy(v), /another 6 weeks/);
  }
});

test("the floor applies even to a recommendation that claims to be fast", () => {
  const p = running({ weeksToJudge: 1 });
  assert.equal(ripeForJudgement(p, T0 + 2 * WEEK), false);
  assert.equal(ripeForJudgement(p, T0 + MIN_WEEKS_TO_JUDGE * WEEK), true);
});

// ---------------------------------------------------------------------------
// Rule 2: you add, you do not swap.
// ---------------------------------------------------------------------------

test("a protocol that ran its full course and did nothing is ADDED to, never replaced", () => {
  const p = running({
    weeksToJudge: 8,
    checkIns: [
      { at: T0 + 1 * WEEK, using: true, noticing: null },
      { at: T0 + 4 * WEEK, using: true, noticing: null },
    ],
  });
  const v = judge(p, T0 + 9 * WEEK, false);
  assert.equal(v.kind, "addAlongside");
  const said = verdictCopy(v);
  // The RULE, not the phrasing. This used to pin "Keep it running" and "add one
  // thing alongside" as literals, so rewriting the copy into plainer speech
  // failed a test that was never about the words. What has to hold is that the
  // reader is told to continue, and that anything new is ADDED.
  assert.match(said, /stay on it|keep (going|doing|it|at it)/i, "does not tell them to continue");
  assert.match(said, /add(ing)? (one )?(more )?thing alongside|alongside it/i, "does not add alongside");
  // And must never tell them to drop what they are doing.
  assert.doesNotMatch(said, /\b(instead of|replace|swap|stop using|drop it|bin it)\b/i);
});

test("something that worked is left completely alone", () => {
  const p = running({ checkIns: [{ at: T0 + WEEK, using: true, noticing: null }] });
  const v = judge(p, T0 + 9 * WEEK, true);
  assert.equal(v.kind, "worked");
  assert.match(verdictCopy(v), /keep doing exactly what you're doing|keep it exactly as it is/i);
});

test("the add-on bar is eight weeks, not a few", () => {
  // The user-facing rule: six to eight weeks of flat before anything changes.
  // Pinned so a later edit cannot quietly shorten it back to "a few weeks".
  assert.ok(WEEKS_BEFORE_ADDING >= 8, `add-on bar is only ${WEEKS_BEFORE_ADDING} weeks`);
});

// ---------------------------------------------------------------------------
// Rule 3: adherence beats verdicts, and is asked in both directions.
// ---------------------------------------------------------------------------

test("a protocol nobody ran is not called a failure", () => {
  const p = running({
    checkIns: [
      { at: T0 + 1 * WEEK, using: false, noticing: null },
      { at: T0 + 3 * WEEK, using: false, noticing: null },
      { at: T0 + 5 * WEEK, using: true, noticing: null },
    ],
  });
  const v = judge(p, T0 + 9 * WEEK, false);
  assert.equal(v.kind, "notRun");
  const said = verdictCopy(v);
  assert.match(said, /hasn't really been running/i);
  // Crucially it must not send them shopping for a replacement.
  assert.doesNotMatch(said, /instead of|replace it with/i);
});

test("check-ins are weekly at most, so a daily opener does not nag", () => {
  const p = running({ checkIns: [{ at: T0 + 2 * WEEK, using: true, noticing: null }] });
  assert.equal(nextPrompt(p, T0 + 2 * WEEK + 60_000), null, "asked again the same day");
  assert.ok(nextPrompt(p, T0 + 3 * WEEK), "never asked again");
});

// ---------------------------------------------------------------------------
// The commitment ladder.
// ---------------------------------------------------------------------------

test("an offer asks for a decision, and a yes asks when rather than assuming today", () => {
  const offered = running({ status: "offered", startedAt: null, startBy: null });
  const decide = nextPrompt(offered, T0);
  assert.equal(decide?.kind, "decide");
  assert.ok(decide && "yes" in decide && decide.yes && decide.no, "no pre-set replies");

  const committed = running({ status: "committed", startedAt: null, startBy: null });
  const when = nextPrompt(committed, T0);
  assert.equal(when?.kind, "when");
  // The clock starting from the START and not from the offer is the whole point.
  assert.match(when!.ask, /starts the day you start/i);
});

test("nothing is asked while waiting on a date they gave that has not arrived", () => {
  const p = running({ status: "committed", startedAt: null, startBy: T0 + 5 * WEEK });
  assert.equal(nextPrompt(p, T0 + WEEK), null);
  assert.equal(nextPrompt(p, T0 + 5 * WEEK)?.kind, "started");
});

test("a declined protocol is remembered and never asked about again", () => {
  assert.equal(nextPrompt(running({ status: "declined" }), T0 + 99 * WEEK), null);
});

test("weeksRunning is null until it actually starts", () => {
  assert.equal(weeksRunning(running({ startedAt: null }), T0 + 9 * WEEK), null);
  assert.equal(Math.floor(weeksRunning(running(), T0 + 9 * WEEK)!), 9);
});

// ---------------------------------------------------------------------------
// The data behind the clock.
// ---------------------------------------------------------------------------

test("every recommendation declares how long before it can be judged", () => {
  for (const rec of RECS) {
    assert.equal(typeof rec.weeksToJudge, "number",
      `${rec.id} has no weeksToJudge, so the clock would fall back to the floor`);
    assert.ok(rec.weeksToJudge! >= 1, `${rec.id} claims to work in under a week`);
  }
});

test("the slow things are honestly slow", () => {
  // Minoxidil is the one that matters: the label says four to six MONTHS, and
  // the early shedding phase looks like it is making things worse. A short
  // number here would have Max questioning it right when somebody most needs
  // telling to hold their nerve.
  const byId = new Map(RECS.map((r) => [r.id, r]));
  assert.ok((byId.get("minoxidil")?.weeksToJudge ?? 0) >= 16, "minoxidil judged too soon");
  for (const id of ["adapalene", "azelaic", "resistance"]) {
    const rec = byId.get(id);
    if (rec) assert.ok(rec.weeksToJudge! >= 12, `${id} judged too soon`);
  }
});

// ---------------------------------------------------------------------------
// The answers, and what they do to the clock.
//
// applyAnswer lives in the UI module but is pure and exported precisely so it
// can be walked through the whole ladder here without a DOM. A wrong
// transition does not throw or look broken — it silently restarts somebody's
// eight-week clock, or starts one for a product they never bought.
// ---------------------------------------------------------------------------

test("saying yes to an offer does not start the clock", async () => {
  const { applyAnswer } = await import("../ui/protocolCard.js");
  const offered = running({ status: "offered", startedAt: null, startBy: null });
  const prompt = nextPrompt(offered, T0)!;
  const after = applyAnswer(offered, prompt, true, T0);
  assert.equal(after.status, "committed");
  // The whole point: agreeing to buy a thing is not the same as using it.
  assert.equal(after.startedAt, null, "clock started on a yes");
  assert.equal(weeksRunning(after, T0 + 9 * WEEK), null);
});

test("confirming you started is what starts the clock, from that day", async () => {
  const { applyAnswer } = await import("../ui/protocolCard.js");
  const waiting = running({ status: "committed", startedAt: null, startBy: T0 });
  const prompt = nextPrompt(waiting, T0 + 2 * WEEK)!;
  assert.equal(prompt.kind, "started");
  const after = applyAnswer(waiting, prompt, true, T0 + 2 * WEEK);
  assert.equal(after.status, "running");
  // Two weeks passed between the offer and the start, and none of them count.
  assert.equal(Math.floor(weeksRunning(after, T0 + 5 * WEEK)!), 3);
});

test("not having started yet pushes the date out rather than nagging tomorrow", async () => {
  const { applyAnswer } = await import("../ui/protocolCard.js");
  const waiting = running({ status: "committed", startedAt: null, startBy: T0 });
  const after = applyAnswer(waiting, nextPrompt(waiting, T0)!, false, T0);
  assert.equal(after.status, "committed", "status changed on a not-yet");
  assert.equal(after.startedAt, null);
  assert.ok(after.startBy! > T0, "did not push the date out");
  assert.equal(nextPrompt(after, T0 + 24 * 60 * 60 * 1000), null, "asked again the next day");
});

test("falling off is recorded without ending the protocol", async () => {
  const { applyAnswer } = await import("../ui/protocolCard.js");
  const p = running();
  const after = applyAnswer(p, nextPrompt(p, T0 + 2 * WEEK)!, false, T0 + 2 * WEEK);
  assert.equal(after.status, "running", "a missed week ended the protocol");
  assert.equal(after.checkIns[after.checkIns.length - 1]?.using, false);
  // And the clock is untouched, so picking it back up carries on where it was.
  assert.equal(after.startedAt, p.startedAt);
});

test("the judge answer closes the protocol and records what they saw", async () => {
  const { applyAnswer } = await import("../ui/protocolCard.js");
  const p = running();
  const prompt = nextPrompt(p, T0 + 9 * WEEK)!;
  assert.equal(prompt.kind, "judge");
  const after = applyAnswer(p, prompt, true, T0 + 9 * WEEK);
  assert.equal(after.status, "judged");
  assert.equal(after.checkIns[after.checkIns.length - 1]?.noticing, true);
  assert.equal(nextPrompt(after, T0 + 20 * WEEK), null, "kept asking after the verdict");
});

test("a start date is set from today, not from when it was offered", async () => {
  const { answerWhen } = await import("../ui/protocolCard.js");
  const p = running({ status: "committed", startedAt: null, startBy: null, offeredAt: T0 });
  const after = answerWhen(p, 5, T0 + 3 * WEEK);
  assert.ok(after.startBy! > T0 + 3 * WEEK, "date anchored to the offer rather than to now");
});

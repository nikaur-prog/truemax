import assert from "node:assert/strict";
import test from "node:test";
import { adherenceFromTicks, judge, tickProtocol, tickedOn } from "./protocol.js";
import type { Protocol } from "./protocol.js";

const DAY = 86400000;
const started = Date.parse("2026-07-01T09:00:00Z");

function running(overrides: Partial<Protocol> = {}): Protocol {
  return {
    id: "retinoid-1",
    recId: "retinoid",
    title: "Retinoid at night",
    channel: "skin" as Protocol["channel"],
    metricId: "skinEvenness",
    weeksToJudge: 8,
    offeredAt: started - DAY,
    startBy: null,
    startedAt: started,
    checkIns: [],
    status: "running",
    ...overrides,
  };
}

function days(from: string, n: number): string[] {
  const t0 = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * DAY).toISOString().slice(0, 10));
}

test("a tick is one per day, sorted, and only on a running protocol", () => {
  let p = running();
  p = tickProtocol(p, "2026-07-02");
  p = tickProtocol(p, "2026-07-01");
  p = tickProtocol(p, "2026-07-02");
  assert.deepEqual(p.ticks, ["2026-07-01", "2026-07-02"]);
  assert.equal(tickedOn(p, "2026-07-02"), true);
  assert.equal(tickedOn(p, "2026-07-03"), false);
  const offered = running({ status: "offered", startedAt: null });
  assert.equal(tickProtocol(offered, "2026-07-01").ticks, undefined);
  assert.equal(tickProtocol(p, "bad day").ticks?.length, 2);
});

test("adherence is ticks over days running, null without a record", () => {
  const now = started + 9 * DAY;
  assert.equal(adherenceFromTicks(running(), now), null);
  const p = running({ ticks: days("2026-07-01", 5) });
  const a = adherenceFromTicks(p, now);
  assert.equal(a?.days, 10);
  assert.equal(a?.ticked, 5);
  assert.equal(a?.fraction, 0.5);
});

test("the judge reads the record first: a sparse two-week record is not run, a dense one ran whatever the check-ins said", () => {
  const now = started + 9 * 7 * DAY;
  const sparse = running({ ticks: days("2026-07-01", 10) });
  assert.equal(judge(sparse, now, true).kind, "notRun");
  const dense = running({
    ticks: days("2026-07-01", 50),
    checkIns: [
      { at: started + 7 * DAY, using: false, noticing: null },
      { at: started + 14 * DAY, using: false, noticing: null },
    ],
  });
  assert.equal(judge(dense, now, true).kind, "worked");
  const noRecord = running({
    checkIns: [
      { at: started + 7 * DAY, using: false, noticing: null },
      { at: started + 14 * DAY, using: false, noticing: null },
    ],
  });
  assert.equal(judge(noRecord, now, true).kind, "notRun", "without a record the check-ins still decide");
});

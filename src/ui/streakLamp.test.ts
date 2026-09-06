import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EMPTY_STREAK, readStreak } from "../engine/dailyStreak.js";
import type { StreakState } from "../engine/dailyStreak.js";
import { lampMarkup } from "./streakLamp.js";
import { tickRowMarkup } from "./protocolCard.js";
import type { Protocol } from "../engine/protocol.js";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const state = (overrides: Partial<StreakState>): StreakState => ({ ...EMPTY_STREAK, ...overrides });

test("the lamp shows the day count and the tier only as a glow class, never as words", () => {
  const html = lampMarkup(readStreak(state({ current: 12, best: 12, lastCountedDay: "2026-09-05" }), "2026-09-05"), { consistency: 30, progress: 0 });
  assert.match(html, /glow-steady/);
  assert.match(html, /12 days/);
  assert.match(html, /30 pts/);
  assert.match(html, /Today is counted\./);
  assert.doesNotMatch(html, /steady|faint|bright|bloom|full/i.source ? /1\.1x|multiplier|tier/i : /$^/);
});

test("a run that has ended shows what was kept, and no loss words anywhere", () => {
  const html = lampMarkup(readStreak(state({ current: 41, best: 41, lastCountedDay: "2026-08-01" }), "2026-09-05"), { consistency: 90, progress: 100 });
  assert.match(html, /glow-off/);
  assert.match(html, /Best: 41 days/);
  assert.match(html, /190 pts/);
  assert.match(html, /Nothing counted yet today\. Tick a routine, or scan\./);
  assert.doesNotMatch(html, /\blose\b|\blost\b|\bbroke|\bbreak\b|don't miss|\bflame|\bfire\b/i);
});

test("switched off in Settings, the lamp renders nothing at all", () => {
  const html = lampMarkup(readStreak(state({ current: 5, best: 5, lastCountedDay: "2026-09-05", enabled: false }), "2026-09-05"), { consistency: 10, progress: 0 });
  assert.equal(html, "");
});

test("a person who has never counted a day sees the unlit lamp and the line naming what would count", () => {
  const html = lampMarkup(readStreak(EMPTY_STREAK, "2026-09-05"), { consistency: 0, progress: 0 });
  assert.match(html, /glow-off/);
  assert.doesNotMatch(html, /0 days/);
  assert.doesNotMatch(html, /pts/);
  assert.match(html, /Nothing counted yet today/);
});

test("the tick row lists running protocols only, and a ticked one stays visible as done", () => {
  const base: Protocol = {
    id: "retinoid-1", recId: "retinoid", title: "Retinoid at night",
    channel: "skin" as Protocol["channel"], metricId: "skinEvenness", weeksToJudge: 8,
    offeredAt: 0, startBy: null, startedAt: 1, checkIns: [], status: "running",
  };
  const html = tickRowMarkup([
    base,
    { ...base, id: "jaw-1", recId: "jaw", title: "Chewing routine", ticks: ["2026-09-05"] },
    { ...base, id: "offered-1", recId: "x", status: "offered", startedAt: null },
  ], "2026-09-05");
  assert.match(html, /Did it today · Retinoid at night/);
  assert.match(html, /Done today · Chewing routine/);
  assert.match(html, /data-tick="jaw-1"[^>]*disabled|disabled[^>]*data-tick="jaw-1"/);
  assert.doesNotMatch(html, /offered-1/);
  assert.equal(tickRowMarkup([{ ...base, status: "judged" }], "2026-09-05"), "");
});

test("the wiring pins: own scans count, guests never, reopens never; check-ins count; the dashboard mounts the lamp", () => {
  const main = read("src/main.ts");
  assert.match(main, /if \(!existingScan && !scanSubject\) recordStreakAction\("scan"\)/);
  const card = read("src/ui/protocolCard.ts");
  assert.match(card, /if \(prompt\.kind === "adherence" \|\| prompt\.kind === "judge"\) recordStreakAction\("checkin"\)/);
  assert.match(card, /recordStreakAction\("routine"\)/);
  const dash = read("src/ui/dashboard.ts");
  assert.match(dash, /mountStreakLamp\(overlay\.querySelector<HTMLElement>\("\[data-daily-streak\]"\)\)/);
  const maxTab = read("src/ui/maxTab.ts");
  assert.match(maxTab, /mountDailyTicks\(root\.querySelector<HTMLElement>\("\[data-performance-ticks\]"\)\)/);
  const settings = read("src/ui/settings.ts");
  assert.match(settings, /updateStreakEnabled\(!streakEnabled, user\.id\)/);
});

test("no loss framing in the new surfaces, and no em dashes in the lamp module", () => {
  // settings.ts has em dashes in pre-existing code comments; the copy rule is
  // enforced by scripts/emdash.mjs, which reads rendered strings, not comments.
  for (const path of ["src/ui/streakLamp.ts", "src/ui/settings.ts"]) {
    assert.doesNotMatch(read(path), /\blose\b|\blost\b|\bbroke\b|don't miss|\bflame|\bstreak is dead/i, path);
  }
  assert.doesNotMatch(read("src/ui/streakLamp.ts"), /—/);
});

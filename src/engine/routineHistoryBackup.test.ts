import assert from "node:assert/strict";
import test from "node:test";
import { activateScanOwner, scopedStorageKey } from "./scanScope.js";
import { readProtocols, writeProtocols, tickProtocol } from "./protocol.js";
import type { Protocol } from "./protocol.js";
import { exportRoutineHistory, importRoutineHistory, previewRoutineHistoryImport, mergeRoutineHistory } from "./routineHistoryBackup.js";
import { routineSyncStatus } from "./routineSyncQueue.js";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const DAY = 86_400_000;
const make = (overrides: Partial<Protocol> = {}): Protocol => ({ id: "sleep-1700000000000", recId: "sleep", title: "Sleep timing",
  channel: "lifestyle", metricId: "", weeksToJudge: 4, start: "commit", offeredAt: 1700000000000,
  startedAt: 1700000000000, startBy: null, status: "running", ticks: ["2026-08-01", "2026-09-09"],
  checkIns: [{ at: NOW - DAY, using: null, noticing: false }], ...overrides });

function storage() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  let fails = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fails) throw new Error("quota"); values.set(key, value); },
    removeItem: (key: string) => values.delete(key),
  } });
  return { values, fail: () => { fails = true; }, close: () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
    activateScanOwner(null);
  } };
}

test("private backup preserves all retained ticks/check-ins and incomplete coverage; preview does not write", () => {
  const s = storage();
  try {
    const owner = activateScanOwner("owner-a");
    const original = make({ historyPartial: true, ticks: Array.from({ length: 420 }, (_, i) => new Date(NOW - (i + 1) * DAY).toISOString().slice(0, 10)).sort(),
      checkIns: Array.from({ length: 12 }, (_, i) => ({ at: NOW - (i + 1) * DAY, using: i % 2 ? null : true, noticing: false })).sort((a, b) => a.at - b.at) });
    writeProtocols([original]);
    s.values.set(scopedStorageKey("truemax:profile")!, JSON.stringify({ secret: "not-in-routine-backup" }));
    const json = exportRoutineHistory(owner, NOW);
    assert.doesNotMatch(json, /not-in-routine-backup|photo|messages|measurements/);
    s.values.delete(scopedStorageKey("truemax:protocols")!);
    const before = JSON.stringify([...s.values]);
    assert.deepEqual(previewRoutineHistoryImport(json, owner, NOW), { routines: 1, ticks: 420, checkIns: 12, partialHistories: 1, newRoutines: 1 });
    assert.equal(JSON.stringify([...s.values]), before);
    importRoutineHistory(json, owner, NOW);
    assert.deepEqual(readProtocols(), [original]);
    assert.equal(routineSyncStatus(), "pending");
    const once = JSON.stringify(readProtocols());
    importRoutineHistory(json, owner, NOW);
    assert.equal(JSON.stringify(readProtocols()), once, "re-import is idempotent");
    assert.equal(tickProtocol(readProtocols()[0], "2026-09-10").ticks?.length, 421, "the next tick must not drop imported older history");
  } finally { s.close(); }
});

test("terminal states and stable local identity win stale duplicate imports; conflicting answers stay unknown", () => {
  const local = make({ status: "declined", historyPartial: true, startBy: NOW + DAY });
  const other = make({ id: "sleep-1700000005000", status: "running", startBy: NOW,
    ticks: ["2026-09-10"], checkIns: [{ at: NOW - DAY, using: true, noticing: true }] });
  const [merged] = mergeRoutineHistory([local], [other], NOW);
  assert.equal(merged.id, local.id);
  assert.equal(merged.status, "declined");
  assert.equal(merged.startBy, NOW + DAY);
  assert.equal(merged.historyPartial, true);
  assert.deepEqual(merged.checkIns, [{ at: NOW - DAY, using: null, noticing: null }]);
  assert.deepEqual(merged.ticks, ["2026-08-01", "2026-09-09", "2026-09-10"]);
  const [committed] = mergeRoutineHistory([], [make({ status: "committed", startedAt: null, ticks: [] })], NOW);
  assert.equal(committed.status, "committed");
  assert.equal(committed.startedAt, null, "import does not infer a start");
});

test("wrong account, malformed input and over-budget records fail without changing local history", () => {
  const s = storage();
  try {
    const owner = activateScanOwner("owner-a");
    writeProtocols([make()]);
    const json = exportRoutineHistory(owner, NOW);
    const value = JSON.parse(json);
    const before = JSON.stringify([...s.values]);
    const variants = ["not json", JSON.stringify({ ...value, owner: "user:b" }), JSON.stringify({ ...value, version: 2 }),
      JSON.stringify({ ...value, protocols: [{ ...value.protocols[0], ticks: ["2026-02-30"] }] }),
      JSON.stringify({ ...value, protocols: [{ ...value.protocols[0], startedAt: NOW + 30 * DAY }] }),
      JSON.stringify({ ...value, protocols: [{ ...value.protocols[0], checkIns: Array.from({ length: 2001 }, () => ({ at: NOW, using: true, noticing: null })) }] }),
      JSON.stringify({ ...value, protocols: Array.from({ length: 41 }, () => value.protocols[0]) }), " ".repeat(2_000_001)];
    for (const invalid of variants) assert.throws(() => importRoutineHistory(invalid, owner, NOW));
    assert.equal(JSON.stringify([...s.values]), before);
    activateScanOwner("other-owner");
    assert.throws(() => importRoutineHistory(json, owner, NOW), /Sign in/);
    assert.deepEqual(readProtocols(), []);
  } finally { s.close(); }
});

test("storage failure never reports an import as saved", () => {
  const s = storage();
  try {
    const owner = activateScanOwner("owner-a");
    writeProtocols([make()]);
    const json = exportRoutineHistory(owner, NOW);
    s.values.delete(scopedStorageKey("truemax:protocols")!);
    s.fail();
    assert.throws(() => importRoutineHistory(json, owner, NOW), /could not be saved/);
    assert.deepEqual(readProtocols(), []);
  } finally { s.close(); }
});

test("download and import preview do not repair legacy records in device storage", () => {
  const s = storage();
  try {
    const owner = activateScanOwner("owner-a");
    const key = scopedStorageKey("truemax:protocols")!;
    const legacy = make({ id: "brow-shape-1700000000000", recId: "brow-shape", channel: "grooming", start: undefined,
      status: "committed", startedAt: null, startBy: null, weeksToJudge: 4 });
    s.values.set(key, JSON.stringify([legacy]));
    const before = JSON.stringify([...s.values]);
    const json = exportRoutineHistory(owner, NOW);
    previewRoutineHistoryImport(json, owner, NOW);
    assert.equal(JSON.stringify([...s.values]), before);
    assert.equal(JSON.parse(json).protocols[0].start, "instant", "legacy repair is confined to the exported representation");
  } finally { s.close(); }
});

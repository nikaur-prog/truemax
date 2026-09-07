import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type * as Results from "./results.js";
import { createLazyResults } from "./lazyResults.js";
import { createSkinTrialAccess } from "./skinTrialAccess.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const calls: string[] = [];
  const gate = createSkinTrialAccess(() => true);
  const reset = () => ({ adult: false, birthDate: null as string | null, max: false,
    pathway: "build" as Results.PathwayState, depth: "rating" as Parameters<typeof Results.setDepth>[0], remaining: 0 });
  let state = reset();
  let ceiling: ReturnType<typeof Results.currentCeiling> = null;
  const rendered: unknown[] = [];
  const api = {
    clearResultsIdentityState() { calls.push("clear"); state = reset(); ceiling = null; gate.reset(); },
    setAdult(value: boolean) { calls.push("adult"); state.adult = value; },
    setBirthDate(value: string | null) { calls.push("birthDate"); state.birthDate = value; },
    setMaxAccess(value: boolean) { calls.push("max"); state.max = value; },
    setPathwayState(value: Results.PathwayState) { calls.push("pathway"); state.pathway = value; },
    setDepth(value: Parameters<typeof Results.setDepth>[0], remaining = 0) { calls.push("depth"); state.depth = value; state.remaining = remaining; },
    beginSkinTrialStaffCheck() {
      calls.push("staff");
      const resolve = gate.begin();
      return (value: boolean) => { calls.push(`staff:${value}`); resolve(value); };
    },
    renderResults(value: unknown) { calls.push("render"); rendered.push(value); },
    clearResultPhotoRecovery() { calls.push("photo-clear"); },
    currentCeiling() { return ceiling; },
  } as unknown as typeof Results;
  return { api, calls, gate, rendered, state: () => ({ ...state }),
    showCeiling() { ceiling = { overall: 5, potential: 6, photo: null }; },
  };
}
const context = () => ({}) as Parameters<typeof Results.renderResults>[0];

test("permissions, staff reads and cleanup do not load the report, then latest state replays once", async () => {
  const module = fixture();
  let loads = 0;
  const report = createLazyResults(async () => { loads++; return module.api; });
  report.setAdult(true);
  report.setBirthDate("1990-01-01");
  report.setMaxAccess(true);
  report.setPathwayState("plan");
  report.setDepth("plan", 2);
  report.beginSkinTrialStaffCheck()(true);
  report.clearResultPhotoRecovery();
  assert.equal(report.currentCeiling(), null);
  assert.equal(loads, 0);
  assert.deepEqual(module.calls, []);
  await report.ready();
  assert.equal(loads, 1);
  assert.deepEqual(module.state(), { adult: true, birthDate: "1990-01-01", max: true, pathway: "plan", depth: "plan", remaining: 2 });
  assert.deepEqual(module.calls, ["clear", "adult", "birthDate", "max", "pathway", "depth", "staff", "staff:true"]);
  assert.equal(module.gate.enabled(), true);
  assert.equal(module.rendered.length, 0, "preparing code does not open or paint a report");
  const count = module.calls.length;
  await report.ready();
  assert.equal(module.calls.length, count);
  assert.equal(loads, 1);
});

test("concurrent report loads share a promise and a failed chunk retries with current state", async () => {
  const first = deferred<typeof Results>(), retry = deferred<typeof Results>();
  const module = fixture();
  let loads = 0;
  const report = createLazyResults(() => ++loads === 1 ? first.promise : retry.promise);
  const a = report.ready(), b = report.ready();
  assert.equal(a, b);
  assert.equal(loads, 1);
  const rejected = Promise.allSettled([a, b]);
  first.reject(new Error("offline"));
  assert.deepEqual((await rejected).map((result) => result.status), ["rejected", "rejected"]);
  assert.throws(() => report.renderResults(context()), /Prepare the report/);
  report.setDepth("depth", 1);
  const next = report.ready();
  assert.notEqual(next, a);
  retry.resolve(module.api);
  await next;
  assert.equal(loads, 2);
  assert.equal(module.state().depth, "depth");
  assert.equal(module.state().remaining, 1);
});

test("an identity clear while the report chunk loads replays locked defaults, not old privileges", async () => {
  const pending = deferred<typeof Results>();
  const module = fixture();
  const report = createLazyResults(() => pending.promise);
  report.setAdult(true); report.setBirthDate("1990-01-01"); report.setMaxAccess(true);
  report.setDepth("plan", 5); report.setPathwayState("plan");
  const staleStaff = report.beginSkinTrialStaffCheck();
  staleStaff(true);
  const ready = report.ready();
  report.clearResultsIdentityState();
  staleStaff(true);
  pending.resolve(module.api);
  await ready;
  staleStaff(true);
  assert.deepEqual(module.state(), { adult: false, birthDate: null, max: false, pathway: "build", depth: "rating", remaining: 0 });
  assert.equal(module.gate.enabled(), false);
  assert.equal(module.calls.includes("staff:true"), false);
});

test("the new account's permissions win during loading and old staff callbacks cannot grant access", async () => {
  const pending = deferred<typeof Results>();
  const module = fixture();
  const report = createLazyResults(() => pending.promise);
  const oldStaff = report.beginSkinTrialStaffCheck();
  const ready = report.ready();
  report.clearResultsIdentityState();
  report.setAdult(false); report.setBirthDate("2013-01-01");
  report.setDepth("depth", 1);
  const newStaff = report.beginSkinTrialStaffCheck();
  newStaff(false); oldStaff(true);
  pending.resolve(module.api);
  await ready;
  oldStaff(true);
  assert.equal(module.state().birthDate, "2013-01-01");
  assert.equal(module.state().depth, "depth");
  assert.equal(module.state().adult, false);
  assert.equal(module.gate.enabled(), false);
  assert.deepEqual(module.calls.filter((call) => call.startsWith("staff:")), ["staff:false"]);
});

test("current staff permission can arrive after code load, but refresh and sign-out close immediately", async () => {
  const module = fixture();
  const report = createLazyResults(async () => module.api);
  const beforeLoad = report.beginSkinTrialStaffCheck();
  await report.ready();
  assert.equal(module.gate.enabled(), false);
  beforeLoad(true);
  assert.equal(module.gate.enabled(), true);
  const current = report.beginSkinTrialStaffCheck();
  assert.equal(module.gate.enabled(), false);
  beforeLoad(true);
  assert.equal(module.gate.enabled(), false);
  current(true);
  assert.equal(module.gate.enabled(), true);
  report.clearResultsIdentityState();
  assert.equal(module.gate.enabled(), false);
  current(true);
  assert.equal(module.gate.enabled(), false);
});

test("render requires readiness; loaded setters, cleanup and ceiling remain synchronous", async () => {
  const pending = deferred<typeof Results>();
  const module = fixture();
  const report = createLazyResults(() => pending.promise);
  const value = context();
  assert.throws(() => report.renderResults(value), /Prepare the report/);
  const ready = report.ready();
  assert.throws(() => report.renderResults(value), /Prepare the report/);
  pending.resolve(module.api);
  await ready;
  assert.equal(module.rendered.length, 0, "rejected early renders were never queued");
  report.setAdult(true); report.setBirthDate("1995-03-04"); report.setMaxAccess(true);
  report.setPathwayState("plan"); report.setDepth("plan");
  report.renderResults(value);
  assert.equal(module.rendered[0], value);
  assert.equal(module.state().remaining, 0);
  assert.equal(module.state().adult, true);
  module.showCeiling();
  assert.equal(report.currentCeiling()?.overall, 5);
  report.clearResultPhotoRecovery();
  assert.equal(module.calls[module.calls.length - 1], "photo-clear");
  report.clearResultsIdentityState();
  assert.equal(report.currentCeiling(), null);
  assert.equal(module.state().max, false);
});

test("main keeps lazy report preparation before persistence and checks identity after asynchronous loads", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  assert.match(main, /from "\.\/ui\/lazyResults\.js"/);
  assert.match(main, /from "\.\/ui\/lazyDashboard\.js"/);
  assert.doesNotMatch(main, /from "\.\/ui\/(?:results|dashboard)\.js"/);
  const full = main.slice(main.indexOf("async function runFullAnalysis("));
  const ready = full.indexOf("await prepareResults()");
  assert.ok(ready >= 0);
  assert.ok(ready < full.indexOf("compareAndStore("));
  assert.match(full.slice(ready, full.indexOf("const front = analyzeFrames")), /if \(!scanIsCurrent\(token, generation\) \|\| !pending\) return/);
  assert.match(full, /data-retry-report[\s\S]*runFullAnalysis\(sideReport, token\)/);
  const failure = full.slice(ready, full.indexOf("const front = analyzeFrames"));
  assert.ok(failure.indexOf('classList.remove("scanning", "settling")') < failure.indexOf('el.analysis.innerHTML'), "the recovery action must not be hidden by the scanning layout");
  assert.match(failure, /if \(retry\.disabled \|\| !scanIsCurrent\(token, generation\)\) return;[\s\S]*retry\.disabled = true;[\s\S]*retry\.onclick = null;[\s\S]*void runFullAnalysis/, "double clicks must not start parallel analysis retries");
  const archive = main.slice(main.indexOf("async function reopenArchivedScan("), main.indexOf("async function runFullAnalysis("));
  assert.match(archive, /await prepareResults\(\)[\s\S]*?if \(owner !== activeScanOwner\(\) \|\| generation !== scanGeneration\) return;[\s\S]*?renderResults\(/);
});

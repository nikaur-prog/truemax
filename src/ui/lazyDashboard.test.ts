import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type * as Dashboard from "./dashboard.js";
import { createLazyDashboard } from "./lazyDashboard.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let closes = 0;
  const opened: Array<Parameters<typeof Dashboard.openDashboard>[0]> = [];
  const api = { close() { closes++; }, openDashboard(options: Parameters<typeof Dashboard.openDashboard>[0]) { opened.push(options); } } as typeof Dashboard;
  return { api, opened, closes: () => closes };
}
const options = (name: string): Parameters<typeof Dashboard.openDashboard>[0] => ({ name, onScan() {}, membership: "member", adult: false });

test("dashboard close is inert before load and open requires explicit readiness", async () => {
  const pending = deferred<typeof Dashboard>(), module = fixture();
  let loads = 0;
  const dashboard = createLazyDashboard(() => { loads++; return pending.promise; });
  dashboard.close();
  assert.equal(loads, 0);
  assert.throws(() => dashboard.openDashboard(options("Old account")), /Prepare the dashboard/);
  const ready = dashboard.ready();
  assert.throws(() => dashboard.openDashboard(options("Old account")), /Prepare the dashboard/);
  dashboard.close();
  pending.resolve(module.api);
  await ready;
  assert.deepEqual(module.opened, [], "loading does not replay an early or cancelled open");
  assert.equal(module.closes(), 0);
  const latest = options("Current account");
  dashboard.openDashboard(latest);
  assert.equal(module.opened[0], latest);
  dashboard.close();
  assert.equal(module.closes(), 1);
});

test("dashboard preparation shares the pending load, retries rejection and reuses the loaded module", async () => {
  const first = deferred<typeof Dashboard>(), second = deferred<typeof Dashboard>(), module = fixture();
  let loads = 0;
  const dashboard = createLazyDashboard(() => ++loads === 1 ? first.promise : second.promise);
  const a = dashboard.ready(), b = dashboard.ready();
  assert.equal(a, b);
  assert.equal(loads, 1);
  const failures = Promise.allSettled([a, b]);
  first.reject(new Error("offline"));
  assert.deepEqual((await failures).map((result) => result.status), ["rejected", "rejected"]);
  const ready = dashboard.ready();
  second.resolve(module.api);
  await ready;
  await dashboard.ready();
  assert.equal(loads, 2);
  assert.equal(module.opened.length, 0);
});

test("main checks dashboard owner and generation after preparing the lazy chunk", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const from = main.indexOf("const dashboardGeneration = scanGeneration");
  const to = main.indexOf("openDashboard({", from);
  assert.ok(from >= 0 && to > from);
  const block = main.slice(from, to);
  const ready = block.indexOf("await prepareDashboard()");
  assert.ok(ready >= 0);
  assert.match(block.slice(ready), /if \(dashboardGeneration !== scanGeneration \|\| activeScanOwner\(\) !== `user:\$\{user\.id\}`\) return;/);
});

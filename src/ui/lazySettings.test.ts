import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import { createLazySettingsBoundary } from "./lazySettings.js";

const user = { id: "first-user" } as User;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function settingsModule() {
  const opened: string[] = [];
  let closed = 0;
  return {
    opened,
    get closed() { return closed; },
    async openSettings(account: User) { opened.push(account.id); },
    closeSettings() { closed++; },
  };
}

test("closing unused Settings does not import it", () => {
  let imports = 0;
  const boundary = createLazySettingsBoundary(async () => { imports++; return settingsModule(); });
  boundary.close();
  boundary.close();
  assert.equal(imports, 0);
});

test("concurrent Settings clicks share one import and only the latest opens", async () => {
  const module = settingsModule();
  const download = deferred<typeof module>();
  let imports = 0;
  const boundary = createLazySettingsBoundary(() => { imports++; return download.promise; });
  const first = boundary.open(user, () => true);
  const second = boundary.open(user, () => true);
  download.resolve(module);
  assert.deepEqual(await Promise.all([first, second]), ["stale", "opened"]);
  assert.equal(imports, 1);
  assert.deepEqual(module.opened, [user.id]);
  assert.equal(await boundary.open(user, () => true), "opened");
  assert.equal(imports, 1);
});

test("logout during download invalidates the open but preserves the lazy cache", async () => {
  const module = settingsModule();
  const download = deferred<typeof module>();
  const boundary = createLazySettingsBoundary(() => download.promise);
  const result = boundary.open(user, () => true);
  boundary.close();
  download.resolve(module);
  assert.equal(await result, "stale");
  assert.deepEqual(module.opened, []);
  assert.equal(module.closed, 0);
  const nextUser = { id: "next-user" } as User;
  assert.equal(await boundary.open(nextUser, () => true), "opened");
  assert.deepEqual(module.opened, [nextUser.id]);
  boundary.close();
  assert.equal(module.closed, 1);
});

test("changed account or scan generation cannot open Settings after download", async () => {
  for (const changed of ["owner", "scan"] as const) {
    const module = settingsModule();
    const download = deferred<typeof module>();
    const boundary = createLazySettingsBoundary(() => download.promise);
    let owner = user.id;
    let scanGeneration = 10;
    const result = boundary.open(user, () => owner === user.id && scanGeneration === 10);
    if (changed === "owner") owner = "another-user";
    else scanGeneration++;
    download.resolve(module);
    assert.equal(await result, "stale");
    assert.deepEqual(module.opened, []);
  }
});

test("failed Settings downloads are contained and retryable", async () => {
  const module = settingsModule();
  let imports = 0;
  const boundary = createLazySettingsBoundary(async () => {
    if (++imports === 1) throw new Error("Offline");
    return module;
  });
  assert.equal(await boundary.open(user, () => true), "failed");
  assert.equal(await boundary.open(user, () => true), "opened");
  assert.equal(imports, 2);
  assert.deepEqual(module.opened, [user.id]);
});

test("an already stale request neither imports nor opens Settings", async () => {
  let imports = 0;
  const boundary = createLazySettingsBoundary(async () => { imports++; return settingsModule(); });
  assert.equal(await boundary.open(user, () => false), "stale");
  assert.equal(imports, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSideInputGuard } from "./sideInputGuard.js";

test("a late native picker cannot act after skip or a replacement capture", () => {
  const guard = createSideInputGuard(() => "user:first");
  const first = guard.begin();
  assert.equal(first(), true);
  guard.cancel();
  assert.equal(first(), false);
  const second = guard.begin();
  assert.equal(second(), true);
  assert.equal(first(), false);
  const third = guard.begin();
  assert.equal(second(), false);
  assert.equal(third(), true);
});

test("file, drop and paste callbacks cannot follow an account change", () => {
  let owner: string | null = "user:first";
  const guard = createSideInputGuard(() => owner);
  const acceptsInput = guard.begin();
  owner = "user:second";
  assert.equal(acceptsInput(), false);
  owner = "anonymous:next";
  assert.equal(acceptsInput(), false);
  assert.equal(guard.begin()(), true);
  owner = null;
  assert.equal(guard.begin()(), false);
});

test("the side flow replaces native picker elements and clears all input callbacks on close", () => {
  const source = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  const clear = source.slice(source.indexOf("function clearSideInputs"), source.indexOf("function wireSideInputs"));
  assert.match(clear, /sideInputGuard\.cancel\(\)/);
  for (const handler of ["onchange", "ondragover", "ondragleave", "ondrop"]) {
    assert.ok(clear.includes(`${handler} = null`));
  }
  const wire = source.slice(source.indexOf("function wireSideInputs"), source.indexOf("async function openSideCamera"));
  assert.match(wire, /e\.input\.cloneNode\(false\)/);
  assert.match(wire, /e\.input\.replaceWith\(input\)/);
  assert.match(wire, /ownsInput\(\) && e\.section\.isConnected/);
  assert.match(wire, /if \(file && acceptsInput\(\)\) await load\(file, ctx\)/);
  const close = source.slice(source.indexOf("export function close()"), source.indexOf("async function load(file"));
  assert.match(close, /clearSideInputs\(\)/);
});

test("side completion checks the active scan before storing the reviewed photo", () => {
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
  const side = main.slice(main.indexOf("function startSide()"));
  const done = side.slice(side.indexOf("onDone: async"), side.indexOf("await gateAnalysis(sideReport, token)"));
  assert.match(done, /if \(!scanSession\.isCurrent\(token\) \|\| !pending/);
  assert.match(done, /scanSession\.snapshot\(\)\.owner !== activeScanOwner\(\)/);
  assert.match(done, /const shot = review\.photo/);
  assert.ok(done.indexOf("scanSession.isCurrent(token)") < done.indexOf("lastSide ="));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SIDE_POINTS } from "../engine/sideMetrics.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { activateScanOwner, activeScanOwner, scopedStorageKey } from "../engine/scanScope.js";
import { readSidePrior, setSidePriorSuspended, writeSidePrior } from "../engine/sidePrior.js";

test("Quick suppression ignores owner and guest priors without deleting or mixing their saved data", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalOwner = activeScanOwner();
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  } });
  const ownerPoints = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, { x: index + 20, y: index + 40 }])) as SidePoints;
  const otherPoints = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [id, { x: index + 120, y: index + 140 }])) as SidePoints;
  try {
    setSidePriorSuspended(false);
    activateScanOwner("calibration-owner");
    writeSidePrior(ownerPoints, 640, 960);
    const ownerKey = scopedStorageKey("truemax:sidePrior")!;
    const ownerStored = entries.get(ownerKey);
    assert.deepEqual(readSidePrior()?.points, ownerPoints, "personal scans can read their own prior");

    // This is the same page-local call made at Quick startup, before auth.
    setSidePriorSuspended(true);
    assert.equal(readSidePrior(), null, "no owner's geometry may seed another subject in Quick");
    assert.equal(entries.get(ownerKey), ownerStored, "suppression never deletes or rewrites the owner's saved prior");

    activateScanOwner("other-creator");
    writeSidePrior(otherPoints, 800, 1000);
    const otherKey = scopedStorageKey("truemax:sidePrior")!;
    assert.notEqual(otherKey, ownerKey);
    assert.equal(readSidePrior(), null, "an account switch cannot re-enable priors in Quick");
    activateScanOwner(null);
    assert.equal(readSidePrior(), null, "anonymous/guest state does not fall back to an owner's prior");

    // A personal-scan page has its own unsuspended module state. Restoring that
    // state here proves Quick changed access, not the persistent record.
    setSidePriorSuspended(false);
    activateScanOwner("calibration-owner");
    assert.deepEqual(readSidePrior()?.points, ownerPoints);
    activateScanOwner("other-creator");
    assert.deepEqual(readSidePrior()?.points, otherPoints);
    assert.equal(entries.get(ownerKey), ownerStored);
  } finally {
    setSidePriorSuspended(false);
    activateScanOwner(originalOwner?.startsWith("user:") ? originalOwner.slice(5) : null);
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("Quick suspends personal priors once, before its asynchronous access and capture work", () => {
  const source = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ setSidePriorSuspended \} from "\.\/engine\/sidePrior\.js"/);
  assert.equal([...source.matchAll(/setSidePriorSuspended\(true\)/g)].length, 1);
  assert.ok(source.indexOf("setSidePriorSuspended(true)") < source.indexOf("void quickAccessProfile()"));
  assert.doesNotMatch(source, /setSidePriorSuspended\(false\)/);
  assert.doesNotMatch(source, /writeSidePrior\(/);
});

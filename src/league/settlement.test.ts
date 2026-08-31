import assert from "node:assert/strict";
import test from "node:test";
import { allocatePoolCents } from "./settlement.js";

test("largest remainders never over-allocate the published pool", () => {
  const result = allocatePoolCents(200_000, [
    { id: "a", accruedCents: 250_000 },
    { id: "b", accruedCents: 250_000 },
    { id: "c", accruedCents: 250_000 },
  ]);
  assert.deepEqual([...result.entries()].sort(), [
    ["a", 66_667],
    ["b", 66_667],
    ["c", 66_666],
  ]);
  assert.equal([...result.values()].reduce((sum, amount) => sum + amount, 0), 200_000);
});

test("covered, empty and zero pools are exact", () => {
  assert.deepEqual([...allocatePoolCents(500, [{ id: "a", accruedCents: 123 }])], [["a", 123]]);
  assert.deepEqual([...allocatePoolCents(0, [{ id: "a", accruedCents: 123 }])], [["a", 0]]);
  assert.deepEqual([...allocatePoolCents(100, [])], []);
});

test("allocation is deterministic and bounded under fuzzed inputs", () => {
  let seed = 0x51_7a_2c;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let run = 0; run < 5_000; run += 1) {
    const count = Math.floor(random() * 30);
    const pool = Math.floor(random() * 1_000_000);
    const shares = Array.from({ length: count }, (_, index) => ({
      id: index.toString().padStart(3, "0"),
      accruedCents: Math.floor(random() * 2_000_000),
    }));
    const first = allocatePoolCents(pool, shares);
    const second = allocatePoolCents(pool, shares);
    assert.deepEqual([...first], [...second]);
    const allocated = [...first.values()].reduce((sum, amount) => sum + amount, 0);
    const accrued = shares.reduce((sum, share) => sum + share.accruedCents, 0);
    assert.ok(allocated <= pool);
    assert.equal(allocated, Math.min(pool, accrued));
    for (const share of shares) assert.ok((first.get(share.id) ?? 0) <= share.accruedCents);
  }
});

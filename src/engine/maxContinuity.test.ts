import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { reconcileRoutineSnapshots } from "./routineRestore.js";
import type { Protocol } from "./protocol.js";

const source = readFileSync(new URL("./maxConversations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const routine = { id: "sleep-1700000000000", title: "Sleep timing", status: "running", startedAt: 1700000000000, weeksToReview: 4, tickDays: ["2026-09-09"], checkIns: [] };

function harness() {
  let owner = "user:a";
  let protocols: Protocol[] = [];
  let allowStorage = true;
  let tokenWait: Promise<string> = Promise.resolve("test-token");
  let responseWait = Promise.resolve({ conversations: [], planItems: [], routines: [routine] });
  let fetches = 0;
  const api = new Function("currentAccessToken", "activeScanOwner", "readProtocols", "writeProtocols", "reconcileRoutineSnapshots", "fetch",
    `${js}\nreturn { listMaxConversations, loadMaxConversation };`)(
    () => tokenWait, () => owner, () => protocols, (next: Protocol[]) => { if (allowStorage) protocols = next; },
    reconcileRoutineSnapshots, async () => { fetches++; return { ok: true, json: () => responseWait }; },
  ) as { listMaxConversations: () => Promise<{ routineRestoration: { restored: number; error?: string }; planItems: unknown[] }> };
  return { api, owner: (next: string) => { owner = next; }, protocols: () => protocols, fetched: () => fetches,
    blockStorage: () => { allowStorage = false; }, token: (next: Promise<string>) => { tokenWait = next; },
    response: (next: typeof responseWait) => { responseWait = next; } };
}

test("conversation listing restores account routines but does not convert notes", async () => {
  const h = harness();
  const result = await h.api.listMaxConversations();
  assert.equal(result.routineRestoration.restored, 1);
  assert.equal(h.protocols()[0].id, routine.id);
  assert.equal((await h.api.listMaxConversations()).routineRestoration.restored, 0);
});

test("storage failure is reported while conversation history remains available", async () => {
  const h = harness(); h.blockStorage();
  const result = await h.api.listMaxConversations();
  assert.match(result.routineRestoration.error!, /storage/);
  assert.equal(result.routineRestoration.restored, 0);
  assert.deepEqual(h.protocols(), []);
});

test("changing account while obtaining a token prevents the read", async () => {
  const h = harness();
  let release!: (token: string) => void;
  h.token(new Promise((resolve) => { release = resolve; }));
  const pending = h.api.listMaxConversations();
  h.owner("user:b"); release("test-token");
  await assert.rejects(pending, /Sign in/);
  assert.equal(h.fetched(), 0);
});

test("a late response cannot restore the previous account's routines", async () => {
  const h = harness();
  let release!: (value: { conversations: never[]; planItems: never[]; routines: typeof routine[] }) => void;
  h.response(new Promise((resolve) => { release = resolve; }));
  const pending = h.api.listMaxConversations();
  await Promise.resolve();
  h.owner("user:b"); release({ conversations: [], planItems: [], routines: [routine] });
  await assert.rejects(pending, /account changed/);
  assert.deepEqual(h.protocols(), []);
});

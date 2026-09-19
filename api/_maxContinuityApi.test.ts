import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { loadRoutineMemory } from "./_maxRoutineSync.js";

const source = readFileSync(new URL("./max-conversations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const chatId = "11111111-1111-4111-8111-111111111111";
const foreignId = "22222222-2222-4222-8222-222222222222";
const routine = { id: "sleep-1700000000000", title: "Sleep timing", status: "judged", startedAt: 1700000000000,
  weeksToReview: 4, tickDays: [], checkIns: [] };

function harness(options: { user?: string | null; entitled?: boolean; origin?: boolean } = {}) {
  const calls: Array<{ table: string; filters: unknown[][] }> = [];
  const writes: unknown[][] = [];
  const records: Record<string, Array<Record<string, unknown>>> = {
    max_plan_items: [
      { user_id: "a", title: "My saved note", normalized_title: "my saved note", status: "active", notes: "", source_conversation_id: chatId },
      { user_id: "b", title: "Foreign saved note", normalized_title: "foreign saved note", status: "active", notes: "" },
      { user_id: "a", title: routine.title, normalized_title: `protocol:${routine.id}`, status: "completed", notes: JSON.stringify({ protocol: routine }), source_conversation_id: null },
    ],
    max_conversations: [{ id: chatId, user_id: "a", archived_at: null }, { id: foreignId, user_id: "b", archived_at: null }],
    max_messages: [{ id: 1, user_id: "a", conversation_id: chatId, role: "user", content: "My message" },
      { id: 2, user_id: "b", conversation_id: foreignId, role: "user", content: "Foreign message" }],
  };
  const admin = { from(table: string) {
    const filters: unknown[][] = [];
    let single = false;
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "is", "not", "like", "order", "limit"]) {
      chain[op] = (...args: unknown[]) => { filters.push([op, ...args]); return chain; };
    }
    chain.maybeSingle = () => { single = true; return chain; };
    chain.then = (resolve: (value: unknown) => void) => {
      calls.push({ table, filters });
      const data = records[table].filter((row) => filters.every(([op, column, value, extra]) => {
        const actual = row[String(column)];
        if (op === "eq") return actual === value;
        if (op === "is") return (actual ?? null) === value;
        if (op === "in") return (value as unknown[]).includes(actual);
        if (op === "like") return String(actual).startsWith(String(value).replace(/%$/, ""));
        if (op === "not" && value === "like") return !String(actual).startsWith(String(extra).replace(/%$/, ""));
        return true;
      }));
      resolve({ data: single ? data[0] ?? null : data, error: null });
    };
    return chain;
  } } as unknown as Parameters<typeof loadRoutineMemory>[0];
  const api = new Function("authenticatedUser", "getSupabaseAdmin", "json", "requestOrigin", "safeMessage", "maxAccessForUser", "loadRoutineMemory", "syncRoutineMemory",
    `${js}\nreturn { GET, POST };`)(
    async () => options.user === null ? null : { id: options.user ?? "a" }, () => admin,
    (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }), () => options.origin !== false,
    () => "test error", async () => options.entitled === false ? { ok: false, status: 402, error: "Max required" } : { ok: true },
    loadRoutineMemory, async (...args: unknown[]) => { writes.push(args); return []; },
  ) as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> };
  return { api, calls, writes };
}

test("GET separates saved notes from restored routines and never returns another owner's records", async () => {
  const h = harness();
  const response = await h.api.GET(new Request("https://truemax.app/api/max-conversations"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.planItems.map((item: { title: string }) => item.title), ["My saved note"]);
  assert.equal(body.routines[0].status, "judged");
  assert.deepEqual(body.conversations.map((item: { id: string }) => item.id), [chatId]);
  assert.ok(h.calls.every((call) => call.filters.some(([op, key, value]) => op === "eq" && key === "user_id" && value === "a")));
});

test("foreign conversation ids fail closed without returning their messages", async () => {
  const h = harness();
  const response = await h.api.GET(new Request(`https://truemax.app/api/max-conversations?id=${foreignId}`));
  assert.equal(response.status, 404);
  assert.ok(!h.calls.some((call) => call.table === "max_messages"));
});

test("origin, authentication and entitlement guards run before any restoration read", async () => {
  for (const [options, expected] of [[{ origin: false }, 403], [{ user: null }, 401], [{ entitled: false }, 402]] as const) {
    const h = harness(options);
    assert.equal((await h.api.GET(new Request("https://truemax.app/api/max-conversations"))).status, expected);
    assert.equal(h.calls.length, 0);
  }
});

test("POST uses the authenticated owner rather than any claimed payload owner", async () => {
  const h = harness();
  const response = await h.api.POST(new Request("https://truemax.app/api/max-conversations", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: "b", items: [routine] }) }));
  assert.equal(response.status, 200);
  assert.equal(h.writes[0][1], "a");
  assert.deepEqual(h.writes[0][2], [routine]);
});

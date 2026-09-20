import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as persona from "./_maxPersona.js";
import { conversationTitle, parsePlanMemoryCommand } from "./_maxConversation.js";
import { createMaxReplyStream, MAX_REPLY_EMPTY, MAX_REPLY_UNAVAILABLE, MAX_REPLY_INTERRUPTED, MAX_REPLY_NOT_SAVED } from "./_maxReplyStream.js";

// Execute the production handler with isolated in-memory adapters, never a live
// account, provider credential or database. The stream implementation is real.
const source = readFileSync(new URL("./max-chat.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
const chatId = "11111111-1111-4111-8111-111111111111";
const foreignId = "22222222-2222-4222-8222-222222222222";

function harness(options: { answer?: string; interrupted?: boolean; providerError?: Error; saveThrows?: boolean; saveError?: boolean; metadataFailure?: "throw" | "error"; user?: string | null; entitled?: boolean; origin?: boolean } = {}) {
  const queries: Array<{ table: string; filters: unknown[][]; write?: Record<string, unknown> }> = [];
  const messages: Array<Record<string, unknown>> = [];
  const rpc: string[] = [];
  const prompts: unknown[] = [];
  const errors: unknown[][] = [];
  const admin = {
    async rpc(name: string) { rpc.push(name); return { data: 29, error: null }; },
    from(table: string) {
      const filters: unknown[][] = [];
      let write: Record<string, unknown> | undefined;
      let insert = false;
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "in", "not", "order", "limit", "single", "maybeSingle"]) {
        chain[op] = (...args: unknown[]) => { filters.push([op, ...args]); return chain; };
      }
      chain.insert = (row: Record<string, unknown>) => { write = row; insert = true; return chain; };
      chain.update = (row: Record<string, unknown>) => { write = row; return chain; };
      chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        queries.push({ table, filters, write });
        if (table === "max_messages" && insert && write) {
          if (write.role === "assistant" && options.saveThrows) return Promise.reject(new Error("save failed")).then(resolve, reject);
          if (write.role === "assistant" && options.saveError) return Promise.resolve({ data: null, error: { message: "save failed" } }).then(resolve, reject);
          messages.push(write);
        }
        if (table === "max_conversations" && write && !insert && messages.some((row) => row.role === "assistant")) {
          if (options.metadataFailure === "throw") return Promise.reject(new Error("metadata failed")).then(resolve, reject);
          if (options.metadataFailure === "error") return Promise.resolve({ data: null, error: { message: "metadata failed" } }).then(resolve, reject);
        }
        const foreign = filters.some(([op, key, value]) => op === "eq" && key === "id" && value === foreignId);
        const data = table === "body_profiles" ? null
          : table === "max_conversations" ? foreign ? null : { id: chatId, title: "Test chat" }
          : table === "max_messages" ? [...messages].reverse() : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return chain;
    },
  };
  class Provider {
    messages = { stream(input: unknown) {
      prompts.push(input);
      return {
        abort() {},
        async *[Symbol.asyncIterator]() {
          if (options.providerError) throw options.providerError;
          yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: options.answer ?? "Keep it simple." } };
          if (options.interrupted) throw new Error("provider disconnected");
          yield { type: "message_stop" };
        },
      };
    } };
  }
  const inputs = {
    Anthropic: Provider, anthropicKey: () => "synthetic-test-key", ...persona,
    authenticatedUser: async () => options.user === null ? null : { id: options.user ?? "owner" },
    getSupabaseAdmin: () => admin,
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    requestOrigin: () => options.origin !== false,
    safeMessage: () => "test error",
    maxAccessForUser: async () => options.entitled === false ? { ok: false, status: 402, error: "Max required" } : { ok: true, age: 25, staff: true },
    conversationTitle, parsePlanMemoryCommand, hydrateRoutineContext: async () => {}, createMaxReplyStream,
    process: { env: {} }, console: { error(...args: unknown[]) { errors.push(args); } },
  };
  const post = new Function(...Object.keys(inputs), `${js}\nreturn POST;`)(...Object.values(inputs)) as (request: Request) => Promise<Response>;
  const request = (extra: Record<string, unknown> = {}) => new Request("https://truemax.app/api/max-chat", {
    method: "POST", body: JSON.stringify({ context: {}, messages: [{ role: "user", content: "One useful next step?" }], ...extra }),
  });
  return { post, request, queries, messages, rpc, prompts, errors };
}

test("chat guards refuse requests before database reads, claims or provider calls", async () => {
  for (const [options, status] of [[{ origin: false }, 403], [{ user: null }, 401], [{ entitled: false }, 402]] as const) {
    const h = harness(options);
    assert.equal((await h.post(h.request())).status, status);
    assert.equal(h.queries.length, 0);
    assert.equal(h.rpc.length, 0);
    assert.equal(h.prompts.length, 0);
  }
});

test("an unowned chat is refused and its claimed allowance is released", async () => {
  const h = harness();
  const response = await h.post(h.request({ conversationId: foreignId, user_id: "somebody-else" }));
  assert.equal(response.status, 404);
  assert.deepEqual(h.rpc, ["claim_max_chat_turn", "release_max_chat_turn"]);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.messages.length, 0);
});

test("empty provider content is not charged as a delivered reply or saved as an empty message", async () => {
  const h = harness({ answer: " \n " });
  const response = await h.post(h.request());
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(MAX_REPLY_EMPTY));
  assert.deepEqual(h.rpc, ["claim_max_chat_turn", "release_max_chat_turn"]);
  assert.deepEqual(h.messages.map((row) => row.role), ["user"]);
});

test("a provider credit rejection refunds the turn and does not save a fallback as a substantive answer", async () => {
  const providerError = Object.assign(new Error("400 invalid_request_error: Your credit balance is too low to access the API. Please go to Plans & Billing to upgrade or purchase credits."), {
    status: 400, error: { type: "invalid_request_error" },
  });
  const h = harness({ providerError });
  const response = await h.post(h.request());
  const text = await response.text();
  assert.equal(text, MAX_REPLY_UNAVAILABLE);
  assert.doesNotMatch(text, /credit|billing|upgrade|invalid_request|400/i);
  assert.deepEqual(h.rpc, ["claim_max_chat_turn", "release_max_chat_turn"]);
  assert.deepEqual(h.messages.map((row) => row.role), ["user"]);
  assert.equal(h.prompts.length, 1);
});

test("a partial failed answer and its notice are saved only to the authenticated owner's chat", async () => {
  const h = harness({ answer: "Start here", interrupted: true });
  const response = await h.post(h.request({ user_id: "somebody-else" }));
  const text = await response.text();
  assert.equal(text, `Start here\n\n${MAX_REPLY_INTERRUPTED}`);
  assert.equal(response.headers.get("X-Max-Conversation"), chatId);
  assert.equal(h.messages[1].content, text);
  assert.ok(h.messages.every((row) => row.user_id === "owner" && row.conversation_id === chatId));
  const reads = h.queries.filter((query) => !query.write);
  assert.ok(reads.every((query) => query.filters.some(([op, key, value]) => op === "eq" && key === "user_id" && value === "owner")));
  assert.deepEqual(h.rpc, ["claim_max_chat_turn"]);
});

test("an assistant insert failure reports an unsaved reply without storing its error notice", async () => {
  for (const options of [{ saveThrows: true }, { saveError: true }]) {
    const h = harness(options);
    const response = await h.post(h.request());
    assert.equal(await response.text(), `Keep it simple.\n\n${MAX_REPLY_NOT_SAVED}`);
    assert.deepEqual(h.messages.map((row) => row.role), ["user"]);
    assert.deepEqual(h.errors.map(([stage]) => stage), ["max-chat persistence"]);
    assert.deepEqual(h.rpc, ["claim_max_chat_turn"]);
    assert.equal(h.queries.filter((query) => query.table === "max_conversations" && query.write && !query.write.user_id).length, 1,
      "no assistant recency update is attempted after its insert fails");
  }
});

test("a saved assistant reply remains successful when its conversation recency update fails", async () => {
  for (const metadataFailure of ["throw", "error"] as const) {
    const h = harness({ metadataFailure });
    const response = await h.post(h.request({ user_id: "somebody-else" }));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "Keep it simple.");
    assert.deepEqual(h.messages.map((row) => row.role), ["user", "assistant"]);
    assert.equal(h.messages[1].content, "Keep it simple.");
    assert.ok(h.messages.every((row) => row.user_id === "owner" && row.conversation_id === chatId));
    const metadataUpdate = h.queries[h.queries.length - 1];
    assert.equal(metadataUpdate?.table, "max_conversations");
    assert.ok(metadataUpdate?.filters.some(([op, key, value]) => op === "eq" && key === "id" && value === chatId));
    assert.ok(metadataUpdate?.filters.some(([op, key, value]) => op === "eq" && key === "user_id" && value === "owner"));
    assert.deepEqual(h.errors.map(([stage]) => stage), ["max-chat conversation recency update"]);
    assert.deepEqual(h.rpc, ["claim_max_chat_turn"]);
    assert.equal(h.prompts.length, 1);
  }
});

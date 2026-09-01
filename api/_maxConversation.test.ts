import assert from "node:assert/strict";
import test from "node:test";
import { conversationTitle, parsePlanMemoryCommand } from "./_maxConversation.js";

test("conversation titles are generated from the first real request", () => {
  assert.equal(conversationTitle("Hey Max, can you help with my jawline?"), "Help with my jawline");
  assert.equal(conversationTitle("   "), "New chat");
  assert.ok(conversationTitle("Please explain this very long request about all the different things in my current routine and what matters most").length <= 53);
});

test("only explicit add-to-plan language creates plan memory", () => {
  assert.deepEqual(parsePlanMemoryCommand("add daily sunscreen to my current plan"), {
    kind: "add",
    title: "daily sunscreen",
    normalizedTitle: "daily sunscreen",
    category: "product",
  });
  assert.deepEqual(parsePlanMemoryCommand("Add gentle cleanser product."), {
    kind: "add",
    title: "gentle cleanser",
    normalizedTitle: "gentle cleanser",
    category: "product",
  });
  assert.equal(parsePlanMemoryCommand("Would sunscreen help me?"), null);
});

test("not-working language changes the named item without interpreting a question", () => {
  assert.deepEqual(parsePlanMemoryCommand("Daily sunscreen isn't currently working for me."), {
    kind: "not_working",
    title: "Daily sunscreen",
    normalizedTitle: "daily sunscreen",
  });
  assert.equal(parsePlanMemoryCommand("How is my progress tracking?"), null);
  assert.equal(parsePlanMemoryCommand("Is my cleanser working?"), null);
});

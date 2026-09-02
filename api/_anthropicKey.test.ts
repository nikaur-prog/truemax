import test from "node:test";
import assert from "node:assert/strict";
import { anthropicKey } from "./_anthropicKey.js";

const KEY = "sk-ant-api03-" + "a".repeat(95);

test("a clean key comes back unchanged", () => {
  assert.equal(anthropicKey({ ANTHROPIC_API_KEY: KEY }), KEY);
});

// The one that cost an hour: copying a key out of a console web page brought
// U+2028 with it, invisible everywhere, and every request died inside the
// HTTP client with "value of 8232 which is greater than 255".
test("an invisible character from a copy and paste is dropped", () => {
  for (const junk of [" ", " ", "\n", "\r\n", " ", "​", "﻿"]) {
    assert.equal(anthropicKey({ ANTHROPIC_API_KEY: KEY + junk }), KEY, JSON.stringify(junk));
    assert.equal(anthropicKey({ ANTHROPIC_API_KEY: junk + KEY }), KEY, JSON.stringify(junk));
  }
  // And every byte that survives is header-legal.
  const cleaned = anthropicKey({ ANTHROPIC_API_KEY: `${KEY} ` });
  for (const ch of cleaned) assert.ok(ch.codePointAt(0)! <= 255, ch);
});

test("surrounding whitespace goes too", () => {
  assert.equal(anthropicKey({ ANTHROPIC_API_KEY: `  ${KEY}\t ` }), KEY);
});

test("a missing or empty key is named, not passed on", () => {
  assert.throws(() => anthropicKey({}), /Missing server environment variable/);
  assert.throws(() => anthropicKey({ ANTHROPIC_API_KEY: "" }), /Missing server environment variable/);
  assert.throws(() => anthropicKey({ ANTHROPIC_API_KEY: "  " }), /no usable characters/);
});

test("nothing inside the key is rewritten", () => {
  // Only the outside is cleaned. A key is ASCII by construction, so a
  // character in the middle that is not would mean the wrong string entirely,
  // and quietly repairing it into something that looks valid would be worse
  // than the request failing.
  const odd = "sk-ant- -rest";
  assert.equal(anthropicKey({ ANTHROPIC_API_KEY: odd }), "sk-ant--rest");
});

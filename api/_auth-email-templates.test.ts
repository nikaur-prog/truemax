import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const directory = resolve(process.cwd(), "supabase/email-templates");
const linkedTemplates = [
  "confirm-signup.html",
  "magic-link.html",
  "reset-password.html",
  "invite-user.html",
  "change-email.html",
];

async function template(name: string): Promise<string> {
  return readFile(resolve(directory, name), "utf8");
}

test("linked auth emails hide the Supabase URL behind one clean button", async () => {
  for (const name of linkedTemplates) {
    const html = await template(name);
    assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/);
    assert.equal(html.match(/\{\{ \.ConfirmationURL \}\}/g)?.length, 1, name);
    assert.doesNotMatch(html, /<script|<img|<style|@import/i, name);
    assert.doesNotMatch(html.replace(/href="[^"]+"/g, ""), /https?:\/\//i, name);
  }
});

test("password reset names the address and explains the no-action path", async () => {
  const html = await template("reset-password.html");
  assert.match(html, /\{\{ \.Email \}\}/);
  assert.match(html, /Didn’t ask for this\?/);
  assert.match(html, /Your password will not change unless the secure button is used\./);
});

test("signup confirmation is also the branded welcome email", async () => {
  const html = await template("confirm-signup.html");
  assert.match(html, /<h1[^>]*>Welcome to TrueMax<\/h1>/);
  assert.match(html, /Confirm my email/);
  assert.match(html, /face photos stay on your device/i);
});

test("reauthentication uses a code and does not invent a link", async () => {
  const html = await template("reauthentication.html");
  assert.match(html, /\{\{ \.Token \}\}/);
  assert.match(html, /\{\{ \.Email \}\}/);
  assert.doesNotMatch(html, /ConfirmationURL/);
});

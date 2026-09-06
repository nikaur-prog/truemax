import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const bodyStyles = styles.slice(styles.indexOf("body.body-profile-open"), styles.indexOf(".nutri-note"));

test("the body details form remains scrollable inside a short safe-area viewport", () => {
  assert.match(bodyStyles, /\.body-profile-overlay \{[^}]*overflow-y: auto/);
  assert.match(bodyStyles, /\.body-profile-dialog \{[^}]*max-height: calc\(100vh - 36px\); max-height: calc\(100dvh - 36px\)/);
  assert.match(bodyStyles, /\.body-profile-dialog \{[^}]*overflow-y: auto/);
  assert.match(bodyStyles, /max-height: calc\(100dvh - max\(12px, env\(safe-area-inset-top\)\)\)/);
  assert.match(bodyStyles, /padding: 24px 20px max\(24px, env\(safe-area-inset-bottom\)\)/);
});

test("imperial fields can shrink on phones and the close action has a full touch target", () => {
  assert.match(bodyStyles, /\.body-profile-fields\.imperial \{ grid-template-columns: minmax\(0, \.72fr\) minmax\(0, \.72fr\) minmax\(0, 1fr\)/);
  assert.match(bodyStyles, /\.body-profile-fields label, \.body-profile-fields label > div \{ min-width: 0/);
  assert.match(bodyStyles, /\.body-profile-fields input \{[^}]*min-width: 0/);
  assert.match(bodyStyles, /\.body-profile-close \{\s+width: 44px; height: 44px; flex: 0 0 44px/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IDLE_ACTS } from "./maxIdle.js";
import { maxCharacterMarkup } from "./maxCharacter.js";

// ---------------------------------------------------------------------------
// An act that does nothing is worse than no act.
//
// maxIdle picks a name out of a list and puts `mx-act-<name>` on the SVG. That
// is the entire mechanism, and it fails silently in both directions: add a name
// with no stylesheet behind it and he stands there for five seconds looking
// broken; write a rule for a name the list never picks and it is dead CSS
// nobody will find again.
//
// The bug this exists to stop had already happened — the repertoire was
// reported as not visibly doing anything, and with only a class name in the
// TypeScript there was nothing to check it against. These tests are the join
// between the two halves.
// ---------------------------------------------------------------------------

const css = readFileSync(fileURLToPath(new URL("../style.css", import.meta.url)), "utf8");

test("every idle act has a stylesheet rule that moves him", () => {
  for (const act of IDLE_ACTS) {
    const cls = `.mx-act-${act}`;
    assert.ok(css.includes(cls), `${act} has no ${cls} rule — he would freeze for five seconds`);
    // Not merely mentioned: it has to drive an animation on something. A rule
    // that only reveals a prop leaves a static object hanging beside a still
    // robot, which is the same failure wearing a picture.
    const drives = new RegExp(`\\${cls}\\s[^{]*\\{[^}]*animation`, "s").test(css);
    assert.ok(drives, `${act} reveals a prop but animates nothing`);
  }
});

test("no stylesheet act rule exists that the repertoire never picks", () => {
  const declared = new Set(IDLE_ACTS as readonly string[]);
  const inCss = new Set<string>();
  for (const [, name] of css.matchAll(/\.mx-act-([a-z]+)/g)) inCss.add(name);
  for (const name of inCss) {
    assert.ok(declared.has(name), `.mx-act-${name} is styled but IDLE_ACTS never picks it`);
  }
});

test("every prop an act reveals actually exists in the drawing", () => {
  const svg = maxCharacterMarkup();
  // Collect the props each act turns on, then check the SVG carries them. A
  // display rule pointing at a class that was never drawn is invisible in
  // every way except that the act does nothing.
  for (const [, prop] of css.matchAll(/\.mx-act-[a-z]+\s+\.(mx-prop-[a-z]+)/g)) {
    assert.ok(svg.includes(prop), `${prop} is revealed by an act but not drawn`);
  }
});

test("the repertoire is wide enough not to be its own loop", () => {
  // Four was the old set, and at four you have seen all of him inside a minute
  // — after which the SET is the repeat, which is the thing "never twice
  // running" was written to prevent one level down.
  assert.ok(IDLE_ACTS.length >= 6, `only ${IDLE_ACTS.length} acts`);
  assert.equal(new Set(IDLE_ACTS).size, IDLE_ACTS.length, "duplicate act names");
});

// ---------------------------------------------------------------------------
// Animations that run for states nobody is in.
//
// Max carries a dozen `infinite` animations at rest, and four of them were for
// things that were not happening: the three thinking dots and the talking
// mouth. Both live inside `.mx-alt` groups, which are `display: none` — but
// display:none on an ANCESTOR does not stop a CHILD's animation from being
// created, and the dots and the mouth shape are children. Measured in a real
// browser: twelve running animations on one resting Max, eight after scoping
// them to the classes that actually show them.
//
// That is a third of his idle cost, on every drawing of him on the page — and
// the loader renders four at once. Asserted from the stylesheet text because
// the property is structural: these two animations must never again be
// declared on a selector that matches a Max who is merely standing there.
// ---------------------------------------------------------------------------
test("no animation runs for a state Max is not currently in", () => {
  for (const [selector, gate] of [
    [".mx-talk-shape", "speaking"],
    [".mx-thought .mx-dot", "thinking"],
  ] as const) {
    // Find every rule whose selector list ends with this element and which
    // declares an infinite animation.
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, sel, body]) => sel.includes(selector) && /animation:[^;]*infinite/.test(body));
    assert.ok(rules.length > 0, `${selector} never animates at all`);
    for (const [, sel] of rules) {
      assert.ok(
        sel.includes(gate),
        `${selector} animates on "${sel.trim()}" which does not require .${gate} — it would tick forever on a resting Max`,
      );
    }
  }
});

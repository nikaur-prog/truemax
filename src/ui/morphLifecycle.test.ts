import assert from "node:assert/strict";
import test from "node:test";
import { buildMorphBlueprint } from "../engine/morphPlan.js";
import { EMPTY_PROFILE } from "../engine/goals.js";
import type { Report } from "../engine/types.js";
import type { MorphRenderState } from "../engine/morphContract.js";
import { wireMorphPreview } from "./morphPreview.js";
import { ensureGoalPreviewConsent } from "./goalPreviewConsent.js";

const PIXEL = "data:image/jpeg;base64," + Buffer.alloc(400, 7).toString("base64");
const report: Report = { sex: "female", overall: 5, overallPercentile: 50, overallZ: 0, potential: 6, pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 }, regions: [], metrics: [], zScores: {} };
const selected = buildMorphBlueprint(report, { ...EMPTY_PROFILE, goals: ["skin"] }, "selected", false);
const maxVision = buildMorphBlueprint(report, { ...EMPTY_PROFILE, goals: ["skin", "photos"] }, "max_vision", false);
const ready: MorphRenderState = {
  status: "ready", jobId: "preview_12345678", images: { front: PIXEL },
  validation: { identityPreserved: true, targetAligned: true, naturalOnly: true, crossViewConsistent: true, moderationPassed: true },
};
const pending: MorphRenderState = { status: "validation_pending", jobId: "preview_12345678", images: { front: PIXEL } };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Small DOM boundary double. All network, consent and validator work is fake. */
class Element extends EventTarget {
  dataset: Record<string, string> = {};
  hidden = false;
  disabled = false;
  isConnected = true;
  textContent = "";
  className = "";
  innerHTML = "";
  src = "";
  onclick: (() => unknown) | null = null;
  nodes = new Map<string, Element[]>();
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    add: (...values: string[]) => values.forEach((value) => this.classes.add(value)),
    remove: (...values: string[]) => values.forEach((value) => this.classes.delete(value)),
    toggle: (value: string, enabled: boolean) => enabled ? this.classes.add(value) : this.classes.delete(value),
  };
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): Element[] {
    return selector.split(", ").flatMap((part) => this.nodes.get(part) ?? []);
  }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); if (key === "src") this.src = ""; }
  remove() { this.isConnected = false; }
  click() { this.dispatchEvent(new Event("click")); return this.onclick?.(); }
  focus() { (globalThis.document as unknown as { activeElement: Element }).activeElement = this; }
  contains(node: Element) { return node === this || [...this.nodes.values()].some((nodes) => nodes.includes(node)); }
}

function fixture(overrides: Parameters<typeof wireMorphPreview>[2] = {}) {
  const host = new Element(), shell = new Element(), create = new Element(), output = new Element(), original = new Element();
  const chooseSelected = new Element(), chooseMax = new Element();
  chooseSelected.dataset.morphVariant = "selected";
  chooseMax.dataset.morphVariant = "max_vision";
  output.hidden = true;
  host.nodes.set(".morph-preview", [shell]);
  shell.nodes.set("[data-morph-create]", [create]);
  shell.nodes.set("[data-morph-variant]", [chooseSelected, chooseMax]);
  shell.nodes.set("[data-morph-status]", [new Element()]);
  shell.nodes.set("[data-morph-points]", [new Element()]);
  shell.nodes.set('[data-morph-output="front"]', [output]);
  shell.nodes.set('[data-morph-current="front"]', [original]);
  shell.nodes.set("[data-morph-output]", [output]);
  shell.nodes.set("[data-morph-current]", [original]);
  let owner = "user:member-a";
  let changed = () => {};
  let unsubscribed = 0;
  const expectedUsers: Array<string | undefined> = [];
  const dispose = wireMorphPreview(host as unknown as HTMLElement, {
    scanId: "123e4567-e89b-42d3-a456-426614174000", selected, maxVision,
    frontLandmarks: [], frontPhoto: {} as HTMLCanvasElement, sidePhoto: null, renderEnabled: true,
  }, {
    owner: () => owner,
    token: async (userId) => { expectedUsers.push(userId); return "member-a-token"; },
    consent: async () => true,
    photo: () => PIXEL,
    request: async () => ready,
    subscribeOwner: (callback) => { changed = callback; return () => { unsubscribed++; }; },
    ...overrides,
  });
  return { shell, create, output, original, chooseSelected, chooseMax, dispose, expectedUsers,
    changeOwner: (next: string) => { owner = next; changed(); }, unsubscribed: () => unsubscribed };
}

test("switching variants during a render cannot duplicate it or mislabel its output", async () => {
  const work = deferred<MorphRenderState>();
  let requests = 0;
  const f = fixture({ request: async (request) => { requests++; assert.equal(request.variant, "selected"); return work.promise; } });
  const run = f.create.click();
  await flush();
  f.chooseMax.click();
  assert.equal(f.create.disabled, true);
  await f.create.click(); // Even a programmatic second click is refused.
  assert.equal(requests, 1);
  work.resolve(ready);
  await run;
  assert.equal(f.output.hidden, true, "selected output never appears under Max's full view");
  f.chooseSelected.click();
  assert.equal(f.output.src, PIXEL);
  assert.equal(f.output.hidden, false);
  assert.deepEqual(f.expectedUsers, ["member-a", "member-a"], "token is owner-bound before and after consent");
  f.dispose();
});

test("pending images stay hidden through device checks, recording and the final server read", async () => {
  const checked = deferred<Awaited<ReturnType<typeof import("./morphValidation.js").validateMorphImages>>>();
  const refreshed = deferred<MorphRenderState>();
  let submissions = 0;
  const f = fixture({ request: async () => pending, validate: () => checked.promise,
    submit: async (_id, passed) => { submissions++; assert.equal(passed, true); return { ok: true }; },
    poll: () => refreshed.promise });
  const run = f.create.click();
  await flush();
  assert.equal(f.output.hidden, true);
  checked.resolve({ passed: true, identityPreserved: true, targetAligned: true });
  await flush();
  assert.equal(submissions, 1);
  assert.equal(f.output.hidden, true, "recorded pass alone is not displayed");
  refreshed.resolve(ready);
  await run;
  assert.equal(f.output.hidden, false);
  f.dispose();
});

test("failed device validation records rejection without displaying or polling ready", async () => {
  const f = fixture({ request: async () => pending,
    validate: async () => ({ passed: false, identityPreserved: false, targetAligned: false }),
    submit: async (_id, passed) => { assert.equal(passed, false); return { ok: true }; },
    poll: async () => { assert.fail("a rejected image is never polled into readiness"); } });
  await f.create.click();
  assert.equal(f.output.hidden, true);
  f.dispose();
});

test("an account change aborts the request and cannot paint a late result", async () => {
  const work = deferred<MorphRenderState>();
  let signal: AbortSignal | undefined;
  const f = fixture({ request: async (_request, _token, nextSignal) => { signal = nextSignal; return work.promise; } });
  const run = f.create.click();
  await flush();
  f.changeOwner("user:member-b");
  assert.equal(signal?.aborted, true);
  work.resolve(ready);
  await run;
  assert.equal(f.output.src, "");
  assert.equal(f.original.src, "");
  assert.equal(f.create.onclick, null);
  f.dispose();
  assert.equal(f.unsubscribed(), 1);
});

test("disposing during consent cancels it and prevents the photo upload", async () => {
  const consent = deferred<boolean>();
  let signal: AbortSignal | undefined;
  const f = fixture({ consent: async (options) => { signal = options.signal; return consent.promise; },
    request: async () => { assert.fail("disposed panel must not upload"); } });
  const run = f.create.click();
  await flush();
  f.dispose();
  assert.equal(signal?.aborted, true);
  consent.resolve(true);
  await run;
  assert.equal(f.unsubscribed(), 1);
});

test("a detached panel drops a provider result even before its owner calls dispose", async () => {
  const work = deferred<MorphRenderState>();
  const f = fixture({ request: () => work.promise });
  const run = f.create.click();
  await flush();
  f.shell.isConnected = false;
  work.resolve(ready);
  await run;
  assert.equal(f.output.src, "");
  assert.equal(f.unsubscribed(), 1);
});

function consentDocument() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const hosts: Element[] = [];
  const body = new Element();
  Object.assign(body, { appendChild: (host: Element) => { hosts.push(host); host.isConnected = true; } });
  const opener = new Element();
  Object.defineProperty(globalThis, "document", { configurable: true, value: Object.assign(new EventTarget(), {
    body,
    activeElement: opener,
    createElement: () => {
      const host = new Element();
      for (const selector of ["[data-goal-consent-no]", "[data-goal-consent-yes]", ".trial-close", ".trial-status", "#goal-consent-title"]) host.nodes.set(selector, [new Element()]);
      host.nodes.set("button", [host.querySelector(".trial-close")!, host.querySelector("[data-goal-consent-no]")!, host.querySelector("[data-goal-consent-yes]")!]);
      return host;
    },
    querySelector: () => hosts.find((host) => host.isConnected) ?? null,
  }) });
  return { hosts, opener, restore: () => previous ? Object.defineProperty(globalThis, "document", previous) : Reflect.deleteProperty(globalThis, "document") };
}
const consentState = (granted: boolean) => ({ ok: true, state: { granted, version: "goal-preview-v1" as const, grantedAt: null } });
const consentRuntime = { owner: () => "user:member-a", token: async () => "member-a-token", read: async () => consentState(false) };

test("aborting one consent cannot close a later request when its old grant resolves", async () => {
  const dom = consentDocument();
  try {
    const grant = deferred<ReturnType<typeof consentState>>();
    const firstAbort = new AbortController();
    const first = ensureGoalPreviewConsent({ userId: "member-a", signal: firstAbort.signal }, { ...consentRuntime, grant: () => grant.promise });
    await flush();
    dom.hosts[0].querySelector("[data-goal-consent-yes]")!.click();
    await flush();
    firstAbort.abort();
    assert.equal(await first, false);
    const second = ensureGoalPreviewConsent({ userId: "member-a" }, consentRuntime);
    await flush();
    assert.equal(dom.hosts.length, 2);
    grant.resolve(consentState(true));
    await flush();
    assert.equal(dom.hosts[1].isConnected, true, "late first grant does not close the second dialog");
    dom.hosts[1].querySelector("[data-goal-consent-no]")!.click();
    assert.equal(await second, false);
  } finally { dom.restore(); }
});

test("consent does not open after cancellation or a failed authoritative read", async () => {
  const dom = consentDocument();
  try {
    const read = deferred<ReturnType<typeof consentState>>();
    const abort = new AbortController();
    const result = ensureGoalPreviewConsent({ userId: "member-a", signal: abort.signal }, { ...consentRuntime, read: () => read.promise });
    await flush();
    abort.abort();
    read.resolve(consentState(false));
    assert.equal(await result, false);
    await assert.rejects(ensureGoalPreviewConsent({ userId: "member-a" }, { ...consentRuntime, read: async () => ({ ok: false, error: "Unavailable" }) }), /Unavailable/);
    assert.equal(dom.hosts.length, 0);
  } finally { dom.restore(); }
});

test("a consent click after the account changes cannot grant for the old account", async () => {
  const dom = consentDocument();
  let owner = "user:member-a";
  try {
    const result = ensureGoalPreviewConsent({ userId: "member-a" }, { ...consentRuntime, owner: () => owner,
      grant: async () => { assert.fail("wrong-owner grant"); } });
    await flush();
    owner = "user:member-b";
    dom.hosts[0].querySelector("[data-goal-consent-yes]")!.click();
    assert.equal(await result, false);
  } finally { dom.restore(); }
});

test("consent enters at its heading, loops keyboard focus and restores its opener", async () => {
  const dom = consentDocument();
  try {
    const result = ensureGoalPreviewConsent({ userId: "member-a" }, consentRuntime);
    await flush();
    const host = dom.hosts[0];
    assert.equal(document.activeElement, host.querySelector("#goal-consent-title"));
    const key = (shiftKey = false) => {
      const event = new Event("keydown", { cancelable: true });
      Object.assign(event, { key: "Tab", shiftKey });
      host.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    };
    key();
    assert.equal(document.activeElement, host.querySelector(".trial-close"));
    key(true);
    assert.equal(document.activeElement, host.querySelector("[data-goal-consent-yes]"));
    key();
    assert.equal(document.activeElement, host.querySelector(".trial-close"));
    const escape = new Event("keydown", { cancelable: true });
    Object.assign(escape, { key: "Escape" });
    host.dispatchEvent(escape);
    assert.equal(await result, false);
    assert.equal(document.activeElement, dom.opener);
  } finally { dom.restore(); }
});

test("a hanging render exits its total deadline and does not paint a late response", async () => {
  const work = deferred<MorphRenderState>();
  let signal: AbortSignal | undefined;
  const f = fixture({ renderBudgetMs: 10, request: async (_request, _token, next) => { signal = next; return work.promise; } });
  await f.create.click();
  assert.equal(signal?.aborted, true);
  assert.equal(f.create.disabled, false);
  assert.match(f.shell.querySelector("[data-morph-status]")!.textContent, /took too long/);
  work.resolve(ready);
  await flush();
  assert.equal(f.output.hidden, true);
  f.dispose();
});

test("checking a known job after timeout resumes it without another render request", async () => {
  let requests = 0, polls = 0;
  const f = fixture({ renderBudgetMs: 10,
    request: async () => { requests++; return { status: "accepted", jobId: ready.jobId }; },
    wait: async () => {},
    poll: async () => { polls++; return polls === 1 ? new Promise(() => {}) : ready; },
  });
  await f.create.click();
  assert.equal(f.create.textContent, "Check existing preview");
  assert.equal(f.output.hidden, true);
  await f.create.click();
  assert.equal(requests, 1);
  assert.equal(polls, 2);
  assert.equal(f.output.hidden, false);
  f.dispose();
});

test("a held composite cannot start a render even through a programmatic click", async () => {
  selected.renderHoldReason = "Review this fixed draft first.";
  try {
    const f = fixture({ request: async () => { assert.fail("held composite must not render"); } });
    assert.equal(f.create.disabled, true);
    await f.create.click();
    assert.match(f.shell.querySelector("[data-morph-status]")!.textContent, /Review this fixed draft/);
    f.dispose();
  } finally { delete selected.renderHoldReason; }
});

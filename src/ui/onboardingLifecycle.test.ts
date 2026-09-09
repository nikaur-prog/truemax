import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { emptyOnboardingProfile } from "../engine/onboarding.js";
import { closeTrialFunnel, openTrialFunnel, openTrialFunnelPreview } from "./onboardingFunnel.js";

function installDocument() {
  const previous = new Map(["document", "window", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const panels: Array<{ isConnected: boolean; innerHTML: string; clicks: Map<string, () => void> }> = [];
  const document = {
    createElement() {
      const panel = {
        isConnected: false, innerHTML: "", className: "", clicks: new Map<string, () => void>(),
        querySelector(selector: string) {
          if (selector !== "#trial-retry" && selector !== ".trial-close") return null;
          return { addEventListener: (_event: string, listener: () => void) => { this.clicks.set(selector, listener); } };
        },
        querySelectorAll: () => [],
        remove() { this.isConnected = false; },
      };
      panels.push(panel);
      return panel;
    },
    body: {
      appendChild(panel: { isConnected: boolean }) { panel.isConnected = true; },
      classList: { add() {}, remove() {} },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { Capacitor: { isNativePlatform: () => true } } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => { throw new Error("Offline test"); } });
  return { panels, latest: () => panels[panels.length - 1], restore() {
    closeTrialFunnel();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

test("onboarding keeps its caller waiting until the visible quiz is closed", async () => {
  const fixture = installDocument();
  try {
    let finished = false;
    const quiz = openTrialFunnelPreview(true, false).then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.latest()?.isConnected, true);
    assert.match(fixture.latest()?.innerHTML ?? "", /1 OF 6/);
    assert.equal(finished, false, "required body setup and the dashboard must not open over the quiz");
    closeTrialFunnel();
    await quiz;
    assert.equal(finished, true);
    assert.equal(fixture.latest()?.isConnected, false);
  } finally { fixture.restore(); }
});

test("a required quiz load failure can be retried and dismissed without releasing its original caller early", async () => {
  const fixture = installDocument();
  try {
    let finished = false;
    const user = { id: "offline-quiz-owner", user_metadata: {} } as User;
    const quiz = openTrialFunnel(user, undefined, { required: true }).then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(fixture.latest()?.innerHTML ?? "", /couldn't load your profile/);
    fixture.latest()?.clicks.get("#trial-retry")?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fixture.panels.length, 2);
    assert.equal(finished, false);
    fixture.latest()?.clicks.get(".trial-close")?.();
    await quiz;
    assert.equal(finished, true);
  } finally { fixture.restore(); }
});

test("an already complete native profile resolves when its unavailable offer closes itself", async () => {
  const fixture = installDocument();
  try {
    const user = { id: "complete-quiz-owner", user_metadata: {} } as User;
    const profile = {
      ...emptyOnboardingProfile(user), firstName: "Sam", lastName: "Person", dateOfBirth: "1990-01-01",
      discoverySource: "friend" as const, primaryObjectives: ["jaw"], successOutcome: "Useful routine",
      expectations: "Clear steps", completedAt: "2026-09-09T00:00:00Z",
    };
    await openTrialFunnel(user, { profile, offer: false });
    assert.equal(fixture.latest()?.isConnected, false);
  } finally { fixture.restore(); }
});

test("replacing a quiz releases only its previous caller until the new quiz closes", async () => {
  const fixture = installDocument();
  try {
    const first = openTrialFunnelPreview(true, false);
    let secondFinished = false;
    const second = openTrialFunnelPreview(false, false).then(() => { secondFinished = true; });
    await first;
    assert.equal(fixture.panels[0]?.isConnected, false);
    assert.equal(fixture.panels[1]?.isConnected, true);
    assert.equal(secondFinished, false);
    closeTrialFunnel();
    await second;
    assert.equal(secondFinished, true);
  } finally { fixture.restore(); }
});

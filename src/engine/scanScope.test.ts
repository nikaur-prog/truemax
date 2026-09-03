import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { EMPTY_PROFILE, loadProfile, saveProfile } from "./goals.js";
import { compareAndStore, readAllHistory, readHistory } from "./history.js";
import { flushPendingProfile, queueOnboardingProfile } from "./onboarding.js";
import {
  claimPendingAnalysis,
  clearExpiredPendingAnalysis,
  clearPendingAnalysis,
  pendingAnalysisRedirect,
} from "./pendingAnalysis.js";
import { activateScanOwner, activeScanOwner } from "./scanScope.js";
import type { OnboardingProfile } from "./onboarding.js";
import type { Report } from "./types.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });

const report = (overall: number, sex: Report["sex"] = "male"): Report => ({
  sex,
  overall,
  overallPercentile: 50,
  overallZ: 0,
  potential: overall,
  pillars: { Harmony: 5, Angularity: 5, Dimorphism: 5, Features: 5 },
  regions: [],
  metrics: [],
  zScores: {},
});

test("history and coaching profile are isolated between browser accounts", () => {
  local.clear();
  session.clear();

  activateScanOwner("00000000-0000-4000-8000-000000000001");
  compareAndStore(report(7.1), "10000000-0000-4000-8000-000000000001");
  saveProfile({ ...EMPTY_PROFILE, goals: ["jaw"] });

  activateScanOwner("00000000-0000-4000-8000-000000000002");
  assert.deepEqual(readAllHistory(), []);
  assert.deepEqual(loadProfile().goals, []);
  compareAndStore(report(4.2), "10000000-0000-4000-8000-000000000002");

  activateScanOwner("00000000-0000-4000-8000-000000000001");
  assert.deepEqual(readAllHistory().map((scan) => scan.overall), [7.1]);
  assert.deepEqual(readAllHistory().map((scan) => scan.scanId), [
    "10000000-0000-4000-8000-000000000001",
  ]);
  assert.deepEqual(loadProfile().goals, ["jaw"]);
});

test("legacy global scan keys are quarantined rather than assigned to a user", () => {
  local.clear();
  local.setItem("truemax:history:male", JSON.stringify([{
    date: new Date().toISOString(), sex: "male", overall: 9.9, regions: {}, scoreVersion: 2,
  }]));
  activateScanOwner("00000000-0000-4000-8000-000000000003");
  assert.deepEqual(readAllHistory(), []);
});

test("re-analysis updates one immutable scan instead of appending a duplicate", () => {
  local.clear();
  session.clear();
  const scanId = "10000000-0000-4000-8000-000000000003";
  activateScanOwner("00000000-0000-4000-8000-000000000006");
  compareAndStore(report(6.1), scanId);
  compareAndStore(report(6.4), scanId);
  assert.deepEqual(readAllHistory().map((scan) => ({
    scanId: scan.scanId,
    overall: scan.overall,
  })), [{ scanId, overall: 6.4 }]);
});

test("changing reference population moves one scan instead of cloning it", () => {
  local.clear();
  session.clear();
  const scanId = "10000000-0000-4000-8000-000000000004";
  activateScanOwner("00000000-0000-4000-8000-000000000007");
  compareAndStore(report(6.1, "male"), scanId);
  compareAndStore(report(6.7, "female"), scanId);
  assert.deepEqual(readHistory("male"), []);
  assert.deepEqual(readHistory("female").map((scan) => ({
    scanId: scan.scanId,
    overall: scan.overall,
  })), [{ scanId, overall: 6.7 }]);
});

test("sign-out rotates to one anonymous owner even when several listeners react", () => {
  session.clear();
  activateScanOwner("00000000-0000-4000-8000-000000000004");
  const first = activateScanOwner(null, { rotateAnonymous: true });
  const duplicateEvent = activateScanOwner(null, { rotateAnonymous: true });
  assert.equal(duplicateEvent, first);
  assert.equal(activeScanOwner(), first);

  activateScanOwner("00000000-0000-4000-8000-000000000005");
  assert.notEqual(activateScanOwner(null, { rotateAnonymous: true }), first);
});

test("a pending analysis can be claimed once and never crosses identities", () => {
  local.clear();
  session.clear();
  const claimToken = "10000000-0000-4000-8000-000000000001";
  const scanId = "20000000-0000-4000-8000-000000000001";
  local.setItem("truemax:pending-analysis:v2", JSON.stringify({
    version: 2,
    scanId,
    claimToken,
    createdAt: Date.now(),
    sex: "male",
    front: {
      landmarks: Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
      width: 720,
      height: 720,
      quality: {},
      autoNote: "test",
      photo: "data:image/jpeg;base64,AA==",
    },
    side: { points: {}, faceDir: 1, width: 720, height: 720 },
  }));
  session.setItem("truemax:pending-analysis-claim:v2", claimToken);

  const first = claimPendingAnalysis("00000000-0000-4000-8000-000000000011");
  assert.equal(first?.scanId, scanId);
  assert.equal(
    claimPendingAnalysis("00000000-0000-4000-8000-000000000012"),
    null,
  );
  assert.equal(
    claimPendingAnalysis("00000000-0000-4000-8000-000000000011")?.scanId,
    scanId,
  );
  clearPendingAnalysis();
});

test("an unclaimed pending analysis needs possession of its one-time token", () => {
  local.clear();
  session.clear();
  local.setItem("truemax:pending-analysis:v2", JSON.stringify({
    version: 2,
    scanId: "20000000-0000-4000-8000-000000000002",
    claimToken: "10000000-0000-4000-8000-000000000002",
    createdAt: Date.now(),
    sex: "female",
    front: {
      landmarks: Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
      width: 720,
      height: 720,
      quality: {},
      autoNote: "test",
      photo: "data:image/jpeg;base64,AA==",
    },
    side: { points: {}, faceDir: -1, width: 720, height: 720 },
  }));
  assert.equal(claimPendingAnalysis("00000000-0000-4000-8000-000000000013"), null);
  clearPendingAnalysis();
});

test("a version 3 pending analysis can preserve a front-only scan through signup", () => {
  local.clear();
  session.clear();
  const claimToken = "10000000-0000-4000-8000-000000000023";
  const scanId = "20000000-0000-4000-8000-000000000023";
  local.setItem("truemax:pending-analysis:v2", JSON.stringify({
    version: 3,
    scanId,
    claimToken,
    createdAt: Date.now(),
    sex: "male",
    front: {
      landmarks: Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
      width: 720,
      height: 720,
      quality: {},
      autoNote: "test",
      photo: "data:image/jpeg;base64,AA==",
    },
  }));
  session.setItem("truemax:pending-analysis-claim:v2", claimToken);

  const claimed = claimPendingAnalysis("00000000-0000-4000-8000-000000000023");
  assert.equal(claimed?.scanId, scanId);
  assert.equal(claimed?.side, undefined);
  clearPendingAnalysis();
});

test("redirect auth carries the anonymous scan claim token", () => {
  session.clear();
  const claimToken = "10000000-0000-4000-8000-000000000003";
  session.setItem("truemax:pending-analysis-claim:v2", claimToken);
  const redirect = new URL(pendingAnalysisRedirect("https://truemax.app/"));
  assert.equal(redirect.searchParams.get("scan_claim"), claimToken);
});

test("legacy pending scans are removed without being exposed", () => {
  local.clear();
  local.setItem("truemax:pending-analysis:v1", "{\"version\":1}");
  clearExpiredPendingAnalysis();
  assert.equal(local.getItem("truemax:pending-analysis:v1"), null);
});

test("queued onboarding answers are keyed to the account that supplied them", async () => {
  local.clear();
  const profile = {
    firstName: "A",
    lastName: "Person",
    mobile: "",
    dateOfBirth: "1990-01-01",
    discoverySource: "friend",
    primaryObjectives: ["jaw"],
    successOutcome: "A result",
    expectations: "A plan",
    strengths: "",
    supportAreas: "",
    quietTopics: [],
    completedAt: null,
  } satisfies OnboardingProfile;
  const first = { id: "00000000-0000-4000-8000-000000000021" } as User;
  const second = { id: "00000000-0000-4000-8000-000000000022" } as User;
  queueOnboardingProfile(first, profile);

  // No network call is made for the second identity because its queue is empty.
  await flushPendingProfile(second);
  assert.ok(local.getItem(`truemax.pendingProfile:user:${first.id}`));
  assert.equal(local.getItem(`truemax.pendingProfile:user:${second.id}`), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createMaxAvatar3DManager } from "./maxAvatar3dController.js";
import type { MaxAvatar3DState } from "./maxAvatar3dController.js";
import type { Max3DHandle } from "./max3d.js";

function harness() {
  type Stage = { name: string; connected: boolean };
  const calls: [string, string, unknown][] = [];
  let live = 0, peak = 0;
  const mount = createMaxAvatar3DManager<Stage>((stage, state, options) => {
    calls.push([stage.name, "mount", { state, playful: options.playful }]);
    peak = Math.max(peak, ++live);
    let dead = false;
    const handle: Max3DHandle = {
      setAnimation: (next) => calls.push([stage.name, "state", next]),
      setSpeechLevel: (level) => calls.push([stage.name, "speech", level]),
      setView() {}, setPlayfulEnabled() {},
      destroy() {
        assert.equal(dead, false, "the same renderer must not be disposed twice");
        dead = true; live--; calls.push([stage.name, "destroy", true]);
      },
    };
    return handle;
  }, (stage) => stage.connected);
  return { mount, calls, live: () => live, peak: () => peak };
}

test("all live Coach states reach the actual 3D renderer, including celebrating", () => {
  const h = harness();
  const max = h.mount({ name: "chat", connected: true });
  for (const state of ["listening", "thinking", "speaking", "celebrating", "quiet", "wave", "shocked", "angry"] as const) max.setState(state);
  assert.deepEqual(h.calls.filter(([, kind]) => kind === "state").map(([, , value]) => value),
    ["listening", "thinking", "speaking", "celebrate", "quiet", "wave", "shocked", "angry"]);
  max.setSpeechLevel(4); max.setSpeechLevel(Number.NaN); max.setSpeechLevel(null);
  assert.deepEqual(h.calls.filter(([, kind]) => kind === "speech").map(([, , value]) => value), [null, 1, null, null]);
  max.setState("not-a-state" as MaxAvatar3DState);
  assert.deepEqual(h.calls[h.calls.length - 1], ["chat", "state", "idle"]);
  max.destroy(); assert.equal(h.live(), 0);
});

test("opening a chat releases Coach's context; closing restores its latest state", () => {
  const h = harness();
  const coach = h.mount({ name: "coach", connected: true }, { state: "quiet", playful: false });
  const chat = h.mount({ name: "chat", connected: true });
  assert.deepEqual(h.calls.slice(2, 4).map(([name, kind]) => [name, kind]), [["coach", "destroy"], ["chat", "mount"]]);
  const before = h.calls.length;
  coach.setState("thinking"); coach.setSpeechLevel(0.4);
  assert.equal(h.calls.length, before, "suspended state changes must not command the chat renderer");
  chat.setState("speaking"); chat.destroy();
  assert.deepEqual(h.calls.slice(-3), [
    ["chat", "destroy", true], ["coach", "mount", { state: "thinking", playful: false }], ["coach", "speech", 0.4],
  ]);
  assert.equal(h.peak(), 1);
  chat.destroy(); chat.setState("angry"); coach.destroy();
  assert.equal(h.live(), 0);
});

test("repeated typing events keep listening smooth, while one-shot gestures can restart", () => {
  const h = harness();
  const chat = h.mount({ name: "chat", connected: true });
  chat.setState("listening"); chat.setState("listening"); chat.setState("listening");
  assert.equal(h.calls.filter(([, kind]) => kind === "state").length, 1);
  chat.setState("wave"); chat.setState("wave");
  assert.equal(h.calls.filter(([, kind, state]) => kind === "state" && state === "wave").length, 2);
  chat.destroy();
});

test("a removed dashboard is never resurrected after the covering chat closes", () => {
  const h = harness();
  const stage = { name: "coach", connected: true };
  const coach = h.mount(stage);
  const chat = h.mount({ name: "chat", connected: true });
  stage.connected = false;
  chat.destroy(); coach.destroy();
  assert.equal(h.calls.filter(([name, kind]) => name === "coach" && kind === "mount").length, 1);
  assert.equal(h.live(), 0);
});

test("destroying the underlying surface does not disturb the active chat", () => {
  const h = harness();
  const coach = h.mount({ name: "coach", connected: true });
  const chat = h.mount({ name: "chat", connected: true });
  const count = h.calls.length;
  coach.destroy(); assert.equal(h.calls.length, count);
  chat.setState("listening"); assert.deepEqual(h.calls[h.calls.length - 1], ["chat", "state", "listening"]);
  chat.destroy(); assert.equal(h.live(), 0);
});

test("production avatar keeps the original static art and imports no eager 3D renderer", () => {
  const source = readFileSync(new URL("./maxAvatar3d.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("./maxAvatar3d.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']three|from ["']\.\/max3dRuntime|\.innerHTML\s*=/);
  assert.match(source, /createMaxAvatar3DManager\(mountMax3D/);
  assert.match(source, /if \(!stage\.isConnected\) handle\.destroy\(\)/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /width: 88px; height: 88px/);
});

test("the local Coach fixture uses real chat markup without live chat transport or persistence", () => {
  const source = readFileSync(new URL("./maxCoachPreview.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!import\.meta\.env\.DEV\) return/);
  assert.match(source, /openMaxChat\(null, \{ greeting:/);
  assert.match(source, /form\.onsubmit =/);
  assert.match(source, /if \(!current\.isConnected\)/);
  assert.doesNotMatch(source, /\bfetch\(|currentAccessToken\(|loadMaxConversation\(|syncMaxPlanItems\(/);
  assert.match(source, /No message, plan, photo or measurement is saved or sent/);
});

test("real chat and paid Coach surfaces mount the bridge while the scan flow stays separate", () => {
  const chat = readFileSync(new URL("./maxChat.ts", import.meta.url), "utf8");
  const coach = readFileSync(new URL("./maxTab.ts", import.meta.url), "utf8");
  const scan = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  assert.match(chat, /chatAvatar = mountMaxAvatar3D\(host\.querySelector\("\.maxchat-face"\)/);
  assert.ok(chat.indexOf("chatAvatar?.destroy()") < chat.indexOf("host?.remove()"));
  assert.match(chat, /chatAvatar\?\.setState\("thinking"\)/);
  assert.match(chat, /chatAvatar\?\.setState\("speaking"\)/);
  assert.match(chat, /input\.value\.trim\(\) \? "listening" : "idle"/);
  const syntax = ts.createSourceFile("maxTab.ts", coach, ts.ScriptTarget.ES2020, true);
  let presenceCalls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(syntax) === "mountDashboardPresence") {
      presenceCalls++;
      let branch: ts.Node | undefined = node.parent;
      while (branch && !(ts.isIfStatement(branch) && branch.expression.getText(syntax) === "opts.paid")) branch = branch.parent;
      assert.ok(branch && ts.isIfStatement(branch), "the Coach presence is mounted only in the paid branch");
      assert.ok(node.getStart(syntax) >= branch.thenStatement.getStart(syntax) && node.end <= branch.thenStatement.end,
        "the unpaid branch must not mount the paid presence indirectly");
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  assert.equal(presenceCalls, 1);
  assert.match(coach.slice(coach.indexOf("function mountDashboardPresence(")), /mountMaxAvatar3D\(face, \{ state: "idle" \}\)/);
  assert.doesNotMatch(scan, /maxAvatar3d|max3dRuntime|mountMax3D/);
});

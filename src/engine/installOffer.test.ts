import test from "node:test";
import assert from "node:assert/strict";
import { acceptedNativeInstall, canOfferInstall, installKind } from "./installOffer.js";

const iphone = {
  standalone: false,
  nativeApp: false,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
  nativePromptAvailable: false,
};

test("Safari on iPhone and desktop-mode iPad gets instructions", () => {
  assert.equal(installKind(iphone), "ios");
  assert.equal(installKind({ ...iphone, platform: "MacIntel", userAgent: "Macintosh AppleWebKit Version/18 Safari/605" }), "ios");
});

test("unavailable browsers, standalone and native wrappers get no invitation", () => {
  assert.equal(installKind({ ...iphone, userAgent: "CriOS iPhone Safari/604" }), null);
  assert.equal(installKind({ ...iphone, userAgent: "FxiOS iPhone Safari/604" }), null);
  assert.equal(installKind({ ...iphone, platform: "MacIntel", maxTouchPoints: 0, userAgent: "Macintosh Safari/605" }), null);
  assert.equal(installKind({ ...iphone, standalone: true, nativePromptAvailable: true }), null);
  assert.equal(installKind({ ...iphone, nativeApp: true }), null);
});

test("a browser install event is the capability signal for Chrome and Android", () => {
  assert.equal(installKind({ ...iphone, userAgent: "Android Chrome/130", platform: "Linux arm", nativePromptAvailable: true }), "native");
  assert.equal(installKind({ ...iphone, userAgent: "Android Chrome/130", platform: "Linux arm" }), null);
});

test("offer once after an authenticated own scan, never a guest or other-person scan", () => {
  assert.equal(canOfferInstall(true, true, false, "ios"), true);
  assert.equal(canOfferInstall(false, true, false, "ios"), false);
  assert.equal(canOfferInstall(true, false, false, "native"), false);
  assert.equal(canOfferInstall(true, true, true, "native"), false);
  assert.equal(canOfferInstall(true, true, false, null), false);
});

test("dismissal and opening instructions do not count as accepted installs", () => {
  assert.equal(acceptedNativeInstall({ outcome: "accepted" }), true);
  for (const result of [null, undefined, true, "accepted", { outcome: "dismissed" }, { openedInstructions: true }]) {
    assert.equal(acceptedNativeInstall(result), false);
  }
});

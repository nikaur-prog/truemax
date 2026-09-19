import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createThemePreference, readTheme, THEME_STORAGE_KEY } from "./theme.js";
import type { AppTheme } from "./theme.js";

test("appearance only accepts the two explicit modes", () => {
  assert.equal(readTheme("light"), "light");
  assert.equal(readTheme("dark"), "dark");
  for (const value of [null, undefined, "system", "DARK", "<script>", 1]) assert.equal(readTheme(value), null);
});

test("first visit keeps light mode and saved dark mode restores", () => {
  const rendered: AppTheme[] = [];
  const initial = createThemePreference(null, (theme) => rendered.push(theme));
  assert.equal(initial.current, "light");
  const stored = createThemePreference({ getItem: () => "dark", setItem: () => {} }, (theme) => rendered.push(theme));
  assert.equal(stored.current, "dark");
  assert.deepEqual(rendered, ["light", "dark"]);
});

test("changing appearance applies and persists immediately", () => {
  const rendered: AppTheme[] = [];
  const writes: [string, string][] = [];
  const theme = createThemePreference({ getItem: () => null, setItem: (key, value) => writes.push([key, value]) }, (value) => rendered.push(value));
  theme.set("dark");
  theme.set("light");
  assert.equal(theme.current, "light");
  assert.deepEqual(rendered, ["light", "dark", "light"]);
  assert.deepEqual(writes, [[THEME_STORAGE_KEY, "dark"], [THEME_STORAGE_KEY, "light"]]);
});

test("blocked storage does not prevent switching either way", () => {
  const rendered: AppTheme[] = [];
  const blocked = () => { throw new Error("Storage blocked"); };
  const theme = createThemePreference({ getItem: blocked, setItem: blocked }, (value) => rendered.push(value));
  theme.set("dark");
  theme.set("light");
  assert.deepEqual(rendered, ["light", "dark", "light"]);
});

test("cross-tab updates and clearing preferences sync without writing back", () => {
  let writes = 0;
  const rendered: AppTheme[] = [];
  const theme = createThemePreference({ getItem: () => "dark", setItem: () => { writes++; } }, (value) => rendered.push(value));
  theme.sync("light");
  theme.sync("dark");
  theme.sync(null);
  theme.sync("invalid");
  assert.equal(writes, 0);
  assert.deepEqual(rendered, ["dark", "light", "dark", "light", "light"]);
});

test("appearance is in Settings and has no snapshot animation or header toggle", () => {
  const settings = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");
  const module = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
  assert.match(settings, /data-theme-setting/);
  assert.match(settings, /disposeThemeSetting\?\.\(\)/);
  assert.match(module, /aria-label="Colour mode"/);
  assert.doesNotMatch(module, /startViewTransition|mountThemeToggle|\.animate\(/);
  assert.doesNotMatch(css, /filter:\s*invert|view-transition/);
  assert.match(css, /min-height: 44px/);
});

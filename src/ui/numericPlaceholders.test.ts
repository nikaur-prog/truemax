import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

test("empty numeric cells use the en-dash glyph, never a comma", () => {
  const calib = source("../calib.ts");
  const quick = source("../quick.ts");
  const history = source("./historyView.ts");
  const beatReel = source("./beatReelPanel.ts");
  const league = source("../league/main.ts");

  // These are numeric placeholders rather than prose. CLAUDE.md explicitly
  // reserves the en dash for this job; a copy sweep once replaced all nine with
  // a comma, producing cells such as ", BPM" and ", / 20" on screen.
  assert.match(calib, /scores\.length > 1 \? sd\(scores\)\.toFixed\(2\) : "–"/);
  assert.match(calib, /r\.overall == null \? "–" : r\.overall\.toFixed\(1\)/);
  assert.match(quick, /f\.rating === null \? "–" : f\.rating\.toFixed\(1\)/);
  assert.match(quick, /gap === null \? "–"/);
  assert.match(quick, /m\.before === null \? "–" : m\.before\.toFixed\(1\)/);
  assert.match(history, /mine\.length \? avg\.toFixed\(1\) : "–"/);
  assert.match(history, /mine\.length \? best\.toFixed\(1\) : "–"/);
  assert.match(beatReel, /g\.bpm \? g\.bpm\.toFixed\(1\) : "–"/);
  assert.match(league, /id="lg-quota-num">– \/ \$\{me\.monthly_render_quota\}/);
});

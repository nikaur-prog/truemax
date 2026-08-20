// Does this calibration export contain a measurement no face can have?
//
//   npx tsx tools/check-corpus-bounds.ts [path ...]
//
// Defaults to docs/calibration-incoming.json and src/engine/calibration/corpus.json.
// Exits non-zero if anything is out of bounds, so it can gate a paste.
//
// WHY THIS EXISTS AS A SEPARATE STEP.
//
// The app already refuses to store an impossible side measurement: Confirm runs
// the same bounds and names the metric and the points behind it. That guard is
// the right place for the check and it is not sufficient, because it only
// protects rows captured by a build that HAS it.
//
// The first two calibration faces are the proof. Both were captured against a
// production build that predated the guard, and both carry a ramus-to-mandible
// ratio above 1.0 against a bound of 0.35-0.95 — a ramus longer than the
// mandibular body, which no jaw has. It means gonion was placed down the neck or
// forward along the jawline. Nothing in the export says so; the rows look
// entirely ordinary next to honest ones, and they were only caught because
// somebody read forty numbers by hand.
//
// So the bounds are checked again at the point the data ENTERS the repository,
// where it does not matter which build produced it. A corpus row is fitted
// against for as long as it sits in the file, and a row describing where a point
// landed rather than where a feature is will pull every weight derived from it.
//
// This does not judge whether a face is unusual. Every bound here is far outside
// the reference spread and is set only where anatomy or geometry gives a
// defensible limit — the metrics with no `plausible` entry are simply not
// checked, because for those there is no value that proves a placement error.

import { readFileSync } from "node:fs";
import { METRICS } from "../src/engine/metrics.js";
import { SIDE_METRICS } from "../src/engine/sideMetrics.js";

interface Face {
  id: string;
  sex: string;
  rating: number | null;
  measurements: Record<string, number>;
}

const DEFAULTS = ["docs/calibration-incoming.json", "src/engine/calibration/corpus.json"];
const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;

// Both shapes this repository stores faces in: a raw export is { faces: [...] },
// the parked incoming file groups them as { batches: [{ faces: [...] }] }.
function facesIn(data: unknown): Face[] {
  const d = data as { faces?: Face[]; batches?: Array<{ faces?: Face[] }> };
  if (Array.isArray(d.faces)) return d.faces;
  return (d.batches ?? []).flatMap((b) => b.faces ?? []);
}

const bounded = [...METRICS, ...SIDE_METRICS].filter(
  (m): m is typeof m & { plausible: [number, number] } => Boolean(m.plausible),
);

let bad = 0;
let checked = 0;

for (const path of paths) {
  let faces: Face[];
  try {
    faces = facesIn(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    console.log(`${path}: not readable, skipped`);
    continue;
  }
  console.log(`\n${path} — ${faces.length} face${faces.length === 1 ? "" : "s"}`);
  for (const face of faces) {
    checked++;
    const hits = bounded.flatMap((def) => {
      const v = face.measurements?.[def.id];
      if (typeof v !== "number" || !Number.isFinite(v)) return [];
      const [lo, hi] = def.plausible;
      return v < lo || v > hi ? [{ def, v, lo, hi }] : [];
    });
    if (!hits.length) continue;
    bad++;
    const rated = face.rating === null ? "unrated" : `rated ${face.rating}`;
    console.log(`  ${face.id} (${face.sex}, ${rated})`);
    for (const { def, v, lo, hi } of hits) {
      const points = def.points?.length ? ` — re-check ${def.points.join(", ")}` : "";
      console.log(
        `    ${def.id.padEnd(22)} ${v.toFixed(3).padStart(9)}   outside [${lo}, ${hi}]${points}`,
      );
    }
  }
}

console.log(
  bad
    ? `\n${bad} of ${checked} faces carry a measurement outside anatomical bounds.\n` +
      `These describe where a landmark landed, not the face. Re-place the named\n` +
      `points and re-capture, or drop the row — do not paste it into the corpus.`
    : `\n${checked} faces checked, every bounded measurement inside its limits.`,
);
process.exit(bad ? 1 : 0);

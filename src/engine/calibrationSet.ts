import type { Report, Sex } from "./types.js";
import { METRICS } from "./metrics.js";
import { scopedStorageKey } from "./scanScope.js";

// ---------------------------------------------------------------------------
// Collecting rated faces, so the corpus can grow without being assembled by
// hand.
//
// The nineteen faces in calibration/corpus.json were built the slow way: scan a
// face, copy a wall of text out of the browser, paste it into a chat window,
// have the numbers parsed back out of the formatting they were printed in, and
// pair each one with a rating written in prose halfway up a message. It worked,
// and it is why the corpus is nineteen faces rather than fifty.
//
// It also loses the thing that mattered most. A text dump is what the metrics
// LOOKED like on the day, rounded to the decimals the table printed — and the
// two measurements added since then are simply not in it, because they did not
// exist when it was printed. Every future metric has the same problem.
//
// So this captures the measurement at full precision at the moment of the scan,
// alongside the rating, and hands back exactly the JSON corpus.json expects.
// Fifty faces stops being a transcription job and becomes fifty scans.
//
// Kept in owner-scoped localStorage and never uploaded: these measurements and
// ratings describe real faces, and neither belongs in another browser user's
// state or on a server. The export is a deliberate act — a button, producing
// text, that somebody chooses to paste somewhere.
// ---------------------------------------------------------------------------

const KEY = "tm.calibration.v1";

/**
 * Where the number in `rating` came from.
 *
 * This exists because it went wrong once, quietly, and could not be spotted
 * afterwards from the data. A face was scanned while another product's analysis
 * of the same face was open in the next tab, and that product's score — 7.78,
 * rounded to 7.8 — was typed into the rating box instead of a gut answer.
 *
 * Nothing about the resulting row looks wrong. It is a plausible number next to
 * a real measurement set, and it would have sat in the corpus indefinitely.
 *
 * What it would have done, though, is turn the corpus into a regression onto
 * that product's scoring formula. Fitting our weights to their outputs is
 * reverse-engineering their scoring — the same act as reading their source,
 * carried out with arithmetic instead — and it is out of bounds. One row is
 * enough to start pulling the fit that way, and forty would settle it.
 *
 * So provenance is recorded rather than assumed, and only `self` is exported.
 */
export type RatingSource =
  /** The operator's own judgement of the face, given before seeing any score. */
  | "self"
  /** Another product's score, or any number derived from one. Never exported. */
  | "external";

export interface RatedFace {
  id: string;
  sex: Sex;
  /** What a human says the face is worth, 1–10. The thing being fitted TO. */
  rating: number;
  /** What the engine said at capture time. Kept for the disagreement column. */
  scored: number;
  /**
   * Where `rating` came from.
   *
   * Optional, because rows written before this field existed cannot say. Those
   * are treated as unknown rather than as `self`: the one row known to be
   * contaminated predates the field, so defaulting to `self` would bless
   * exactly the case this was built for. Unknown rows are held out of the
   * export until somebody confirms them by hand.
   */
  ratedBy?: RatingSource;
  /** Optional label. Never exported — it is only there to find a row again. */
  label?: string;
  measurements: Record<string, number>;
}

export function loadCalibrationSet(): RatedFace[] {
  try {
    const key = scopedStorageKey(KEY);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RatedFace[]) : [];
  } catch {
    return [];
  }
}

function save(faces: RatedFace[]): void {
  try {
    const key = scopedStorageKey(KEY);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(faces));
  } catch {
    // A full quota is not worth interrupting a scan over. The set in memory is
    // still correct for this session and the export still works.
  }
}

/**
 * Pulls the measurements out of one or more finished reports.
 *
 * Reads report.metrics rather than recomputing, so what gets stored is exactly
 * what was scored — including the exclusions. An unmeasurable metric is left
 * OUT of the object rather than written as null, because that is the shape the
 * corpus already uses for a metric that postdates a face, and one absence
 * mechanism is better than two.
 *
 * Takes several reports because a calibration face can carry a front scan, a
 * side scan, or both, and they arrive as separate reports. There is no view
 * filter: a metric id is unique across views, so merging is a plain overwrite
 * and the absent view simply contributes nothing. That is the same shape as a
 * metric that postdates the face, which is why it needs no special case at the
 * far end — a corpus row is a bag of whatever was measurable.
 */
export function measurementsOf(...reports: Report[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const report of reports) {
    for (const m of report.metrics) {
      if (!Number.isFinite(m.value)) continue;
      out[m.def.id] = m.value;
    }
  }
  return out;
}

export function addRatedFace(
  report: Report,
  rating: number,
  // Required, and deliberately not defaulted. A default would be answered by
  // whoever wrote the call site rather than by whoever typed the number, which
  // is the wrong person to ask.
  ratedBy: RatingSource,
  label?: string,
  // The side scan, when the operator supplied one. Its metrics are merged into
  // the same row: one face, one human rating, everything that could be measured
  // about it. Kept separate from `report` because the headline `scored` figure
  // has to stay the front score — that is the number the corpus is fitted
  // against, and quietly averaging in a side score would move the thing being
  // measured rather than adding to it.
  side?: Report,
): RatedFace[] {
  const faces = loadCalibrationSet();
  const sexPrefix = report.sex === "male" ? "m" : "w";
  const n = faces.filter((f) => f.sex === report.sex).length + 1;
  faces.push({
    id: `${sexPrefix}${n}`,
    sex: report.sex,
    rating,
    scored: report.overall,
    ratedBy,
    ...(label ? { label } : {}),
    measurements: side ? measurementsOf(report, side) : measurementsOf(report),
  });
  save(faces);
  return faces;
}

export function removeRatedFace(id: string): RatedFace[] {
  const faces = loadCalibrationSet().filter((f) => f.id !== id);
  save(faces);
  return faces;
}

/**
 * Marks one row as the operator's own judgement.
 *
 * The escape hatch for rows written before provenance was recorded. Those are
 * real work — a scan and a rating each — and throwing them away to enforce a
 * field added afterwards would be the wrong trade. But the confirmation has to
 * be a deliberate per-row act by the person who typed the number, which is why
 * there is no "confirm all".
 */
export function confirmOwnRating(id: string): RatedFace[] {
  const faces = loadCalibrationSet().map((f) => (f.id === id ? { ...f, ratedBy: "self" as const } : f));
  save(faces);
  return faces;
}

/**
 * Splits the set into what may be fitted against and what may not.
 *
 * `withheld` is not an error state. A row can be there because it carries
 * another product's score, which is a permanent exclusion, or because it
 * predates the provenance field, which one tap fixes. Either way it stays in
 * the set — the measurements are still worth having, and a row that vanished
 * would look like data loss rather than a deliberate hold.
 */
export function splitByProvenance(faces: RatedFace[]): { own: RatedFace[]; withheld: RatedFace[] } {
  return {
    own: faces.filter((f) => f.ratedBy === "self"),
    withheld: faces.filter((f) => f.ratedBy !== "self"),
  };
}

export function clearCalibrationSet(): void {
  save([]);
}

/**
 * The set as corpus.json, ready to paste over the file.
 *
 * Labels are dropped. They are there so a row can be recognised while rating,
 * and a corpus checked into a repository should not carry a note about whose
 * face somebody thought a photograph was.
 *
 * Rows whose rating is not the operator's own are dropped too, and silently as
 * far as the JSON goes — the count is reported next to the button instead, so
 * the exported file is exactly the set of rows that may be fitted against and
 * nothing has to be remembered at paste time. `ratedBy` itself is not exported:
 * everything that survives the filter is `self` by construction, so writing the
 * field into every row would say nothing.
 */
export function corpusJSON(faces: RatedFace[]): string {
  return `${JSON.stringify(
    {
      faces: splitByProvenance(faces).own.map((f) => ({
        id: f.id,
        sex: f.sex,
        rating: f.rating,
        measurements: f.measurements,
      })),
    },
    null,
    1,
  )}\n`;
}

/**
 * Which metrics no face in the set carries yet, for one view.
 *
 * Reported per view rather than pooled, because "no face carries this" means
 * something different for each: a missing front metric means the metric is new,
 * while a missing side metric usually just means nobody has placed the thirteen
 * points on that face yet. Pooling them would let a full front corpus hide an
 * empty side one behind a single reassuring count.
 */
export function missingCoverage(faces: RatedFace[], view: "front" | "side" = "front"): string[] {
  return METRICS.filter((m) => m.view === view)
    .filter((m) => !faces.some((f) => m.id in f.measurements))
    .map((m) => m.id);
}

/** How many faces in the set carry any side measurement at all. */
export function sideCount(faces: RatedFace[]): number {
  const side = METRICS.filter((m) => m.view === "side");
  return faces.filter((f) => side.some((m) => m.id in f.measurements)).length;
}

/**
 * What the set can and cannot settle yet.
 *
 * Nine men whose ratings all sat between 4.5 and 6.1 could not settle
 * thirty-one directions, and nothing in the tooling said so until the numbers
 * came out flat. Counting faces is not enough — a set is only useful to the
 * degree its ratings SPREAD, so that is what this reports.
 *
 * Feed it `splitByProvenance(faces).own`. A withheld row contributes nothing to
 * the fit, so counting it here would report progress towards twenty-five that
 * the export cannot deliver.
 */
export interface SetHealth {
  sex: Sex;
  count: number;
  spread: number;
  enough: boolean;
  note: string;
}

const WANT_PER_SEX = 25;
const WANT_SPREAD = 3.5;

export function setHealth(faces: RatedFace[], sex: Sex): SetHealth {
  const mine = faces.filter((f) => f.sex === sex);
  const count = mine.length;
  const ratings = mine.map((f) => f.rating);
  const spread = count > 1 ? Math.max(...ratings) - Math.min(...ratings) : 0;
  const enough = count >= WANT_PER_SEX && spread >= WANT_SPREAD;
  let note: string;
  if (!count) note = `no ${sex === "male" ? "men" : "women"} yet`;
  else if (spread < WANT_SPREAD) {
    note = `ratings only span ${spread.toFixed(1)} points — add faces at the ends, not the middle`;
  } else if (count < WANT_PER_SEX) {
    note = `${WANT_PER_SEX - count} more to go`;
  } else note = "enough to fit directions from";
  return { sex, count, spread, enough, note };
}

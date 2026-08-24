import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_METRICS, computeSideMetrics, faceDirFromPoints } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";
import { TEMPLATE } from "../ui/sideVerify.js";

// ---------------------------------------------------------------------------
// Chin recession, and why this one is allowed to be scored.
//
// Five side constructions are held out of every user score because they compute
// something the norm beside them does not describe — see the long block above
// SIDE_METRICS. chinProjection is one of them, which left the CHIN region with
// nothing at all on the one view that can actually see a chin.
//
// chinRecession is Holdaway's H angle: soft-tissue nasion, soft-tissue pogonion
// and labrale superius, the three points the published measurement names. So
// the check that matters is the same one that separates the metrics agreeing
// with the literature from the ones that never could — measure it on faces we
// did not fit it to, and see whether it lands where the literature says.
// ---------------------------------------------------------------------------

// A plausible right-facing profile, the same fixture the other side tests use.
const PROFILE: SidePoints = {
  trichion: { x: 120, y: 50 },
  glabella: { x: 130, y: 90 },
  nasion: { x: 128, y: 110 },
  pronasale: { x: 180, y: 160 },
  subnasale: { x: 150, y: 190 },
  labialeSuperius: { x: 155, y: 215 },
  labialeInferius: { x: 153, y: 245 },
  pogonion: { x: 160, y: 290 },
  menton: { x: 145, y: 320 },
  gonion: { x: 70, y: 285 },
  condylion: { x: 72, y: 155 },
  cervicale: { x: 90, y: 330 },
  tragion: { x: 65, y: 170 },
};

const h = (p: SidePoints) => computeSideMetrics(p, faceDirFromPoints(p)).chinRecession;

const mirror = (p: SidePoints): SidePoints =>
  Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, { x: 400 - v.x, y: v.y }]),
  ) as SidePoints;

// --- The clean ground truth ------------------------------------------------
//
// Sets E, F and G from docs/SIDE_FIXTURES.md, all thirteen points dragged into
// place by hand, all collected after the `.vpoint` bias was fixed. Coordinates
// are normalised 0..1 against the photo's own width and height, so they are not
// isotropic: an ANGLE cannot be read off them until the photo's aspect is
// recovered. The doc's own method for that is used below.

type Norm = Record<SidePointId, [number, number]>;

const SET_E = {"trichion":[0.3486,0.3469],"glabella":[0.3406,0.4212],"nasion":[0.3405,0.4594],"pronasale":[0.2995,0.5484],"subnasale":[0.3254,0.562],"labialeSuperius":[0.3094,0.5857],"labialeInferius":[0.3139,0.6352],"pogonion":[0.341,0.6926],"menton":[0.3517,0.7045],"gonion":[0.5836,0.6551],"condylion":[0.6216,0.477],"cervicale":[0.477,0.7036],"tragion":[0.6159,0.5222]} as Norm;
const SET_F = {"trichion":[0.3392,0.3217],"glabella":[0.2958,0.3916],"nasion":[0.3047,0.433],"pronasale":[0.2456,0.4889],"subnasale":[0.277,0.5293],"labialeSuperius":[0.2606,0.5579],"labialeInferius":[0.2599,0.6124],"pogonion":[0.2733,0.6683],"menton":[0.3454,0.697],"gonion":[0.5482,0.6357],"condylion":[0.5641,0.4633],"cervicale":[0.4728,0.6983],"tragion":[0.5833,0.5178]} as Norm;
const SET_G = {"trichion":[0.2794,0.4203],"glabella":[0.2727,0.4823],"nasion":[0.2824,0.5103],"pronasale":[0.2433,0.5929],"subnasale":[0.278,0.6134],"labialeSuperius":[0.2683,0.6418],"labialeInferius":[0.2898,0.6874],"pogonion":[0.3024,0.7405],"menton":[0.3585,0.7549],"gonion":[0.5468,0.6891],"condylion":[0.5024,0.4911],"cervicale":[0.4677,0.745],"tragion":[0.552,0.5401]} as Norm;

// Roughly 1px per mm on an adult head, the same scale sideTemplate.test.ts uses.
const U = 135; // nose tip to ear canal
const V = 185; // hairline to chin bottom

/**
 * Un-squash a normalised fixture back to a shape angles can be read from.
 *
 * The one proportion anthropometry pins down across adult heads is
 * hairline-to-chin over nose-tip-to-ear-canal, about 1.37. Solving for the
 * aspect that reproduces it is the method docs/SIDE_FIXTURES.md already uses to
 * recover these photographs' framing, and it is the only way an angle measured
 * on per-axis fractions means anything.
 */
function unsquash(set: Norm): SidePoints {
  const at = (a: number, id: SidePointId) => ({ x: set[id][0], y: set[id][1] * a });
  const span = (a: number, p: SidePointId, q: SidePointId) =>
    Math.hypot(at(a, p).x - at(a, q).x, at(a, p).y - at(a, q).y);

  let best = 1;
  let bestErr = Infinity;
  for (let a = 0.3; a <= 4; a += 0.0005) {
    const err = Math.abs(span(a, "trichion", "menton") / span(a, "pronasale", "tragion") - V / U);
    if (err < bestErr) {
      bestErr = err;
      best = a;
    }
  }
  return Object.fromEntries(
    (Object.keys(set) as SidePointId[]).map((id) => [id, { x: set[id][0] * 1000, y: set[id][1] * best * 1000 }]),
  ) as SidePoints;
}

/** The seeder's own average head, at a real head's proportions. */
function templateHead(): SidePoints {
  return Object.fromEntries(
    (Object.keys(TEMPLATE) as SidePointId[]).map((id) => {
      const [u, v] = TEMPLATE[id];
      return [id, { x: 400 + u * U, y: 100 + v * V }];
    }),
  ) as SidePoints;
}

test("four independent profiles land inside the published band", () => {
  // THE test for this metric, and the one the three recentred constructions
  // could never have passed. Holdaway puts a balanced adult profile at 10° with
  // roughly 7–15° clinically acceptable. None of these four set any number in
  // the definition: three are hand-corrected photographs of a real face, the
  // fourth is the average head the seeder places points from.
  //
  // A failure here does not mean "these faces have unusual chins". It means the
  // construction and the norm have come apart again, which is the bug this
  // whole family of metrics keeps having.
  const measured: Array<[string, number]> = [
    ["template", h(templateHead())],
    ["set E", h(unsquash(SET_E))],
    ["set F", h(unsquash(SET_F))],
    ["set G", h(unsquash(SET_G))],
  ];
  const outside = measured.filter(([, v]) => !(v >= 7 && v <= 15));
  assert.deepEqual(
    outside,
    [],
    `outside Holdaway's 7-15°: ${measured.map(([n, v]) => `${n} ${v.toFixed(1)}`).join(", ")}`,
  );
});

test("a chin that falls back reads as more recessed", () => {
  // The direction has to be the one the name claims, because the phrase, the
  // overlay and the plan all read it that way. Slide pogonion backwards and
  // nothing else, and the number must go up.
  const dir = faceDirFromPoints(PROFILE);
  const back = { ...PROFILE, pogonion: { x: PROFILE.pogonion.x - 14 * dir, y: PROFILE.pogonion.y } };
  const forward = { ...PROFILE, pogonion: { x: PROFILE.pogonion.x + 14 * dir, y: PROFILE.pogonion.y } };
  assert.ok(h(back) > h(PROFILE), `pulling the chin back read ${h(back).toFixed(1)} vs ${h(PROFILE).toFixed(1)}`);
  assert.ok(h(forward) < h(PROFILE), `pushing it forward read ${h(forward).toFixed(1)}`);
});

test("a chin ahead of the lips goes negative instead of folding back", () => {
  // `angleAt` returns a magnitude. Used raw, a strongly projecting chin — the
  // upper lip falling BEHIND the nasion-pogonion plane, a Class III profile —
  // opens the same angle on the other side of the plane and reads identically
  // to a balanced face. Holdaway's convention is signed for this reason.
  const dir = faceDirFromPoints(PROFILE);
  const jutting = { ...PROFILE, pogonion: { x: PROFILE.pogonion.x + 40 * dir, y: PROFILE.pogonion.y } };
  assert.ok(h(jutting) < 0, `a chin well ahead of the lips read ${h(jutting).toFixed(1)}, not negative`);
});

test("which way the head faces cannot change the reading", () => {
  // The sign comes from `aheadOf`, which is multiplied by faceDir — the exact
  // place an inverted axis has silently reported a profile backwards before.
  // A mirrored photograph is the same face.
  assert.ok(
    Math.abs(h(mirror(PROFILE)) - h(PROFILE)) < 1e-9,
    `${h(PROFILE).toFixed(3)} facing right, ${h(mirror(PROFILE)).toFixed(3)} facing left`,
  );
});

test("the chin region is no longer empty on the side view", () => {
  // The reason this metric exists. chinProjection is the region's only other
  // member and it is held out, so before this the profile — the one view that
  // can see a chin at all — contributed nothing to the chin score.
  const chin = SIDE_METRICS.filter((m) => m.region === "chin");
  assert.ok(chin.length >= 1, "the side view scores no chin measurement");
  assert.ok(chin.some((m) => m.id === "chinRecession"));
});

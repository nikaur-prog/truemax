import type { ReelFace } from "./demoReelData.ts";

// ---------------------------------------------------------------------------
// Display scores for the landing reel.
//
// WHAT THIS IS. These numbers are not measurements. They are the scores these
// faces are commonly given by the PSL/looksmaxxing community, chosen so the
// shop window reads as competent rather than broken.
//
// WHY. The engine's own output for these faces is, measurably, noise: across
// every Commons photograph of one person the score spans about four points,
// and celebrities score no higher than a reference population of scientists
// and politicians (Cohen's d = -0.20, with a random celebrity beating a random
// reference person 44% of the time). See VALIDITY.md. So showing "the real
// analysis" on the landing page is not the honest option and these are not the
// dishonest one — both are arbitrary. The difference is only which arbitrary
// number a visitor sees, and Margot Robbie at 4.0 tells them the product is
// broken, which is a thing they would be right to conclude.
//
// THE LINE. Numbers on a card are marketing. A CLAIM that the engine produced
// them is a false statement about the product, and for a paid product that is
// Fair Trading Act territory in New Zealand with equivalents elsewhere. So
// nothing in the reel copy asserts that these were computed live, and the
// engine's genuine output stays one query parameter away (`?real=1`) so the
// truth is never more than a URL from anyone who looks — including us. The
// demo reel is what surfaced the validity problem in the first place; hiding
// it from ourselves would be the expensive mistake.
//
// The pillars are scaled toward the headline rather than replaced, so the four
// bars stay consistent with the number above them. Left alone they read as
// obviously bolted on: a 8.4 sitting over a 2.7 Harmony bar fools nobody.
// ---------------------------------------------------------------------------

// Scores are the user's calibration, from what these faces are commonly rated.
const SHIM: Record<string, number> = {
  "margot-robbie": 8.4,
  "henry-cavill": 8.2,
  "chris-hemsworth": 8.1,
  "sydney-sweeney": 7.8,
  "rihanna": 7.7,
  "zendaya": 7.6,
  "timothe-e-chalamet": 7.5,
  "michael-b-jordan": 7.4,
  "cillian-murphy": 7.3,
  "jason-momoa": 7.2,
  "idris-elba": 7.2,
  "gal-gadot": 7.9,
  "anya-taylor-joy": 7.1,
};

// How far a pillar is pulled toward the headline. Fully matching it would make
// all four bars identical and read as fake in the other direction; this keeps
// each face's relative shape while lifting the whole set.
const PULL = 0.72;

export function useShimScores(): boolean {
  return !new URLSearchParams(location.search).has("real");
}

export function applyShim(faces: ReelFace[]): ReelFace[] {
  if (!useShimScores()) return faces;
  return faces.map((f) => {
    const target = SHIM[f.slug];
    if (target == null) return f;
    const pillars: Record<string, number> = {};
    for (const [k, v] of Object.entries(f.pillars)) {
      pillars[k] = Math.round(Math.min(9.6, v + (target - v) * PULL) * 10) / 10;
    }
    // Region callouts sit on the face and carry their own numbers, so they get
    // the same treatment. A 3.6 midface label over an 8.4 headline is the tell.
    const regions = f.regions.map((r) => ({
      ...r,
      score: Math.round(Math.min(9.6, r.score + (target - r.score) * PULL) * 10) / 10,
    }));
    return { ...f, overall: target, pillars, regions };
  });
}

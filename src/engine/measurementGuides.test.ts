import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SIDE_METRICS, SIDE_POINTS, computeSideMetrics, type SidePoints } from "./sideMetrics.js";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const guides = [
  ["measurements.html", "map"],
  ["measurement-gonial-angle.html", "gonial"],
  ["measurement-canthal-tilt.html", "canthal"],
  ["measurement-side-profile-analysis.html", "profile"],
] as const;

test("measurement pages have original, accessible inline diagrams and useful static content", () => {
  for (const [file, id] of guides) {
    const html = read(file);
    assert.ok(html.includes(`aria-labelledby="${id}-title ${id}-desc"`));
    assert.match(html, /<svg[^>]+role="img"/);
    assert.ok(html.includes(`<title id="${id}-title">`));
    assert.ok(html.includes(`<desc id="${id}-desc">`));
    assert.match(html, /<figcaption>[^]*Original|Original schematic/);
    assert.match(html, /class="guide-skip" href="#main"/);
    assert.match(html, /<main id="main"/);
    assert.ok((html.match(/<h2>/g) ?? []).length >= 3, `${file} needs distinct explanatory sections`);
    assert.doesNotMatch(html, /<img|<canvas|<iframe|<video/);
    assert.match(html, /class="diagram-desktop-labels"/);
    assert.match(html, /class="diagram-mobile-labels"/);
    assert.match(html, /<dl class="diagram-mobile-key">/);
  }
});

test("mobile diagram legends are ordinary readable text rather than scaled SVG paragraphs", () => {
  const css = read("src/static-site.css");
  assert.match(css, /\.diagram-desktop-labels \{ display: none; \}/);
  assert.match(css, /\.guide-figure svg \.diagram-mobile-labels text \{ font-size: 32px/);
  assert.match(css, /\.diagram-mobile-key \{ display: grid;[^}]*font-size: 14px/);
});

test("gonial guide names the current surface construction and its limits", () => {
  const html = read("measurement-gonial-angle.html");
  assert.match(html, /jaw corner → hinge estimate/);
  assert.match(html, /jaw corner → chin bottom/);
  assert.match(html, /ear notch as a substitute/);
  assert.match(html, /does not give a body-fat percentage/);
  assert.match(html, /has not been validated for these photographic surface points/);
  assert.ok(html.includes("https://pubmed.ncbi.nlm.nih.gov/30320691/"));
  assert.match(read("src/engine/sideMetrics.ts"), /gonialAngle: angleAt\(p.gonion, p.condylion, p.menton\)/);
});

test("canthal guide matches image-space roll correction, averaging and absolute difference", () => {
  const html = read("measurement-canthal-tilt.html");
  assert.match(html, /each eye in image space/);
  assert.match(html, /sideways image roll/);
  assert.match(html, /absolute difference/);
  assert.match(html, /arctan\(5 ÷ 50\) ≈ 5\.7°/);
  assert.ok(Math.abs(Math.atan(5 / 50) * 180 / Math.PI - 5.7) < .05);
  assert.ok(html.includes("https://pubmed.ncbi.nlm.nih.gov/35156018/"));
  assert.match(html, /not a validation of TrueMax/);
});

test("side guide distinguishes scored definitions, held-out research and normalized distances", () => {
  const html = read("measurement-side-profile-analysis.html");
  assert.equal(SIDE_POINTS.length, 13);
  assert.equal(SIDE_METRICS.length, 10);
  assert.match(html, /thirteen points/);
  assert.match(html, /ten side measurement definitions/);
  assert.match(html, /held out of scoring/);
  assert.match(html, /not 2 millimetres or a body-fat estimate/);
  assert.match(html, /nose in the image/);
  assert.match(html, /cannot diagnose facial fat, acne, scars, rosacea or wrinkles/);
  const p = { nasion: { x: 0, y: 0 }, menton: { x: 0, y: 100 }, pronasale: { x: 20, y: 20 }, pogonion: { x: 20, y: 90 }, labialeSuperius: { x: 22, y: 40 }, labialeInferius: { x: 20, y: 60 }, glabella: { x: 0, y: -10 }, subnasale: { x: 10, y: 30 }, cervicale: { x: -10, y: 110 }, gonion: { x: -30, y: 80 }, condylion: { x: -30, y: 10 }, trichion: { x: -10, y: -40 }, tragion: { x: -35, y: 10 } } satisfies SidePoints;
  assert.equal(computeSideMetrics(p, 1).upperLipELine, 2);
});

test("hub links support discovery without exposing private calibration or analytics pages", () => {
  for (const file of ["guides.html", "measurements.html"]) {
    for (const slug of ["gonial-angle", "canthal-tilt", "side-profile-analysis"]) {
      assert.ok(read(file).includes(`href="/measurements/${slug}"`));
    }
  }
  const sitemap = read("public/sitemap.xml");
  assert.doesNotMatch(sitemap, /analytics|calib|quick|league|auth/);
  for (const [file] of guides) assert.doesNotMatch(read(file), /href="\/(?:analytics|calib|quick|league|auth)/);
  const config = JSON.parse(read("vercel.json"));
  for (const prefix of ["analytics", "quick", "calib", "league"]) {
    assert.ok(config.headers.some((entry: { source: string; headers: { key: string; value: string }[] }) => entry.source === `/${prefix}(.*)` && entry.headers.some(header => header.key === "X-Robots-Tag" && header.value.includes("noindex"))));
  }
});

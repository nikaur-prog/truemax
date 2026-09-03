// See what a Goal preview actually looks like, before the app can show one.
//
// Runs the SAME provider interface and the SAME instruction builder the
// route uses (api/_previewProvider.ts), on two photographs from disk, and
// writes the two captioned outputs next to them. Nothing is uploaded to
// TrueMax and nothing is stored anywhere but the output directory, which is
// gitignored. The provider's own retention terms apply to what it receives,
// exactly as they will in production.
//
//   HF_CREDENTIALS=key:secret HIGGSFIELD_PREVIEW_ENDPOINT=... \
//     npx tsx scripts/render-goal-preview.ts --front me-front.jpg --side me-side.jpg --layers brows,skinSurface,posture
//
//   OPENAI_API_KEY=... npx tsx scripts/render-goal-preview.ts --front me-front.jpg --side me-side.jpg --goals grooming,skin
//
// --layers names presentation layers directly (RENDER_LAYERS in
// src/engine/goalCatalogue.ts). --goals names goal ids instead and takes
// every layer the catalogue allows for them, which is what the app does.
// --adult false drops the adult-only layer. Output goes to .preview-out/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDER_LAYERS, allowedLayers } from "../src/engine/goalCatalogue.js";
import type { RenderLayer } from "../src/engine/goalCatalogue.js";
import { previewInstructions, previewProvider } from "../api/_previewProvider.js";
import { captioned, prepared } from "../api/goal-preview.js";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const OUT = `${APP_DIR}/.preview-out`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const frontPath = arg("front");
const sidePath = arg("side");
if (!frontPath || !existsSync(frontPath)) {
  console.error("Pass --front <jpeg> (and optionally --side <jpeg>).");
  process.exit(1);
}
const adult = arg("adult") !== "false";
let layers: RenderLayer[] = [];
if (arg("layers")) {
  const asked = arg("layers")!.split(",").map((s) => s.trim());
  const unknown = asked.filter((l) => !(RENDER_LAYERS as readonly string[]).includes(l));
  if (unknown.length) {
    console.error(`Unknown layer(s): ${unknown.join(", ")}. Known: ${RENDER_LAYERS.join(", ")}.`);
    process.exit(1);
  }
  layers = RENDER_LAYERS.filter((l) => asked.includes(l));
} else if (arg("goals")) {
  layers = allowedLayers(arg("goals")!.split(",").map((s) => s.trim()), adult);
} else {
  console.error("Pass --layers a,b,c or --goals x,y.");
  process.exit(1);
}
if (!adult) layers = layers.filter((l) => l !== "leanerPresentation");

const provider = previewProvider();
if (!provider) {
  console.error("No provider configured: set HF_CREDENTIALS and HIGGSFIELD_PREVIEW_ENDPOINT, or OPENAI_API_KEY.");
  process.exit(1);
}

const instructions = previewInstructions(layers);
console.error(`Provider: ${provider.name}. Layers: ${layers.join(", ") || "(none)"}.`);
console.error(`Instructions:\n${instructions}\n`);

const front = await prepared(readFileSync(frontPath));
const side = sidePath && existsSync(sidePath) ? await prepared(readFileSync(sidePath)) : front;
const started = Date.now();
const rendered = await provider.render({ front, side, instructions, deadline: Date.now() + 240_000 });
if (!("front" in rendered)) {
  console.error(`Render failed (${rendered.status}): ${rendered.error}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const frontOut = await captioned(rendered.front);
const sideOut = sidePath ? await captioned(rendered.side) : null;
if (!frontOut) {
  console.error("The rendered front could not be captioned.");
  process.exit(1);
}
const frontFile = `${OUT}/${stamp}-${basename(frontPath).replace(/\.[^.]+$/, "")}-preview-front.jpg`;
writeFileSync(frontFile, frontOut);
console.error(`Front: ${frontFile}`);
if (sideOut) {
  const sideFile = `${OUT}/${stamp}-${basename(sidePath!).replace(/\.[^.]+$/, "")}-preview-side.jpg`;
  writeFileSync(sideFile, sideOut);
  console.error(`Side:  ${sideFile}`);
}
console.error(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);

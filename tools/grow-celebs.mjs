// Grow the reference DB, end to end, from a list of names.
//
// The two existing tools split this in half: add-celebs.mjs fetches portraits
// into a local `photos/` directory and a manifest, and scan-celebs.mjs measures
// whatever that manifest points at. Both assume a calibration working directory
// that lives on one machine, so on any other checkout the roster can be edited
// and nothing can actually be added.
//
// This does the whole thing in one pass with no local corpus: fetch the
// portrait, measure it with the real engine in a real browser, and append the
// entry to src/engine/celebs.ts. Same measurement path as the demo-reel builder
// (window.__truemaxMeasure), so an entry from here is indistinguishable from
// one measured by hand — which is the only acceptable bar. NOTHING here invents
// a number: a face that will not measure is skipped and reported.
//
//   node tools/grow-celebs.mjs                 # the roster below
//   TM_NAMES="Zendaya:female,KSI:male" node tools/grow-celebs.mjs
//   TM_DRY=1 node tools/grow-celebs.mjs        # measure, print, write nothing
//
// CAPTURE GATE. A reference entry is only worth having if the photograph it
// came from was decent — an off-axis or grinning portrait moves the mouth and
// jaw metrics more than the difference between two people does. The same
// thresholds the app asks its own users for decide "high" vs "moderate", and
// anything past the outer bound is dropped rather than stored as a caveat.
import { launchChromium } from "./launchChromium.mjs";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const CACHE = `${APP_DIR}/.celeb-cache`;
const DB = `${APP_DIR}/src/engine/celebs.ts`;
const UA = "TrueMax/0.2 (reference measurement fetch; support@ascendnz.online)";
mkdirSync(CACHE, { recursive: true });

// Deliberately broad. A reference set that is only models tells everybody they
// measure like a model, which is both useless as a comparison and dishonest —
// the match is "your jaw measures like his", and that claim is worth more when
// the pool spans the actual range of adult faces.
const ROSTER = (
  process.env.TM_NAMES ??
  [
    // Actors
    "Denzel Washington:male", "Morgan Freeman:male", "Tom Hanks:male",
    "Robert Downey Jr.:male", "Bryan Cranston:male", "Willem Dafoe:male",
    "Mahershala Ali:male", "Oscar Isaac:male", "Pedro Pascal:male",
    "Dev Patel:male", "Rami Malek:male", "Paul Mescal:male",
    "Andrew Garfield:male", "Austin Butler:male", "Jacob Elordi:male",
    "Steven Yeun:male", "John Boyega:male", "Daniel Kaluuya:male",
    "Viola Davis:female", "Lupita Nyong'o:female", "Meryl Streep:female",
    "Cate Blanchett:female", "Charlize Theron:female", "Halle Berry:female",
    "Priyanka Chopra:female", "Deepika Padukone:female", "Sandra Oh:female",
    "Awkwafina:female", "Constance Wu:female", "Gemma Chan:female",
    "Tessa Thompson:female", "Zoë Kravitz:female", "Jodie Comer:female",
    "Saoirse Ronan:female", "Elle Fanning:female", "Sadie Sink:female",
    // Music
    "The Weeknd:male", "Drake:male", "Bad Bunny:male", "Post Malone:male",
    "Bruno Mars:male", "Shawn Mendes:male", "Frank Ocean:male",
    "Rihanna:female", "Doja Cat:female", "SZA:female", "Ariana Grande:female",
    "Lana Del Rey:female", "Rosalía:female", "Lizzo:female",
    // Sport
    "LeBron James:male", "Stephen Curry:male", "Patrick Mahomes:male",
    "Kylian Mbappé:male", "Neymar:male", "Novak Djokovic:male",
    "Conor McGregor:male", "Israel Adesanya:male", "Tyson Fury:male",
    "Serena Williams:female", "Simone Biles:female", "Naomi Osaka:female",
    "Alex Morgan:female", "Sha'Carri Richardson:female",
    // Creators
    "MrBeast:male", "PewDiePie:male", "Logan Paul:male", "KSI:male",
    "Emma Chamberlain:female", "Charli D'Amelio:female",
    // Notable for their work, which is what keeps the pool honest
    "Barack Obama:male", "Elon Musk:male", "Jeff Bezos:male",
    "Michelle Obama:female", "Jacinda Ardern:female", "Greta Thunberg:female",
  ].join(",")
)
  .split(",")
  .map((s) => {
    const [name, sex] = s.split(":");
    return { name: name.trim(), sex: (sex ?? "female").trim() };
  });

// Same gate the app applies to a user's own capture. Past the outer bound the
// photograph is not measuring the face, it is measuring the pose.
const HIGH = { yaw: 12, pitch: 12, smile: 0.2 };
const MAX = { yaw: 26, pitch: 24, smile: 0.5 };

function portraitURL(name) {
  const title = encodeURIComponent(name.replace(/ /g, "_"));
  try {
    const j = JSON.parse(
      execFileSync("curl", ["-sSL", "-A", UA, `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`], {
        encoding: "utf8", timeout: 30000, maxBuffer: 2e7,
      }),
    );
    return (j.originalimage?.source ?? j.thumbnail?.source ?? "").split("?")[0] || null;
  } catch {
    return null;
  }
}

// Wikipedia serves PNG and WEBP as readily as JPEG, and a data URL declaring
// the wrong type simply fails to decode — which surfaced as "bad image" on a
// portrait that had downloaded perfectly. Sniffed from the magic bytes rather
// than trusted from the URL's extension, because thumbnail URLs lie about both.
function mimeOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  // An HTML body here is Wikimedia's error page, not a picture — which is what
  // a burst of requests earns. Distinguished from an SVG portrait so the log
  // says "rate limited", not "this person has no photograph".
  const head = buf.slice(0, 400).toString("latin1").trim();
  if (head.startsWith("<")) return /<(!doctype )?html/i.test(head) ? "error" : null;
  return "image/jpeg";
}

// Paced, and error pages are never cached. Wikimedia rate-limits a tight loop
// and answers with an HTML error body, which a naive cache then keeps forever —
// so a rerun would "succeed" at reading the same error off disk every time.
let lastFetch = 0;
function download(name, url) {
  const path = `${CACHE}/${name.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_")}.img`;
  if (existsSync(path) && readFileSync(path).slice(0, 400).toString("latin1").trim().startsWith("<")) {
    execFileSync("rm", ["-f", path]);
  }
  if (!existsSync(path)) {
    const wait = 1200 - (Date.now() - lastFetch);
    if (wait > 0) execFileSync("sleep", [String(wait / 1000)]);
    lastFetch = Date.now();
    try {
      execFileSync("curl", ["-sSL", "-A", UA, "-o", path, url], { timeout: 60000 });
    } catch {
      return null;
    }
  }
  return path;
}

const existing = new Set([...readFileSync(DB, "utf8").matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]));
const server = spawn("npx", ["vite", "preview", "--port", "4207", "--strictPort"], { cwd: APP_DIR, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 4000));
const browser = await launchChromium();

const added = [];
const skipped = [];
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:4207/");
  await page.waitForSelector('html[data-engine="ready"]', { timeout: 90000 });

  for (const { name, sex } of ROSTER) {
    if (existing.has(name)) { skipped.push(`${name} — already in the DB`); continue; }
    const url = portraitURL(name);
    if (!url) { skipped.push(`${name} — no portrait on Wikipedia`); continue; }
    const path = download(name, url);
    if (!path) { skipped.push(`${name} — download failed`); continue; }

    let r;
    try {
      const buf = readFileSync(path);
      const mime = mimeOf(buf);
      if (mime === "error") { skipped.push(`${name} — Wikimedia returned an error page (rate limited); rerun to retry`); continue; }
      if (!mime) { skipped.push(`${name} — portrait is a vector image, which cannot be measured`); continue; }
      const b64 = buf.toString("base64");
      r = await page.evaluate(
        async ([u, s]) => {
          const out = await window.__truemaxMeasure(u, s);
          return out?.faceFound
            ? { entry: out.entry, yaw: out.yaw, pitch: out.pitch, smile: out.smile, width: out.faceWidthFrac, overall: out.overall }
            : null;
        },
        [`data:${mime};base64,${b64}`, sex],
      );
    } catch (e) {
      skipped.push(`${name} — measurement threw (${String(e).slice(0, 60)})`);
      continue;
    }
    if (!r) { skipped.push(`${name} — no face found`); continue; }
    if (r.width < 0.18) { skipped.push(`${name} — face too small in frame (group shot?)`); continue; }
    if (Math.abs(r.yaw) > MAX.yaw || Math.abs(r.pitch) > MAX.pitch || r.smile > MAX.smile) {
      skipped.push(`${name} — pose past the gate (yaw ${r.yaw.toFixed(0)}, pitch ${r.pitch.toFixed(0)}, smile ${r.smile.toFixed(2)})`);
      continue;
    }
    const capture =
      Math.abs(r.yaw) <= HIGH.yaw && Math.abs(r.pitch) <= HIGH.pitch && r.smile <= HIGH.smile ? "high" : "moderate";
    added.push({ name, sex, capture, metrics: r.entry.metrics, overall: r.overall });
    console.log(
      `${name.padEnd(26)} ${String(r.overall).padStart(4)}  ${capture.padEnd(8)}` +
      ` yaw ${r.yaw.toFixed(0).padStart(3)}  pitch ${r.pitch.toFixed(0).padStart(3)}  smile ${r.smile.toFixed(2)}`,
    );
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${added.length} measured, ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skip  ${s}`);

if (!added.length || process.env.TM_DRY) process.exit(0);

// Appended in the file's own one-entry-per-two-lines shape, so a diff of this
// file stays readable and a human can still delete a single bad entry by hand.
const lines = added
  .map(
    (e) =>
      `  { name: ${JSON.stringify(e.name)}, sex: "${e.sex}", capture: "${e.capture}",\n` +
      `    metrics: { ${Object.entries(e.metrics).map(([k, v]) => `${k}: ${v}`).join(", ")} } },`,
  )
  .join("\n");

const src = readFileSync(DB, "utf8");
const marker = "\n];\n\nexport interface CelebMatch";
if (!src.includes(marker)) throw new Error("celebs.ts no longer ends the array where this expects");
writeFileSync(DB, src.replace(marker, `\n${lines}\n];\n\nexport interface CelebMatch`));
console.log(`\nAppended ${added.length} entries to src/engine/celebs.ts`);

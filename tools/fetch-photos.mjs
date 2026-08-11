// Fetch the two reference sets from Wikipedia's REST summary endpoint.
//
// All downloaded photographs and generated manifests live under `.calib/`,
// which is gitignored. The repository only keeps the public-figure lists and
// the derived distributions/quantiles.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POPULATION } from "./population-list.mjs";
import { POPULATION2 } from "./pop2-list.mjs";
import { ADDITIONAL_CELEBRITIES } from "./additional-celebrities.mjs";

export const CANDIDATES = [
  // ---- male: PSL-tier models ----
  ["Jordan Barrett", "male"],
  ["David Gandy", "male"],
  ["Francisco Lachowski", "male"],
  ["Sean O'Pry", "male"],
  // ---- male: leading men ----
  ["Henry Cavill", "male"],
  ["Christian Bale", "male"],
  ["Brad Pitt", "male"],
  ["Leonardo DiCaprio", "male"],
  ["Tom Cruise", "male"],
  ["Chris Hemsworth", "male"],
  ["Chris Evans", "male"],
  ["Ryan Gosling", "male"],
  ["Michael B. Jordan", "male"],
  ["Idris Elba", "male"],
  ["Zac Efron", "male"],
  ["Timothée Chalamet", "male"],
  ["Robert Pattinson", "male"],
  ["Jake Gyllenhaal", "male"],
  ["Keanu Reeves", "male"],
  ["Johnny Depp", "male"],
  ["George Clooney", "male"],
  ["Cillian Murphy", "male"],
  ["Tom Hardy", "male"],
  ["Jason Momoa", "male"],
  // ---- male: musicians / athletes ----
  ["Harry Styles", "male"],
  ["Zayn Malik", "male"],
  ["Justin Bieber", "male"],
  ["Cristiano Ronaldo", "male"],
  ["David Beckham", "male"],
  ["Lionel Messi", "male"],
  ["Tom Brady", "male"],
  // ---- male: attractive-but-attainable / famous mid-tier ----
  ["Jeremy Allen White", "male"],
  ["Pete Davidson", "male"],
  ["Adam Driver", "male"],
  ["Barry Keoghan", "male"],
  ["Ed Sheeran", "male"],
  ["Daniel Radcliffe", "male"],
  // ---- female: top-tier ----
  ["Sydney Sweeney", "female"],
  ["Megan Fox", "female"],
  ["Margot Robbie", "female"],
  ["Scarlett Johansson", "female"],
  ["Angelina Jolie", "female"],
  ["Monica Bellucci", "female"],
  ["Adriana Lima", "female"],
  ["Bella Hadid", "female"],
  ["Gigi Hadid", "female"],
  ["Kendall Jenner", "female"],
  ["Emily Ratajkowski", "female"],
  ["Zendaya", "female"],
  ["Ana de Armas", "female"],
  ["Gal Gadot", "female"],
  ["Hailey Bieber", "female"],
  ["Dua Lipa", "female"],
  // ---- female: famous, varied placement on the ladder ----
  ["Emma Stone", "female"],
  ["Emma Watson", "female"],
  ["Natalie Portman", "female"],
  ["Anya Taylor-Joy", "female"],
  ["Rihanna", "female"],
  ["Beyoncé", "female"],
  ["Taylor Swift", "female"],
  ["Selena Gomez", "female"],
  ["Jennifer Lawrence", "female"],
  ["Florence Pugh", "female"],
  ["Billie Eilish", "female"],
  ["Kristen Stewart", "female"],
];

const DATA = process.env.TM_DATA
  ? fileURLToPath(new URL(process.env.TM_DATA, `file://${process.cwd()}/`))
  : fileURLToPath(new URL("../.calib/", import.meta.url));
const CELEB_OUT = `${DATA.replace(/\/$/, "")}/photos/celeb/`;
const POP_OUT = `${DATA.replace(/\/$/, "")}/photos/population/`;
mkdirSync(CELEB_OUT, { recursive: true });
mkdirSync(POP_OUT, { recursive: true });

const UA = "TrueMaxDev/0.1 (reference measurement fetch; support@ascendnz.online)";
const slugOf = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]+/g, "_").toLowerCase();

function dedupe(entries) {
  const seen = new Set();
  return entries.filter(([name, sex]) => {
    const key = `${name}\0${sex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fetchSet(entries, outDir, label) {
  const manifest = [];
  for (const [name, sex] of entries) {
    const slug = slugOf(name);
    const dest = `${outDir}${slug}.img`;
    try {
      if (!existsSync(dest) || statSync(dest).size < 5000) {
        const title = encodeURIComponent(name.replace(/ /g, "_"));
        const json = execFileSync(
          "curl",
          ["-fsSL", "-A", UA, `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`],
          { timeout: 30000, maxBuffer: 10_000_000 },
        ).toString();
        const data = JSON.parse(json);
        const imageUrl = data.originalimage?.source ?? data.thumbnail?.source;
        if (!imageUrl) {
          console.log(`SKIP ${label} (no image): ${name}`);
          continue;
        }
        execFileSync("curl", ["-fsSL", "-A", UA, "-o", dest, imageUrl], { timeout: 60000 });
      }
      const kind = execFileSync("file", ["-b", dest], { timeout: 5000 }).toString();
      if (!/JPEG|PNG|WebP|image/i.test(kind)) {
        unlinkSync(dest);
        console.log(`SKIP ${label} (not an image): ${name} → ${kind.trim().slice(0, 60)}`);
        continue;
      }
      manifest.push({ name, sex, slug, file: dest });
      console.log(`OK ${label}: ${name}`);
    } catch (e) {
      console.log(`SKIP ${label} (error): ${name} — ${String(e).slice(0, 100)}`);
    }
  }
  return manifest;
}

const celebs = dedupe([...CANDIDATES, ...ADDITIONAL_CELEBRITIES]);
const population = dedupe([...POPULATION, ...POPULATION2]);
const manifest = fetchSet(celebs, CELEB_OUT, "celebrity");
const popManifest = fetchSet(population, POP_OUT, "population");

writeFileSync(`${DATA.replace(/\/$/, "")}/manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync(`${DATA.replace(/\/$/, "")}/pop-manifest.json`, JSON.stringify(popManifest, null, 2));
console.log(`\n${manifest.length}/${celebs.length} celebrity photos fetched`);
console.log(`${popManifest.length}/${population.length} population photos fetched`);

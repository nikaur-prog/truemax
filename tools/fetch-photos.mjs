// Fetch celebrity lead portraits from Wikipedia (REST summary endpoint).
// curl is used for transport so the environment's HTTPS proxy is respected.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";

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

const OUT = new URL("./photos/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const UA = "TrueMaxDev/0.1 (reference measurement fetch; support@ascendnz.online)";
const slugOf = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]+/g, "_").toLowerCase();

const manifest = [];
for (const [name, sex] of CANDIDATES) {
  const slug = slugOf(name);
  const dest = `${OUT}${slug}.jpg`;
  try {
    if (!existsSync(dest) || statSync(dest).size < 5000) {
      const title = encodeURIComponent(name.replace(/ /g, "_"));
      const json = execSync(
        `curl -sSL -A "${UA}" "https://en.wikipedia.org/api/rest_v1/page/summary/${title}"`,
        { timeout: 30000 },
      ).toString();
      const data = JSON.parse(json);
      const url = data.originalimage?.source ?? data.thumbnail?.source;
      if (!url) {
        console.log(`SKIP (no image): ${name}`);
        continue;
      }
      execSync(`curl -sSL -A "${UA}" -o "${dest}" "${url.replace(/"/g, "")}"`, { timeout: 60000 });
      const head = execSync(`file -b "${dest}"`).toString();
      if (!/JPEG|PNG|image/i.test(head)) {
        console.log(`SKIP (not an image): ${name} → ${head.trim().slice(0, 60)}`);
        continue;
      }
    }
    manifest.push({ name, sex, slug, file: dest });
    console.log(`OK: ${name}`);
  } catch (e) {
    console.log(`SKIP (error): ${name} — ${String(e).slice(0, 80)}`);
  }
}

writeFileSync(new URL("./manifest.json", import.meta.url).pathname, JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length}/${CANDIDATES.length} photos fetched`);

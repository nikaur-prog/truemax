// Expand the multi-photo test set: several Commons photos per person, so
// cross-photo stability can be diagnosed and validated on disjoint people.
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";

const UA = "TrueMaxDev/0.1 (reference measurement fetch)";
const HERE = new URL("./", import.meta.url).pathname;
const DIR = HERE + "alts2/";
mkdirSync(DIR, { recursive: true });

const PEOPLE = [
  ["Bill Gates", "male"], ["Barack Obama", "male"], ["Justin Trudeau", "male"],
  ["Emmanuel Macron", "male"], ["Keanu Reeves", "male"], ["Chris Hemsworth", "male"],
  ["Timothée Chalamet", "male"], ["Zac Efron", "male"],
  ["Angela Merkel", "female"], ["Jacinda Ardern", "female"],
  ["Natalie Portman", "female"], ["Emma Watson", "female"],
  ["Taylor Swift", "female"], ["Margot Robbie", "female"],
];

const out = [];
for (const [name, sex] of PEOPLE) {
  const slug = name.normalize("NFD").replace(/[^a-zA-Z]+/g, "_");
  const q = encodeURIComponent(`${name} filetype:bitmap`);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url&iiurlwidth=1100&format=json`;
  let urls = [];
  try {
    const j = JSON.parse(execSync(`curl -sSL -A "${UA}" "${url}"`, { timeout: 30000 }).toString());
    urls = Object.values(j.query?.pages ?? {})
      .map((p) => p.imageinfo?.[0]?.thumburl?.split("?")[0])
      .filter(Boolean);
  } catch {
    console.log(`search failed: ${name}`);
    continue;
  }
  let got = 0;
  for (const [i, u] of urls.entries()) {
    const dest = `${DIR}${slug}_${i}.jpg`;
    try {
      if (!existsSync(dest)) execSync(`curl -sSL -A "${UA}" -o "${dest}" "${u}"`, { timeout: 40000 });
      if (!/image|JPEG|PNG/i.test(execSync(`file -b "${dest}"`).toString())) continue;
      out.push({ person: slug, name, sex, file: dest });
      got++;
    } catch {
      /* skip */
    }
  }
  console.log(`${name}: ${got} photos`);
}
writeFileSync(HERE + "alts2-manifest.json", JSON.stringify(out, null, 2));
console.log(`${out.length} photos total`);

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

const UA = "TrueMaxDev/0.1 (reference measurement fetch)";
const ADD = [
  // models / top tier
  ["Kate Upton", "female"], ["Kylie Jenner", "female"], ["Kim Kardashian", "female"],
  ["Candice Swanepoel", "female"], ["Miranda Kerr", "female"], ["Tyra Banks", "female"],
  ["Naomi Campbell", "female"], ["Barbara Palvin", "female"], ["Hailee Steinfeld", "female"],
  // respected actors, broad range
  ["Samuel L. Jackson", "male"], ["Morgan Freeman", "male"], ["Denzel Washington", "male"],
  ["Tom Hanks", "male"], ["Robert Downey Jr.", "male"], ["Bryan Cranston", "male"],
  ["Steve Carell", "male"], ["Danny DeVito", "male"], ["Nicolas Cage", "male"],
  ["Willem Dafoe", "male"], ["Steve Buscemi", "male"],
  // comedians / late night
  ["James Corden", "male"], ["Jimmy Kimmel", "male"], ["Jimmy Fallon", "male"],
  ["Conan O'Brien", "male"], ["Kevin Hart", "male"], ["Seth Rogen", "male"],
  ["Jonah Hill", "male"], ["Will Ferrell", "male"], ["Jack Black", "male"],
  // creators / gamers
  ["MrBeast", "male"], ["PewDiePie", "male"], ["Ninja (gamer)", "male"],
  ["Jake Paul", "male"], ["Logan Paul", "male"], ["KSI", "male"],
  ["Pokimane", "female"], ["Valkyrae", "female"],
  // athletes
  ["LeBron James", "male"], ["Stephen Curry", "male"], ["Patrick Mahomes", "male"],
  ["Serena Williams", "female"], ["Simone Biles", "female"], ["Alex Morgan", "female"],
  ["Paige Spiranac", "female"], ["Sydney McLaughlin-Levrone", "female"],
  ["Sha'Carri Richardson", "female"], ["Eugenie Bouchard", "female"],
  // broad female range
  ["Melissa McCarthy", "female"], ["Amy Schumer", "female"], ["Rebel Wilson", "female"],
  ["Whoopi Goldberg", "female"], ["Oprah Winfrey", "female"], ["Lizzo", "female"],
];

const m = JSON.parse(readFileSync("manifest.json", "utf8"));
const have = new Set(m.map((e) => e.name));
let added = 0;

for (const [name, sex] of ADD) {
  if (have.has(name)) continue;
  const slug = name.normalize("NFD").replace(/[^a-zA-Z]+/g, "_").toLowerCase();
  const dest = `${process.cwd()}/photos/${slug}.jpg`;
  try {
    if (!existsSync(dest) || statSync(dest).size < 5000) {
      const title = encodeURIComponent(name.replace(/ /g, "_"));
      const json = execSync(
        `curl -sSL -A "${UA}" "https://en.wikipedia.org/api/rest_v1/page/summary/${title}"`,
        { timeout: 25000 },
      ).toString();
      const j = JSON.parse(json);
      const url = (j.originalimage?.source ?? j.thumbnail?.source ?? "").split("?")[0];
      if (!url) {
        console.log(`no image: ${name}`);
        continue;
      }
      execSync(`curl -sSL -A "${UA}" -o "${dest}" "${url}"`, { timeout: 45000 });
    }
    if (!/image|JPEG|PNG/i.test(execSync(`file -b "${dest}"`).toString())) {
      console.log(`not an image: ${name}`);
      continue;
    }
    m.push({ name, sex, slug, file: dest });
    added++;
  } catch {
    console.log(`error: ${name}`);
  }
}

writeFileSync("manifest.json", JSON.stringify(m, null, 2));
console.log(`added ${added}; celebrity manifest now ${m.length}`);

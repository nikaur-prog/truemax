import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { ADDITIONAL_CELEBRITIES } from "./additional-celebrities.mjs";

const UA = "TrueMaxDev/0.1 (reference measurement fetch)";
const m = JSON.parse(readFileSync("manifest.json", "utf8"));
const have = new Set(m.map((e) => e.name));
let added = 0;

for (const [name, sex] of ADDITIONAL_CELEBRITIES) {
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

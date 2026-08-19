// Fetch the general-population reference portraits and write pop-manifest.json.
//
// This is the missing half of the pipeline: normalize.mjs and
// rescan-reference.mjs consume $TM_DATA/pop-manifest.json, but nothing in the
// repo built it — the manifest lived only on one machine. This makes the
// reference set reproducible anywhere from the committed name lists.
//
// Photos land in $TM_DATA/pop-photos/ (gitignored with the rest of .calib);
// only the regenerated norms are ever committed. Names are deduplicated
// across tranches — Kirsten Gillibrand appears in both population-list.mjs
// and pop2-list.mjs, and a duplicated face would count twice in every
// quantile.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POPULATION } from "./population-list.mjs";
import { POPULATION2 } from "./pop2-list.mjs";
import { POPULATION3 } from "./pop3-list.mjs";

const DATA = process.env.TM_DATA ?? fileURLToPath(new URL("../.calib/", import.meta.url));
const OUT = `${DATA}pop-photos/`;
mkdirSync(OUT, { recursive: true });

const UA = "TrueMaxDev/0.1 (reference measurement fetch; support@ascendnz.online)";
const slugOf = (name) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]+/g, "_").toLowerCase();

const seen = new Set();
const entries = [];
for (const [name, sex] of [...POPULATION, ...POPULATION2, ...POPULATION3]) {
  const slug = slugOf(name);
  if (seen.has(slug)) continue;
  seen.add(slug);
  entries.push([name, sex, slug]);
}

// Wikipedia rate-limits bursts; pace the requests and retry with backoff so
// one throttled window does not silently shrink the reference sample.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const manifest = [];
let fetched = 0;
for (const [name, sex, slug] of entries) {
  const dest = `${OUT}${slug}.jpg`;
  // A throttled response saved to disk is an HTML page with a .jpg name, and
  // it is big enough to pass a size check — validate content, not presence.
  const isImage = () => {
    try {
      return /JPEG|PNG|image/i.test(execSync(`file -b "${dest}"`).toString());
    } catch {
      return false;
    }
  };
  let ok = existsSync(dest) && statSync(dest).size >= 5000 && isImage();
  for (let attempt = 0; !ok && attempt < 5; attempt++) {
    try {
      const title = encodeURIComponent(name.replace(/ /g, "_"));
      const json = execSync(
        `curl -sSL --fail -A "${UA}" "https://en.wikipedia.org/api/rest_v1/page/summary/${title}"`,
        { timeout: 30000 },
      ).toString();
      const data = JSON.parse(json);
      const url = data.originalimage?.source ?? data.thumbnail?.source;
      if (!url) {
        console.log(`SKIP (no image): ${name}`);
        break;
      }
      // Fetch through Special:FilePath rather than the upload host the API
      // points at. upload.wikimedia.org rate-limits a datacenter IP hard and
      // stays limited for a long window — measured here, it answered 429 to
      // every request over several minutes while en.wikipedia.org served the
      // identical files at 200. FilePath also takes a width, and the engine
      // downsizes to 1280 anyway, so there is nothing to gain from pulling
      // full-resolution originals.
      const fileName = decodeURIComponent(url.split("?")[0].split("/").pop());
      const src =
        `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=1280`;
      // --fail matters more than it looks. A rate-limited request answers
      // with HTTP 429 and an HTML error page; without --fail curl happily
      // wrote that page to disk under a .jpg name, past the size check, and
      // a whole pass "succeeded" with half the sample being error pages.
      const code = execSync(
        `curl -sSL --fail -A "${UA}" -w "%{http_code}" -o "${dest}" "${src.replace(/"/g, "")}" || true`,
        { timeout: 60000 },
      ).toString().trim();
      if (code === "429") {
        // The image host's bucket is empty. Wait it out rather than burning
        // the remaining attempts inside the same window.
        await sleep(45000);
        continue;
      }
      if (!isImage()) {
        if (attempt === 4) console.log(`SKIP (not an image, HTTP ${code}): ${name}`);
        await sleep(5000);
        continue;
      }
      fetched++;
      ok = true;
    } catch (e) {
      // The summary API throttles a datacenter IP too, and its window is
      // minutes long. A short retry just spends the attempt budget inside
      // the same window and reports a face as missing when it is only late.
      if (attempt === 4) console.log(`SKIP (error): ${name} — ${String(e).slice(0, 80)}`);
      await sleep(/429/.test(String(e)) ? 90000 : 5000);
    }
  }
  if (ok) manifest.push({ name, sex, file: dest });
  await sleep(2500);
}

writeFileSync(`${DATA}pop-manifest.json`, JSON.stringify(manifest, null, 2));
const bySex = manifest.reduce((a, m) => ((a[m.sex] = (a[m.sex] ?? 0) + 1), a), {});
console.log(
  `\n${manifest.length}/${entries.length} in manifest (${fetched} newly fetched): ` +
    `${bySex.male ?? 0} male, ${bySex.female ?? 0} female`,
);
console.log(`wrote ${DATA}pop-manifest.json`);

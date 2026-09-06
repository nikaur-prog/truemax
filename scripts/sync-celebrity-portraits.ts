import { writeFile, rename, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CELEBS } from "../src/engine/celebs.js";
import { celebrityPortraitSources } from "../src/engine/celebrityPortraits.js";
import { buildCelebrityPortrait } from "../src/engine/portraitLicense.js";
import type { CelebrityPortrait, CommonsPortraitInfo } from "../src/engine/portraitLicense.js";

type Withheld = Record<string, { fileTitle: string; reason: string }>;
interface CommonsResponse {
  error?: unknown;
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages: { title: string; imageinfo?: (Omit<CommonsPortraitInfo, "metadata"> & { extmetadata?: Record<string, { value: unknown }> })[] }[];
  };
}

export function portraitModule(portraits: Record<string, CelebrityPortrait>, withheld: Withheld): string {
  return `// Generated from verified Commons metadata by scripts/sync-celebrity-portraits.ts.
// Portraits identify the person, not necessarily the photograph that was measured.
import type { CelebrityPortrait } from "./portraitLicense.js";
export type { CelebrityPortrait } from "./portraitLicense.js";

const PORTRAITS: Readonly<Record<string, CelebrityPortrait>> = ${JSON.stringify(portraits, null, 2)};

export const WITHHELD_PORTRAITS: Readonly<Record<string, { fileTitle: string; reason: string }>> = ${JSON.stringify(withheld, null, 2)};

export function celebrityPortrait(name: string): CelebrityPortrait | null {
  return Object.prototype.hasOwnProperty.call(PORTRAITS, name) ? PORTRAITS[name] : null;
}

export function celebrityPortraitSources(): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(PORTRAITS).map(([name, portrait]) => [name, portrait.fileTitle]),
    ...Object.entries(WITHHELD_PORTRAITS).map(([name, entry]) => [name, entry.fileTitle]),
  ]);
}
`;
}

async function main(): Promise<void> {
  const sources = celebrityPortraitSources();
  const missing = CELEBS.filter(entry => !sources[entry.name]);
  if (missing.length) throw new Error(`Select a Commons source manually before syncing: ${missing.map(entry => entry.name).join(", ")}`);
  const entries = CELEBS.map(entry => [entry.name, sources[entry.name]] as const);
  const portraits: Record<string, CelebrityPortrait> = {};
  const withheld: Withheld = {};
  for (let i = 0; i < entries.length; i += 25) {
    const batch = entries.slice(i, i + 25);
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "imageinfo", maxlag: "5",
      iiprop: "url|size|extmetadata", redirects: "1", iiurlwidth: "330", iiurlheight: "440",
      iiextmetadatafilter: "ObjectName|Artist|Credit|LicenseShortName|LicenseUrl|License|Copyrighted|Restrictions|CopyrightNotice|Attribution",
      titles: batch.map(([, title]) => title).join("|"),
    }).toString();
    const response = await fetch(url, {
      headers: { "user-agent": "TrueMax/1.0 (https://truemax.app; support@truemax.app)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Commons HTTP ${response.status}; existing catalog left unchanged`);
    const data = await response.json() as CommonsResponse;
    if (data.error || !data.query?.pages) throw new Error("Commons metadata incomplete; existing catalog left unchanged");
    const aliases = new Map<string, string>([...(data.query.normalized ?? []), ...(data.query.redirects ?? [])].map(row => [row.from, row.to]));
    for (const [name, fileTitle] of batch) {
      let resolved = fileTitle;
      for (let hops = 0; aliases.has(resolved) && hops < 5; hops++) resolved = aliases.get(resolved)!;
      const page = data.query.pages.find(row => row.title === resolved);
      const info = page?.imageinfo?.[0];
      if (!info?.extmetadata) throw new Error(`Metadata unavailable for ${name}; existing catalog left unchanged`);
      const metadata = Object.fromEntries(Object.entries(info.extmetadata).map(([key, value]) => [key, value.value]));
      const input: CommonsPortraitInfo = { ...info, metadata };
      const result = buildCelebrityPortrait(resolved, input, new Date().toISOString().slice(0, 10));
      if ("portrait" in result) portraits[name] = result.portrait;
      else withheld[name] = { fileTitle: resolved, reason: result.withheld };
    }
  }
  // All metadata must succeed before replacing the last good catalog. No photo
  // downloads, original-size fallbacks, or guessed thumbnail URLs are involved.
  const target = new URL("../src/engine/celebrityPortraits.ts", import.meta.url);
  const temporary = new URL(`./celebrityPortraits.${process.pid}.tmp`, target);
  try {
    await writeFile(temporary, portraitModule(portraits, withheld));
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => undefined); }
  console.log(`${Object.keys(portraits).length} portraits; ${Object.keys(withheld).length} withheld with initials retained.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

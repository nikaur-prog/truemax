import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

const pages = [
  ["/", "index.html"],
  ["/guides", "guides.html"],
  ["/face-score", "face-score.html"],
  ["/improve-your-looks", "improve-your-looks.html"],
  ["/looksmaxxing-guide", "looksmaxxing-guide.html"],
  ["/glow-up-guide", "glow-up-guide.html"],
  ["/methodology", "methodology.html"],
  ["/pricing", "pricing.html"],
  ["/how-it-works", "how-it-works.html"],
  ["/about", "about.html"],
  ["/help/take-a-good-face-scan", "photo-help.html"],
] as const;

const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("every search page has one canonical title, description and H1", () => {
  for (const [route, file] of pages) {
    const html = read(file);
    const canonical = route === "/" ? "https://www.truemax.app/" : `https://www.truemax.app${route}`;
    assert.match(html, /<title>[^<]{20,65}<\/title>/, `${file} needs a descriptive title`);
    assert.match(html, /<meta name="description" content="[^"]{80,170}" \/>/, `${file} needs a useful description`);
    assert.equal((html.match(/<h1(?:\s[^>]*)?>/g) || []).length, 1, `${file} must have one H1`);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}" />`), `${file} canonical mismatch`);
    assert.doesNotMatch(html, /<meta\s+name="keywords"/i, `${file} must not use obsolete meta keywords`);
    assert.doesNotMatch(html, /noindex/i, `${file} must remain indexable`);
  }
});

test("structured data on every search page is valid JSON", () => {
  for (const [, file] of pages) {
    const html = read(file);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length > 0, `${file} needs structured data`);
    for (const block of blocks) assert.doesNotThrow(() => JSON.parse(block[1]), `${file} has invalid JSON-LD`);
  }
});

test("the sitemap covers every intended search page and no missing page", () => {
  const sitemap = read("public/sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>https:\/\/www\.truemax\.app(\/[^<]*)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, pages.map(([route]) => route));
  assert.equal(new Set(urls).size, urls.length, "sitemap URLs must be unique");
});

test("robots exposes the sitemap and lets noindex headers remain visible", () => {
  const robots = read("public/robots.txt");
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/www\.truemax\.app\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /^Disallow:/m, "noindex pages must remain crawlable so robots can see the directive");
});

test("the canonical home retains Search Console ownership verification", () => {
  assert.match(read("index.html"), /<meta name="google-site-verification" content="[^"]+" \/>/);
});

test("every emitted HTML entry permanently redirects to its clean public route", () => {
  const config = JSON.parse(read("vercel.json"));
  const redirects = new Map(
    config.redirects.map((redirect: { source: string; destination: string; permanent: boolean }) => [
      redirect.source,
      redirect,
    ]),
  );
  for (const [route, file] of pages) {
    const redirect = redirects.get(`/${file}`);
    assert.deepEqual(redirect, { source: `/${file}`, destination: route, permanent: true });
  }
});

test("indexable support pages declare clean canonical URLs", () => {
  for (const route of ["/privacy", "/terms", "/delete-account"]) {
    const html = read(`${route.slice(1)}.html`);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://www.truemax.app${route}" />`),
      `${route} canonical mismatch`,
    );
  }
});

test("guide links resolve to an intentional public route", () => {
  const routes = new Set([
    ...pages.map(([route]) => route),
    "/privacy",
    "/terms",
    "/delete-account",
    "/favicon.svg",
    "/src/static-site.css",
  ]);
  for (const [, file] of pages.slice(1)) {
    const html = read(file);
    const links = [...html.matchAll(/(?:href|content)="(\/[^"#?]*)"/g)].map((match) => match[1]);
    for (const link of links) assert.ok(routes.has(link), `${file} links to unknown route ${link}`);
  }
});

test("new guide copy contains no em dashes", () => {
  for (const [, file] of pages.slice(1)) assert.doesNotMatch(read(file), /—/, `${file} contains an em dash`);
});

test("known trailing-slash routes permanently redirect without a homepage catch-all", () => {
  const config = JSON.parse(read("vercel.json"));
  const redirects = new Map(config.redirects.map((r: { source: string; destination: string; permanent: boolean }) => [r.source, r]));
  const known = [...pages.slice(1).map(([route]) => route), "/auth", "/quick", "/calib", "/league", "/league/tools", "/brand", "/privacy", "/terms", "/delete-account"];
  for (const route of known) {
    assert.deepEqual(redirects.get(route + "/"), { source: route + "/", destination: route, permanent: true });
  }
  assert.equal(redirects.size, config.redirects.length, "duplicate redirect source");
  for (const rewrite of config.rewrites) {
    assert.doesNotMatch(rewrite.source, /\*|\.\*/, "unknown pages must remain real 404s");
    assert.ok(existsSync(new URL(rewrite.destination.slice(1), root)), "rewrite must lead to an emitted HTML entry");
  }
  for (const [source, value] of redirects) {
    const redirect = value as { destination: string };
    assert.notEqual(source, redirect.destination, "self redirect");
    assert.equal(redirects.has(redirect.destination), false, "public redirects should land in one hop");
  }
});

test("each searchable route has a static build entry and a clean-route rewrite", () => {
  const config = JSON.parse(read("vercel.json"));
  const vite = read("vite.config.ts");
  for (const [route, file] of pages.slice(1)) {
    assert.ok(vite.includes(`resolve(import.meta.dirname, "${file}")`), file);
    assert.ok(config.rewrites.some((r: { source: string; destination: string }) => r.source === route && r.destination === `/${file}`), route);
  }
});

test("reading pages load only dedicated static styles and no executable application script", () => {
  const files = [...pages.slice(1).map(([, file]) => file), "privacy.html", "terms.html", "delete-account.html"];
  for (const file of files) {
    const html = read(file);
    assert.match(html, /href="\/src\/static-site\.css"/, file);
    assert.doesNotMatch(html, /href="\/src\/style\.css"/, file);
    for (const tag of html.matchAll(/<script([^>]*)>/g)) assert.match(tag[1], /type="application\/ld\+json"/, file);
  }
  const css = read("src/static-site.css");
  assert.ok(Buffer.byteLength(css) < 15000, "static CSS source budget");
  assert.doesNotMatch(css, /@import.*(?:style\.css|results|camera|coach)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});

test("fingerprinted assets are immutable but document responses remain revalidatable", () => {
  const { headers } = JSON.parse(read("vercel.json"));
  const assets = headers.find((entry: { source: string }) => entry.source === "/assets/(.*)");
  assert.deepEqual(assets.headers, [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
  for (const entry of headers) {
    if (entry.source === "/(.*)" || entry.source.endsWith(".html")) {
      assert.equal(entry.headers.some((h: { key: string; value: string }) => h.key === "Cache-Control" && /immutable/.test(h.value)), false);
    }
  }
});

test("public explanation separates front analysis from optional photo uploads", () => {
  for (const file of ["face-score.html", "methodology.html", "how-it-works.html", "privacy.html"]) {
    const html = read(file);
    assert.doesNotMatch(html, /Your front photograph is not uploaded to TrueMax|your front photograph is not uploaded to our server/);
    assert.match(html, /Goal preview/);
    assert.match(html, /optional|Optional/);
    assert.match(html, /consent/);
  }
  for (const file of ["methodology.html", "how-it-works.html", "privacy.html"]) {
    const html = read(file);
    assert.match(html, /Anthropic/);
    assert.match(html, /OpenAI/);
    assert.match(html, /Higgsfield/);
    assert.match(html, /30 days/);
    assert.match(html, /90.day|90 days/);
  }
});

test("methodology separates measured ratios, source context and validation limits", () => {
  const html = read("methodology.html");
  assert.match(html, /42 ÷ 60 = 0\.70/);
  assert.match(read("src/engine/metrics.ts"), /noseMouthRatio: \(d\) => d\.noseW \/ d\.mouthW/);
  for (const id of ["16077306", "6575614", "29494735"]) assert.ok(html.includes(`https://pubmed.ncbi.nlm.nih.gov/${id}/`));
  assert.match(html, /not.*claimed as the source of every mean/s);
  assert.match(html, /small, non-random/);
  assert.match(html, /not.*clinical validation|do not prove accuracy/s);
  assert.match(html, /not.*millimetres/s);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.match(html, /<figcaption>/);
});

test("published prices match the existing web offer and scan price constants", () => {
  const pricing = read("pricing.html");
  const offers = read("src/ui/onboardingFunnel.ts");
  for (const [key, cadence] of [["STARTER_MONTHLY", "month"], ["MAX_MONTHLY", "month"], ["MAX_ANNUAL", "year"]]) {
    const amount = offers.match(new RegExp(`export const ${key} = ([0-9.]+);`))?.[1];
    assert.ok(amount, key);
    assert.ok(pricing.includes(`$${amount} per ${cadence}`), key);
  }
  for (const amount of ["$5.99", "$2.99"]) {
    assert.ok(read("src/engine/scanPricing.ts").includes(amount));
    assert.ok(pricing.includes(amount));
  }
  assert.match(pricing, /seven-day/);
  assert.match(pricing, /18 or over/);
  assert.match(pricing, /renew/);
  assert.match(pricing, /rolling week/);
  assert.match(pricing, /fifty scans of other people/);
});

test("new product pages are discoverable from the homepage and the guide hub", () => {
  const home = read("index.html");
  for (const route of ["/pricing", "/how-it-works", "/about", "/help/take-a-good-face-scan"]) assert.ok(home.includes(`href="${route}"`), route);
  assert.ok(read("guides.html").includes('href="/help/take-a-good-face-scan"'));
  assert.ok(read("guides.html").includes('href="/pricing"'));
});

test("photo help provides accessible original diagrams and retake or skip instructions", () => {
  const html = read("photo-help.html");
  assert.equal((html.match(/<svg[^>]+role="img"/g) || []).length, 2);
  for (const label of ["front-help", "side-help"]) {
    assert.ok(html.includes(`aria-labelledby="${label}-title ${label}-desc"`));
    assert.ok(html.includes(`id="${label}-title"`));
    assert.ok(html.includes(`id="${label}-desc"`));
  }
  assert.match(html, /Retake photo/);
  assert.match(html, /Skip side/);
  assert.match(html, /no-upload|on-device placement/);
});

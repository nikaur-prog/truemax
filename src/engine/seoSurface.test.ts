import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    "/favicon.svg",
    "/src/style.css",
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

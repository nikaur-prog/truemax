import test from "node:test";
import assert from "node:assert/strict";
import { CELEBS } from "./celebs.js";
import { celebrityPortrait, celebrityPortraitSources, WITHHELD_PORTRAITS } from "./celebrityPortraits.js";
import { buildCelebrityPortrait, portraitCreditText } from "./portraitLicense.js";
import type { CommonsPortraitInfo } from "./portraitLicense.js";
import { portraitModule } from "../../scripts/sync-celebrity-portraits.js";

const valid = (): CommonsPortraitInfo => ({
  thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/330px-Example.jpg?tracking=removed",
  thumbwidth: 330, thumbheight: 440,
  descriptionurl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
  metadata: { Artist: "Example photographer", ObjectName: "Portrait title", LicenseShortName: "CC BY-SA 4.0", License: "cc-by-sa-4.0", LicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
});
const build = (input: CommonsPortraitInfo) => buildCelebrityPortrait("File:Example.jpg", input, "2026-09-07");

test("every reference has a reviewed portrait or an explicit withheld source", () => {
  let count = 0;
  for (const celeb of CELEBS) {
    const photo = celebrityPortrait(celeb.name);
    assert.notEqual(Boolean(photo), Boolean(WITHHELD_PORTRAITS[celeb.name]), celeb.name);
    assert.ok(celebrityPortraitSources()[celeb.name].startsWith("File:"));
    if (photo) count++;
  }
  assert.equal(count, 122);
  assert.equal(Object.keys(WITHHELD_PORTRAITS).length, 3);
  assert.match(WITHHELD_PORTRAITS["Sha'Carri Richardson"].reason, /License/);
});

test("catalog never ships original-resolution or tracking URLs and includes full credits", () => {
  for (const celeb of CELEBS) {
    const photo = celebrityPortrait(celeb.name);
    if (!photo) continue;
    const url = new URL(photo.src);
    assert.equal(url.origin, "https://thumb.wikimedia.org");
    assert.match(url.pathname, /^\/wikipedia\/commons\/thumb\/.*\/\d+px-/);
    assert.equal(url.search, "");
    assert.ok(photo.width > 0 && photo.width <= 330 && photo.height > 0 && photo.height <= 440);
    assert.ok(photo.author && photo.title && photo.sourceUrl && photo.licenseUrl && photo.verifiedAt);
    assert.match(photo.license, /^(CC BY(?:-SA)? (2\.0|3\.0|4\.0)|CC0|Public domain)$/);
  }
});

test("unknown names never resolve through object prototype properties", () => {
  for (const name of ["unknown", "toString", "constructor", "__proto__"]) assert.equal(celebrityPortrait(name), null);
});

test("policy strips query strings while retaining the supplied author and title", () => {
  const result = build(valid());
  assert.ok("portrait" in result);
  assert.equal(result.portrait.src.includes("?"), false);
  assert.equal(result.portrait.author, "Example photographer");
  assert.equal(result.portrait.title, "Portrait title");
});

test("policy withholds unsupported licenses and missing or mismatched attribution", () => {
  for (const metadata of [
    { LicenseShortName: "GFDL", License: "gfdl" },
    { LicenseShortName: "CC BY-NC 4.0", License: "cc-by-nc-4.0" },
    { LicenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
    { Artist: "" },
    { Restrictions: "noncommercial" },
  ]) {
    const input = valid();
    Object.assign(input.metadata, metadata);
    assert.ok("withheld" in build(input), JSON.stringify(metadata));
  }
});

test("policy withholds originals, unbounded sizes, foreign hosts and credentials", () => {
  for (const patch of [
    { thumburl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg" },
    { thumburl: valid().thumburl!.replace("330px", "1200px") },
    { thumburl: valid().thumburl!.replace("thumb.wikimedia.org", "evil.example") },
    { thumburl: valid().thumburl!.replace("https://", "https://user:pass@") },
    { thumbwidth: -1 }, { thumbheight: Number.NaN }, { thumbwidth: 331 }, { thumbheight: 441 },
    { descriptionurl: "https://evil.example/wiki/File:Example.jpg" },
  ]) assert.ok("withheld" in build({ ...valid(), ...patch }));
});

test("public domain and CC0 require consistent metadata, not just a label", () => {
  const input = valid();
  input.metadata = { ...input.metadata, LicenseShortName: "Public domain", License: "pd", Copyrighted: "False" };
  assert.ok("portrait" in build(input));
  input.metadata.Copyrighted = "True";
  assert.ok("withheld" in build(input));
  input.metadata = { ...input.metadata, LicenseShortName: "CC0", License: "cc0", LicenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/" };
  assert.ok("portrait" in build(input));
  input.metadata.LicenseUrl = "https://creativecommons.org/publicdomain/zero/1.0malicious";
  assert.ok("withheld" in build(input));
});

test("credit normalization removes HTML without losing attribution words", () => {
  const dash = "&" + "mdash;";
  assert.equal(portraitCreditText(`<a href='x'>A &amp; B</a> ${dash} &#169;`), "A & B - ©");
  assert.equal(portraitCreditText(`A${String.fromCharCode(0x2014)}B`), "A - B");
  assert.equal(portraitCreditText(null), "");
});

test("generator retains withheld sources and uses prototype-safe lookup", () => {
  const generated = portraitModule({}, { Example: { fileTitle: "File:Example.jpg", reason: "Needs review" } });
  assert.match(generated, /hasOwnProperty\.call/);
  assert.match(generated, /File:Example\.jpg/);
  assert.match(generated, /WITHHELD_PORTRAITS/);
});

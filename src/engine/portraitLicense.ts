export interface CelebrityPortrait {
  src: string;
  // Commons' requested display dimensions preserve the aspect ratio. Its CDN
  // can round to a 330px-wide bucket, so decoded height can exceed this value.
  width: number;
  height: number;
  fileTitle: string;
  title: string;
  sourceUrl: string;
  author: string;
  sourceCredit: string;
  attribution: string;
  copyrightNotice: string;
  license: string;
  licenseUrl: string;
  restrictions: string;
  verifiedAt: string;
}

export interface CommonsPortraitInfo {
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  descriptionurl?: string;
  metadata: Record<string, unknown>;
}

export function portraitCreditText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&(m|n)dash;/g, (_, kind: string) => kind === "m" ? " - " : "–")
    .split(String.fromCharCode(0x2014)).join(" - ")
    .replace(/\s+/g, " ").trim();
}

function trustedUrl(value: unknown, host: string): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && !url.port && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Reviewed licenses and width-bounded derivatives, never original files. */
export function buildCelebrityPortrait(
  fileTitle: string,
  info: CommonsPortraitInfo,
  verifiedAt: string,
): { portrait: CelebrityPortrait } | { withheld: string } {
  const m = info.metadata;
  const source = trustedUrl(info.descriptionurl, "commons.wikimedia.org");
  const thumb = trustedUrl(info.thumburl, "thumb.wikimedia.org");
  const pixels = thumb?.pathname.match(/\/([0-9]+)px-[^/]+$/);
  if (!source?.pathname.startsWith("/wiki/File:") || !fileTitle.startsWith("File:")) return { withheld: "Source needs review" };
  if (!thumb?.pathname.startsWith("/wikipedia/commons/thumb/") || !pixels || Number(pixels[1]) < 1 || Number(pixels[1]) > 330
    || !info.thumbwidth || !info.thumbheight || !Number.isFinite(info.thumbwidth) || !Number.isFinite(info.thumbheight)
    || info.thumbwidth < 1 || info.thumbheight < 1 || info.thumbwidth > 330 || info.thumbheight > 440) {
    return { withheld: "Bounded thumbnail unavailable" };
  }
  const author = portraitCreditText(m.Artist);
  const title = portraitCreditText(m.ObjectName) || fileTitle.slice(5);
  if (!author || !title || author.length > 1000) return { withheld: "Author credit needs review" };
  const license = portraitCreditText(m.LicenseShortName);
  const cc = license.match(/^CC (BY(?:-SA)?) (2\.0|3\.0|4\.0)$/);
  let licenseUrl = "";
  if (cc && m.License === `cc-${cc[1].toLowerCase()}-${cc[2]}`) {
    licenseUrl = `https://creativecommons.org/licenses/${cc[1].toLowerCase()}/${cc[2]}/`;
    const supplied = trustedUrl(m.LicenseUrl, "creativecommons.org");
    if (!supplied || supplied.href.replace(/\/$/, "") !== licenseUrl.replace(/\/$/, "")) return { withheld: "License link needs review" };
  } else if (license === "CC0" && m.License === "cc0") {
    const supplied = String(m.LicenseUrl ?? "").replace(/^http:/, "https:");
    if (!/^\/publicdomain\/zero\/1\.0\/?$/.test(trustedUrl(supplied, "creativecommons.org")?.pathname ?? "")) return { withheld: "License link needs review" };
    licenseUrl = "https://creativecommons.org/publicdomain/zero/1.0/";
  } else if (license === "Public domain" && m.License === "pd" && m.Copyrighted === "False") {
    licenseUrl = source.href;
  } else return { withheld: "License requires separate review" };
  const restrictions = portraitCreditText(m.Restrictions);
  if (restrictions && !/^(personality|trademarked)(\|(personality|trademarked))*$/.test(restrictions)) return { withheld: "Additional restrictions need review" };
  thumb.search = "";
  thumb.hash = "";
  source.search = "";
  source.hash = "";
  return { portrait: {
    src: thumb.href, width: info.thumbwidth, height: info.thumbheight, fileTitle, title,
    sourceUrl: source.href, author, sourceCredit: portraitCreditText(m.Credit),
    attribution: portraitCreditText(m.Attribution), copyrightNotice: portraitCreditText(m.CopyrightNotice),
    license, licenseUrl, restrictions, verifiedAt,
  } };
}

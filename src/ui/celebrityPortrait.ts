import { celebrityPortrait } from "../engine/celebrityPortraits.js";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Decorative beside the person's visible name. No original-size fallback. */
export function celebrityPortraitImage(name: string): string {
  const portrait = celebrityPortrait(name);
  if (!portrait) return "";
  return `<img src="${escape(portrait.src)}" alt="" aria-hidden="true" data-celebrity-portrait
    width="${portrait.width}" height="${portrait.height}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
}

export const PORTRAIT_DISCLOSURE = "Reference photos identify each person and may differ from the photos measured. No endorsement is implied.";

/** Every display context exposes its own credits without nesting links in cards. */
export function celebrityPortraitCredits(names: readonly string[]): string {
  const portraits = [...new Set(names)].map(celebrityPortrait).filter(p => p !== null);
  if (!portraits.length) return "";
  return `<details class="portrait-credits"><summary>Photo credits and sources</summary>
    <p>${PORTRAIT_DISCLOSURE}</p>
    <p>Displayed as Wikimedia thumbnails with a layout crop only. No facial edits. Source pages document any earlier crops or edits. Each photo retains its listed license.</p>
    <ul>${portraits.map(p => `<li><a href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(p.title)}</a>
      by ${escape(p.author)}. <a href="${escape(p.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(p.license)}</a>.
      ${p.sourceCredit ? `<span>Source credit: ${escape(p.sourceCredit)}.</span>` : ""}
      ${p.attribution ? `<span>${escape(p.attribution)}</span>` : ""}
      ${p.copyrightNotice ? `<span>${escape(p.copyrightNotice)}</span>` : ""}
      ${p.restrictions ? "<span>Personality or trademark rights may also apply.</span>" : ""}
    </li>`).join("")}</ul></details>`;
}

let fallbackInstalled = false;
export function installCelebrityPortraitFallback(): void {
  if (fallbackInstalled) return;
  fallbackInstalled = true;
  document.addEventListener("error", event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.matches("[data-celebrity-portrait]")) image.hidden = true;
  }, true);
}

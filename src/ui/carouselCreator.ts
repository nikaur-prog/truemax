import { currentAccessToken } from "../engine/auth.js";
import {
  CAROUSEL_MAX_DESCRIPTION,
  CAROUSEL_MAX_INSTRUCTION,
  CAROUSEL_MAX_SERIES_DIRECTION,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
  CAROUSEL_THEMES,
  carouselLevelCount,
  carouselLevelLabel,
  carouselOverlayCopy,
  carouselTheme,
} from "../engine/carouselSpec.js";
import type { CarouselThemeId } from "../engine/carouselSpec.js";
import { decodeImageDataUrl } from "./dataUrl.js";
import { exportName, outcomeMessage, saveFile } from "./saveFile.js";
import type { SaveOutcome } from "./saveFile.js";
import { buildStoredZip } from "./zipArchive.js";

type SlideSource = "synthetic" | "upload";
type UploadAction = "as-is" | "morph";
type CarouselLayout = "editorial" | "dossier" | "immersive";

interface CarouselSlideDraft {
  id: string;
  source: SlideSource;
  uploadAction: UploadAction;
  description: string;
  instruction: string;
  level: number;
  sourceDataUrl: string | null;
  generatedDataUrl: string | null;
  consent: boolean;
}

interface CarouselDraft {
  version: 2;
  theme: CarouselThemeId;
  includeCta: boolean;
  avatarDescription: string;
  seriesDirection: string;
  identityLock: boolean;
  layout: CarouselLayout;
  safeGuides: boolean;
  slides: CarouselSlideDraft[];
}

interface CarouselSession {
  host: HTMLElement;
  ownerId: string;
  draft: CarouselDraft;
  leave: () => void;
  run: number;
  busy: Set<string>;
  batchBusy: boolean;
  saveTimer: number | null;
}

let session: CarouselSession | null = null;
let runCounter = 0;

function slideId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function freshSlide(level: number): CarouselSlideDraft {
  return {
    id: slideId(),
    source: "synthetic",
    uploadAction: "as-is",
    description: "",
    instruction: "",
    level,
    sourceDataUrl: null,
    generatedDataUrl: null,
    consent: false,
  };
}

function progressionLevel(index: number, total: number, levelCount = 5): number {
  if (total <= 1) return 3;
  return Math.max(1, Math.min(levelCount, 1 + Math.round((index * (levelCount - 1)) / (total - 1))));
}

function rebalanceProgression(slides: CarouselSlideDraft[], theme: CarouselThemeId): void {
  const levelCount = carouselLevelCount(theme);
  slides.forEach((slide, index) => {
    slide.level = progressionLevel(index, slides.length, levelCount);
    invalidateGenerated(slide);
  });
}

function freshDraft(): CarouselDraft {
  return {
    version: 2,
    theme: "puffiness",
    includeCta: true,
    avatarDescription: "",
    seriesDirection: "One consistent camera, lighting setup, background and styling language across the full series.",
    identityLock: true,
    layout: "editorial",
    safeGuides: false,
    slides: Array.from({ length: 5 }, (_, index) => freshSlide(progressionLevel(index, 5))),
  };
}

function draftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("truemax-carousel-drafts", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("drafts")) request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadDraft(ownerId: string): Promise<CarouselDraft | null> {
  const db = await draftDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts", "readonly").objectStore("drafts").get(ownerId);
      request.onsuccess = () => resolve(request.result as CarouselDraft | null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function storeDraft(active: CarouselSession): Promise<void> {
  const db = await draftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction("drafts", "readwrite").objectStore("drafts").put(active.draft, active.ownerId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

function scheduleDraftSave(active: CarouselSession): void {
  if (active.saveTimer !== null) window.clearTimeout(active.saveTimer);
  active.saveTimer = window.setTimeout(() => {
    active.saveTimer = null;
    void storeDraft(active).catch(() => setMessage(active, "This browser could not save the draft. Keep this tab open.", true));
  }, 250);
}

function restoredText(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max)
    : "";
}

function restoredImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16 * 1024 * 1024) return null;
  return decodeImageDataUrl(value) ? value : null;
}

function normalizeDraft(value: unknown): CarouselDraft | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const theme = carouselTheme(saved.theme);
  if ((saved.version !== 1 && saved.version !== 2) || !theme || !Array.isArray(saved.slides)
    || saved.slides.length < CAROUSEL_MIN_SLIDES || saved.slides.length > CAROUSEL_MAX_SLIDES) return null;
  const savedSlides = saved.slides;
  const seen = new Set<string>();
  const slides = savedSlides.map((candidate, index): CarouselSlideDraft => {
    const raw = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    const savedId = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,80}$/.test(raw.id) ? raw.id : "";
    const id = savedId && !seen.has(savedId) ? savedId : slideId();
    seen.add(id);
    const source = raw.source === "upload" ? "upload" : "synthetic";
    const uploadAction = raw.uploadAction === "morph" ? "morph" : "as-is";
    const levelCount = theme.levels.length;
    const level = typeof raw.level === "number" && Number.isInteger(raw.level) && raw.level >= 1 && raw.level <= levelCount
      ? raw.level
      : progressionLevel(index, savedSlides.length, levelCount);
    return {
      id,
      source,
      uploadAction,
      description: restoredText(raw.description, CAROUSEL_MAX_DESCRIPTION),
      instruction: restoredText(raw.instruction, CAROUSEL_MAX_INSTRUCTION),
      level,
      sourceDataUrl: restoredImage(raw.sourceDataUrl),
      generatedDataUrl: restoredImage(raw.generatedDataUrl),
      consent: raw.consent === true,
    };
  });
  const layout: CarouselLayout = saved.layout === "dossier" || saved.layout === "immersive"
    ? saved.layout
    : "editorial";
  return {
    version: 2,
    theme: theme.id,
    includeCta: saved.includeCta !== false,
    avatarDescription: restoredText(saved.avatarDescription, CAROUSEL_MAX_DESCRIPTION),
    seriesDirection: restoredText(saved.seriesDirection, CAROUSEL_MAX_SERIES_DIRECTION)
      || "One consistent camera, lighting setup, background and styling language across the full series.",
    identityLock: saved.identityLock !== false,
    layout,
    safeGuides: saved.safeGuides === true,
    slides,
  };
}

function setMessage(active: CarouselSession, text: string, error = false): void {
  const node = active.host.querySelector<HTMLElement>("[data-carousel-message]");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("err", error);
}

function activeImage(slide: CarouselSlideDraft): string | null {
  if (slide.source === "upload" && slide.uploadAction === "as-is") return slide.sourceDataUrl;
  return slide.generatedDataUrl;
}

function needsProvider(slide: CarouselSlideDraft): boolean {
  return slide.source === "synthetic" || slide.uploadAction === "morph";
}

function invalidateGenerated(slide: CarouselSlideDraft): void {
  if (needsProvider(slide)) slide.generatedDataUrl = null;
}

function html(): string {
  return `<div class="q-modebar">
      <button type="button" class="linkish" data-carousel-back>← All modes</button>
      <span class="q-modebar-name">Carousel Creator</span>
      <span class="q-modebar-step">One identity across every stage</span>
    </div>
    <div class="carousel-shell">
      <header class="carousel-intro">
        <span class="klabel">CREATOR STUDIO</span>
        <h1>Build the swipe</h1>
        <p>Choose one default avatar, then show that exact person progressing from the strongest visible issue to the most optimised stage.</p>
      </header>
      <section class="carousel-settings" aria-label="Carousel settings">
        <label><span>Theme</span><select data-carousel-theme></select></label>
        <label><span>Slides</span><select data-carousel-count>${Array.from(
          { length: CAROUSEL_MAX_SLIDES - CAROUSEL_MIN_SLIDES + 1 },
          (_, index) => `<option value="${index + CAROUSEL_MIN_SLIDES}">${index + CAROUSEL_MIN_SLIDES}</option>`,
        ).join("")}</select></label>
        <label class="carousel-cta-check"><input type="checkbox" data-carousel-cta /><span>Add a final TrueMax CTA slide</span></label>
      </section>
      <p class="carousel-theme-note" data-carousel-theme-note></p>
      <section class="carousel-series" aria-labelledby="carousel-series-title">
        <div class="carousel-series-heading">
          <div><span class="klabel">SERIES SYSTEM</span><h2 id="carousel-series-title">Direct the whole story once</h2></div>
          <span class="carousel-premium-pill">Premium workflow</span>
        </div>
        <div class="carousel-series-grid">
          <label class="carousel-avatar-description"><span>Default avatar</span><textarea rows="3" maxlength="${CAROUSEL_MAX_DESCRIPTION}" data-carousel-avatar placeholder="Adult age 21–25, attractive short-form creator look, modern hair, build, clothing, setting and camera"></textarea></label>
          <label class="carousel-series-direction"><span>Series direction</span><textarea rows="3" maxlength="${CAROUSEL_MAX_SERIES_DIRECTION}" data-carousel-series-direction placeholder="The camera, light, setting and styling shared by every slide"></textarea></label>
          <label><span>Layout</span><select data-carousel-layout><option value="editorial">Editorial</option><option value="dossier">Dossier</option><option value="immersive">Immersive</option></select></label>
          <div class="carousel-series-toggles">
            <label class="carousel-cta-check"><input type="checkbox" data-carousel-identity-lock /><span>Lock the fictional identity from slide one</span></label>
            <label class="carousel-cta-check"><input type="checkbox" data-carousel-safe-guides /><span>Show TikTok safe-area guides</span></label>
          </div>
        </div>
        <div class="carousel-series-actions">
          <button type="button" class="btn gho" data-carousel-copy-character>Apply default avatar to every stage</button>
          <button type="button" class="btn pri" data-carousel-generate-series>Generate unfinished series</button>
        </div>
        <p class="carousel-series-help">Identity lock generates the first stage from your default avatar, then edits that exact fictional face through the remaining 3–6 stages. The final stage keeps the same anatomy while presenting the most polished, attractive version.</p>
      </section>
      <section class="carousel-storyboard" aria-labelledby="carousel-storyboard-title">
        <div class="carousel-storyboard-heading"><div><span class="klabel">STORYBOARD</span><h2 id="carousel-storyboard-title">The swipe at a glance</h2></div><span data-carousel-ready-count></span></div>
        <div class="carousel-filmstrip" data-carousel-filmstrip></div>
      </section>
      <div class="carousel-slides" data-carousel-slides></div>
      <div class="carousel-footer-actions">
        <button type="button" class="btn gho" data-carousel-add>Add a slide</button>
        <button type="button" class="btn pri" data-carousel-save-all>Export carousel pack</button>
      </div>
      <p class="q-ai-msg" data-carousel-message role="status"></p>
      <p class="carousel-privacy">Uploaded photos stay on this device when used as-is. A source is sent only after you choose Morph and confirm permission. Generated and morphed slides use one render each.</p>
    </div>`;
}

function slideHtml(active: CarouselSession, slide: CarouselSlideDraft, index: number, total: number): string {
  const usesProvider = needsProvider(slide);
  const ready = Boolean(activeImage(slide));
  const slideBusy = active.busy.has(slide.id);
  const structureBusy = active.busy.size > 0 || active.batchBusy;
  const fieldLock = slideBusy || active.batchBusy ? "disabled" : "";
  return `<article class="carousel-slide-card" data-slide-id="${slide.id}">
    <header><div><span class="klabel">SLIDE ${index + 1} OF ${total}</span><h2>${carouselLevelLabel(active.draft.theme, slide.level)}</h2></div>
      <div class="carousel-order">
        <button type="button" aria-label="Move slide up" data-move="up" ${structureBusy || index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" aria-label="Move slide down" data-move="down" ${structureBusy || index === total - 1 ? "disabled" : ""}>↓</button>
        <button type="button" aria-label="Remove slide" data-remove ${structureBusy || total <= CAROUSEL_MIN_SLIDES ? "disabled" : ""}>×</button>
      </div>
    </header>
    <div class="carousel-slide-grid">
      <div class="carousel-fields">
        <label><span>Source</span><select data-field="source" ${fieldLock}><option value="synthetic">Generate a character</option><option value="upload">Upload a photo</option></select></label>
        <label class="${slide.source === "upload" ? "" : "hidden"}"><span>Photo</span><input type="file" accept="image/jpeg,image/png,image/webp" data-upload ${fieldLock} /></label>
        <label class="${slide.source === "upload" ? "" : "hidden"}"><span>Use the photo</span><select data-field="uploadAction" ${fieldLock}><option value="as-is">As-is, on device</option><option value="morph">Morph this photo</option></select></label>
        <label class="${slide.source === "synthetic" && !active.draft.identityLock ? "" : "hidden"}"><span>Stage-specific avatar override</span><textarea rows="3" maxlength="500" data-field="description" placeholder="Leave the default avatar unchanged or override it for this stage" ${fieldLock}></textarea></label>
        <label class="${usesProvider ? "" : "hidden"}"><span>${slide.source === "synthetic" ? "Extra direction" : "Morph instruction"}</span><textarea rows="2" maxlength="320" data-field="instruction" placeholder="What should this level show?" ${fieldLock}></textarea></label>
        <label><span>Band</span><select data-field="level" ${fieldLock}>${Array.from({ length: carouselLevelCount(active.draft.theme) }, (_, levelIndex) => {
          const value = levelIndex + 1;
          return `<option value="${value}">${value}. ${carouselLevelLabel(active.draft.theme, value)}</option>`;
        }).join("")}</select></label>
        <label class="carousel-permission ${slide.source === "upload" && slide.uploadAction === "morph" ? "" : "hidden"}">
          <input type="checkbox" data-field="consent" ${fieldLock} /><span>I have permission to use this source and understand it will be sent to the image provider.</span>
        </label>
        <button type="button" class="btn pri ${usesProvider ? "" : "hidden"}" data-generate ${fieldLock}>${slideBusy ? "Generating one slide..." : ready ? "Redo this slide" : "Generate this slide"}</button>
      </div>
      <div class="carousel-preview ${ready ? "ready" : ""} ${active.draft.safeGuides ? "safe-guides" : ""}" data-preview>
        ${ready ? `<button type="button" data-zoom title="Enlarge slide"><img alt="Finished slide ${index + 1}" /></button>
          <div class="carousel-preview-actions"><button type="button" class="btn" data-save>Save slide</button></div>`
          : `<div class="carousel-empty"><b>${slide.source === "upload" ? "Attach a source" : "Describe the character"}</b><span>The finished 9:16 slide appears here.</span></div>`}
      </div>
    </div>
  </article>`;
}

function hydrateCard(card: HTMLElement, slide: CarouselSlideDraft): void {
  const source = card.querySelector<HTMLSelectElement>('[data-field="source"]');
  const action = card.querySelector<HTMLSelectElement>('[data-field="uploadAction"]');
  const description = card.querySelector<HTMLTextAreaElement>('[data-field="description"]');
  const instruction = card.querySelector<HTMLTextAreaElement>('[data-field="instruction"]');
  const level = card.querySelector<HTMLSelectElement>('[data-field="level"]');
  const consent = card.querySelector<HTMLInputElement>('[data-field="consent"]');
  if (source) source.value = slide.source;
  if (action) action.value = slide.uploadAction;
  if (description) description.value = slide.description;
  if (instruction) instruction.value = slide.instruction;
  if (level) level.value = String(slide.level);
  if (consent) consent.checked = slide.consent;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be opened"));
    image.src = src;
  });
}

function cover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = Math.max(0, (image.naturalHeight - sourceHeight) * 0.38);
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

async function composeSlide(active: CarouselSession, slide: CarouselSlideDraft): Promise<string | null> {
  const source = activeImage(slide);
  const position = active.draft.slides.findIndex((candidate) => candidate.id === slide.id) + 1;
  const overlay = carouselOverlayCopy(active.draft.theme, slide.level, position, active.draft.slides.length);
  if (!source || !overlay) return null;
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "center";
  if (active.draft.layout === "dossier") {
    ctx.fillStyle = "#f4f2ed";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#121615";
    ctx.font = "800 34px Inter, Arial, sans-serif";
    ctx.fillText(overlay.position, 540, 70);
    ctx.font = "900 64px Inter, Arial, sans-serif";
    ctx.fillText(overlay.themeTitle, 540, 154, 940);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(54, 214, 972, 1300, 34);
    ctx.clip();
    cover(ctx, image, 54, 214, 972, 1300);
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(54, 1470, 972, 350, 32);
    ctx.fill();
    ctx.fillStyle = "#0aa889";
    ctx.fillRect(98, 1516, 884, 7);
    ctx.fillStyle = "#111514";
    ctx.font = "900 90px Inter, Arial, sans-serif";
    ctx.fillText(overlay.levelLabel, 540, 1646, 860);
    ctx.fillStyle = "rgba(17,21,20,.62)";
    ctx.font = "600 26px Inter, Arial, sans-serif";
    ctx.fillText(overlay.note, 540, 1718, 840);
    ctx.fillStyle = "#078b73";
    ctx.font = "800 30px Inter, Arial, sans-serif";
    ctx.fillText(overlay.brand, 540, 1780);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const imageTop = active.draft.layout === "immersive" ? 0 : 220;
    const imageHeight = active.draft.layout === "immersive" ? 1920 : 1450;
    cover(ctx, image, 0, imageTop, 1080, imageHeight);
    const shade = ctx.createLinearGradient(0, active.draft.layout === "immersive" ? 1000 : 1120, 0, 1920);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(0.55, "rgba(0,0,0,.7)");
    shade.addColorStop(1, "#000");
    ctx.fillStyle = shade;
    ctx.fillRect(0, active.draft.layout === "immersive" ? 850 : 1120, 1080, active.draft.layout === "immersive" ? 1070 : 800);
    if (active.draft.layout === "immersive") {
      ctx.fillStyle = "rgba(0,0,0,.58)";
      ctx.beginPath();
      ctx.roundRect(64, 62, 168, 64, 32);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "800 30px Inter, Arial, sans-serif";
      ctx.fillText(overlay.position, 148, 105);
      ctx.textAlign = "left";
      ctx.font = "900 54px Inter, Arial, sans-serif";
      ctx.fillText(overlay.themeTitle, 64, 184, 930);
      ctx.textAlign = "center";
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = "900 54px Inter, Arial, sans-serif";
      ctx.fillText(overlay.position, 540, 74);
      ctx.font = "900 72px Inter, Arial, sans-serif";
      ctx.fillText(overlay.themeTitle, 540, 162, 980);
    }
    ctx.fillStyle = "#10d8b0";
    ctx.fillRect(76, 1570, 928, 6);
    ctx.fillStyle = "#fff";
    ctx.font = "900 96px Inter, Arial, sans-serif";
    ctx.fillText(overlay.levelLabel, 540, 1715, 930);
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.font = "600 28px Inter, Arial, sans-serif";
    ctx.fillText(overlay.note, 540, 1788, 930);
    ctx.fillStyle = "#10d8b0";
    ctx.font = "800 32px Inter, Arial, sans-serif";
    ctx.fillText(overlay.brand, 540, 1870);
  }
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function composeCta(): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 1080, 1920);
  const glow = ctx.createRadialGradient(540, 850, 20, 540, 850, 700);
  glow.addColorStop(0, "rgba(16,216,176,.28)");
  glow.addColorStop(1, "rgba(16,216,176,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.textAlign = "center";
  ctx.fillStyle = "#10d8b0";
  ctx.font = "800 42px Inter, Arial, sans-serif";
  ctx.fillText("TRUEMAX", 540, 420);
  ctx.fillStyle = "#fff";
  ctx.font = "900 116px Inter, Arial, sans-serif";
  ctx.fillText("FIND YOUR", 540, 780);
  ctx.fillText("NEXT MOVE", 540, 910);
  ctx.fillStyle = "rgba(255,255,255,.78)";
  ctx.font = "600 42px Inter, Arial, sans-serif";
  ctx.fillText("Measure your face on your device.", 540, 1035);
  ctx.fillStyle = "#10d8b0";
  ctx.fillRect(180, 1150, 720, 112);
  ctx.fillStyle = "#00140f";
  ctx.font = "900 46px Inter, Arial, sans-serif";
  ctx.fillText("TRUEMAX.APP", 540, 1225);
  ctx.fillStyle = "rgba(255,255,255,.48)";
  ctx.font = "500 28px Inter, Arial, sans-serif";
  ctx.fillText("ON-DEVICE FACIAL MEASUREMENT", 540, 1510);
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function normalizedUpload(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG or WebP under 12 MB.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the photo.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.76, 0.64]) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      const decoded = decodeImageDataUrl(candidate);
      if (decoded && decoded.blob.size <= 3 * 1024 * 1024) return candidate;
    }
    throw new Error("The normalized photo is still too large. Choose a simpler or smaller image.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function saveDataUrl(dataUrl: string, label: string): Promise<SaveOutcome> {
  const decoded = decodeImageDataUrl(dataUrl);
  if (!decoded) throw new Error("The finished slide is not a safe image.");
  return await saveFile(decoded.blob, exportName("carousel", decoded.extension, label), "carousel");
}

function showZoom(dataUrl: string, alt: string): void {
  document.querySelector(".carousel-zoom")?.remove();
  const modal = document.createElement("div");
  modal.className = "carousel-zoom";
  modal.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Slide preview"><button type="button" aria-label="Close preview">×</button><img alt="" /></div>`;
  const image = modal.querySelector("img");
  if (image) {
    image.src = dataUrl;
    image.alt = alt;
  }
  const close = () => modal.remove();
  modal.querySelector("button")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.body.appendChild(modal);
}

function renderFilmstrip(active: CarouselSession): void {
  const host = active.host.querySelector<HTMLElement>("[data-carousel-filmstrip]");
  if (!host) return;
  host.innerHTML = active.draft.slides.map((slide, index) => {
    const image = activeImage(slide);
    return `<button type="button" class="carousel-film-tile ${image ? "ready" : ""}" data-film-slide="${slide.id}">
      <span class="carousel-film-number">${String(index + 1).padStart(2, "0")}</span>
      ${image ? `<img alt="Slide ${index + 1} source preview" />` : `<span class="carousel-film-placeholder">${carouselLevelLabel(active.draft.theme, slide.level)}</span>`}
      <b>${carouselLevelLabel(active.draft.theme, slide.level)}</b>
    </button>`;
  }).join("") + (active.draft.includeCta
    ? `<div class="carousel-film-tile carousel-film-cta"><span class="carousel-film-number">CTA</span><strong>TRUEMAX</strong><b>Final slide</b></div>`
    : "");
  active.draft.slides.forEach((slide) => {
    const tile = host.querySelector<HTMLElement>(`[data-film-slide="${slide.id}"]`);
    const image = tile?.querySelector<HTMLImageElement>("img");
    if (image) image.src = activeImage(slide) ?? "";
    tile?.addEventListener("click", () => {
      active.host.querySelector(`[data-slide-id="${slide.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  const count = active.host.querySelector<HTMLElement>("[data-carousel-ready-count]");
  if (count) {
    const ready = active.draft.slides.filter((slide) => activeImage(slide)).length;
    count.textContent = `${ready} of ${active.draft.slides.length} ready`;
  }
}

async function repaintPreview(active: CarouselSession, slide: CarouselSlideDraft): Promise<void> {
  const card = active.host.querySelector<HTMLElement>(`[data-slide-id="${slide.id}"]`);
  if (!card) return;
  const preview = card.querySelector<HTMLElement>("[data-preview]");
  if (!preview) return;
  const composed = await composeSlide(active, slide).catch(() => null);
  if (!composed || session !== active || !card.isConnected) return;
  preview.classList.add("ready");
  preview.innerHTML = `<button type="button" data-zoom title="Enlarge slide"><img alt="Finished slide" /></button>
    <div class="carousel-preview-actions"><button type="button" class="btn" data-save>Save slide</button></div>`;
  const image = preview.querySelector("img");
  if (image) image.src = composed;
  preview.querySelector("[data-zoom]")?.addEventListener("click", () => showZoom(composed, "Finished carousel slide"));
  preview.querySelector("[data-save]")?.addEventListener("click", () => {
    void saveDataUrl(composed, `slide-${slide.level}`).then((outcome) => setMessage(active, outcomeMessage(outcome))).catch((error) => {
      setMessage(active, error instanceof Error ? error.message : "The slide could not be saved.", true);
    });
  });
}

function renderSlides(active: CarouselSession): void {
  const host = active.host.querySelector<HTMLElement>("[data-carousel-slides]");
  if (!host) return;
  host.innerHTML = active.draft.slides.map((slide, index) => slideHtml(active, slide, index, active.draft.slides.length)).join("");
  active.draft.slides.forEach((slide) => {
    const card = host.querySelector<HTMLElement>(`[data-slide-id="${slide.id}"]`);
    if (!card) return;
    hydrateCard(card, slide);
    bindCard(active, card, slide);
    if (activeImage(slide)) void repaintPreview(active, slide);
  });
  const count = active.host.querySelector<HTMLSelectElement>("[data-carousel-count]");
  if (count) {
    count.value = String(active.draft.slides.length);
    count.disabled = active.busy.size > 0;
  }
  const theme = active.host.querySelector<HTMLSelectElement>("[data-carousel-theme]");
  if (theme) theme.disabled = active.busy.size > 0;
  const add = active.host.querySelector<HTMLButtonElement>("[data-carousel-add]");
  if (add) add.disabled = active.busy.size > 0 || active.batchBusy || active.draft.slides.length >= CAROUSEL_MAX_SLIDES;
  const generateSeries = active.host.querySelector<HTMLButtonElement>("[data-carousel-generate-series]");
  if (generateSeries) {
    generateSeries.disabled = active.busy.size > 0 || active.batchBusy;
    generateSeries.textContent = active.batchBusy ? "Generating series…" : "Generate unfinished series";
  }
  renderFilmstrip(active);
}

function updateThemeNote(active: CarouselSession): void {
  const theme = carouselTheme(active.draft.theme);
  const note = active.host.querySelector<HTMLElement>("[data-carousel-theme-note]");
  if (note) note.textContent = theme?.note ?? "";
}

function bindCard(active: CarouselSession, card: HTMLElement, slide: CarouselSlideDraft): void {
  card.querySelector<HTMLSelectElement>('[data-field="source"]')?.addEventListener("change", (event) => {
    if (active.busy.has(slide.id)) return;
    slide.source = (event.currentTarget as HTMLSelectElement).value === "upload" ? "upload" : "synthetic";
    slide.generatedDataUrl = null;
    scheduleDraftSave(active);
    renderSlides(active);
  });
  card.querySelector<HTMLSelectElement>('[data-field="uploadAction"]')?.addEventListener("change", (event) => {
    if (active.busy.has(slide.id)) return;
    slide.uploadAction = (event.currentTarget as HTMLSelectElement).value === "morph" ? "morph" : "as-is";
    slide.generatedDataUrl = null;
    slide.consent = false;
    scheduleDraftSave(active);
    renderSlides(active);
  });
  card.querySelector<HTMLTextAreaElement>('[data-field="description"]')?.addEventListener("input", (event) => {
    if (active.busy.has(slide.id)) return;
    slide.description = (event.currentTarget as HTMLTextAreaElement).value;
    scheduleDraftSave(active);
  });
  card.querySelector<HTMLTextAreaElement>('[data-field="instruction"]')?.addEventListener("input", (event) => {
    if (active.busy.has(slide.id)) return;
    slide.instruction = (event.currentTarget as HTMLTextAreaElement).value;
    scheduleDraftSave(active);
  });
  card.querySelector<HTMLSelectElement>('[data-field="level"]')?.addEventListener("change", (event) => {
    if (active.busy.has(slide.id)) return;
    slide.level = Number((event.currentTarget as HTMLSelectElement).value);
    invalidateGenerated(slide);
    scheduleDraftSave(active);
    renderSlides(active);
  });
  card.querySelector<HTMLInputElement>('[data-field="consent"]')?.addEventListener("change", (event) => {
    if (active.busy.has(slide.id)) return;
    slide.consent = (event.currentTarget as HTMLInputElement).checked;
    scheduleDraftSave(active);
  });
  card.querySelector<HTMLInputElement>("[data-upload]")?.addEventListener("change", (event) => {
    if (active.busy.has(slide.id)) return;
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    void normalizedUpload(file).then((dataUrl) => {
      slide.sourceDataUrl = dataUrl;
      slide.generatedDataUrl = null;
      scheduleDraftSave(active);
      renderSlides(active);
      if (slide.uploadAction === "as-is") setMessage(active, "Source ready. It has not left this device.");
    }).catch((error) => setMessage(active, error instanceof Error ? error.message : "The photo could not be opened.", true));
  });
  card.querySelector("[data-generate]")?.addEventListener("click", () => void generateSlide(active, slide));
  card.querySelector("[data-remove]")?.addEventListener("click", () => {
    if (active.busy.size > 0 || active.draft.slides.length <= CAROUSEL_MIN_SLIDES) return;
    active.draft.slides = active.draft.slides.filter((candidate) => candidate.id !== slide.id);
    rebalanceProgression(active.draft.slides, active.draft.theme);
    scheduleDraftSave(active);
    renderSlides(active);
  });
  for (const move of card.querySelectorAll<HTMLButtonElement>("[data-move]")) {
    move.addEventListener("click", () => {
      if (active.busy.size > 0) return;
      const index = active.draft.slides.findIndex((candidate) => candidate.id === slide.id);
      const next = move.dataset.move === "up" ? index - 1 : index + 1;
      if (index < 0 || next < 0 || next >= active.draft.slides.length) return;
      [active.draft.slides[index], active.draft.slides[next]] = [active.draft.slides[next], active.draft.slides[index]];
      scheduleDraftSave(active);
      renderSlides(active);
    });
  }
}

function identityAnchor(active: CarouselSession, slide: CarouselSlideDraft): string | null {
  if (!active.draft.identityLock) return null;
  const index = active.draft.slides.findIndex((candidate) => candidate.id === slide.id);
  const first = active.draft.slides[0];
  if (index <= 0 || !first || first.source !== "synthetic") return null;
  return activeImage(first);
}

async function generateSlide(active: CarouselSession, slide: CarouselSlideDraft): Promise<boolean> {
  if (active.busy.has(slide.id)) return false;
  const anchor = identityAnchor(active, slide);
  const defaultAvatar = active.draft.avatarDescription.trim();
  const description = active.draft.identityLock
    ? defaultAvatar
    : slide.description.trim() || defaultAvatar;
  if (slide.source === "upload" && slide.uploadAction === "as-is") {
    setMessage(active, "Source ready. Choose morph if you want the provider to change it.");
    await repaintPreview(active, slide);
    return true;
  }
  if (slide.source === "synthetic" && !anchor && !description) {
    setMessage(active, "Describe the default avatar before generating the progression.", true);
    return false;
  }
  if (slide.source === "upload" && !slide.sourceDataUrl) {
    setMessage(active, "Attach the source photo first.", true);
    return false;
  }
  if (slide.source === "upload" && slide.uploadAction === "morph" && !slide.consent) {
    setMessage(active, "Confirm permission before sending the source to the image provider.", true);
    return false;
  }
  const token = await currentAccessToken().catch(() => null);
  if (!token) {
    setMessage(active, "Your session expired. Sign in again before generating.", true);
    return false;
  }
  active.busy.add(slide.id);
  renderSlides(active);
  setMessage(active, "Generating this slide. Its settings and the carousel order are locked until it returns.");
  const requestRun = active.run;
  const requestState = {
    theme: active.draft.theme,
    position: active.draft.slides.findIndex((candidate) => candidate.id === slide.id) + 1,
    level: slide.level,
    total: active.draft.slides.length,
    source: slide.source,
    uploadAction: slide.uploadAction,
    description,
    instruction: slide.instruction,
    sourceDataUrl: slide.sourceDataUrl,
    providerSourceMode: anchor ? "morph" : slide.source === "synthetic" ? "synthetic" : "morph",
    providerSourceDataUrl: anchor ?? (slide.source === "upload" ? slide.sourceDataUrl : null),
    seriesDirection: active.draft.seriesDirection,
  };
  try {
    const response = await fetch("/api/carousel-slide", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        theme: requestState.theme,
        position: requestState.position,
        level: requestState.level,
        total: requestState.total,
        sourceMode: requestState.providerSourceMode,
        description: requestState.description,
        instruction: requestState.instruction,
        sourceDataUrl: requestState.providerSourceDataUrl ?? undefined,
        seriesDirection: requestState.seriesDirection,
      }),
    });
    const payload = await response.json().catch(() => null) as { image?: unknown; error?: unknown } | null;
    if (!response.ok || typeof payload?.image !== "string" || !decodeImageDataUrl(payload.image)) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "The image service returned no usable slide.");
    }
    const currentSlide = active.draft.slides.find((candidate) => candidate.id === slide.id);
    const currentPosition = active.draft.slides.findIndex((candidate) => candidate.id === slide.id) + 1;
    if (!currentSlide) return false;
    if (active.draft.theme !== requestState.theme || currentPosition !== requestState.position
      || currentSlide.level !== requestState.level || active.draft.slides.length !== requestState.total
      || currentSlide.source !== requestState.source || currentSlide.uploadAction !== requestState.uploadAction
      || (active.draft.identityLock ? active.draft.avatarDescription.trim() : currentSlide.description.trim() || active.draft.avatarDescription.trim()) !== requestState.description
      || currentSlide.instruction !== requestState.instruction
      || currentSlide.sourceDataUrl !== requestState.sourceDataUrl
      || active.draft.seriesDirection !== requestState.seriesDirection
      || identityAnchor(active, currentSlide) !== anchor) {
      if (session === active && active.run === requestRun) {
        setMessage(active, "This slide changed while it was generating. Generate it again with the current settings.", true);
      }
      return false;
    }
    currentSlide.generatedDataUrl = payload.image;
    await storeDraft(active);
    if (session === active && active.run === requestRun) {
      renderSlides(active);
      setMessage(active, "Slide ready. Tap it to inspect the full-size result.");
    }
    return true;
  } catch (error) {
    if (session === active && active.run === requestRun) {
      setMessage(active, error instanceof Error ? error.message : "The slide could not be generated.", true);
    }
    return false;
  } finally {
    active.busy.delete(slide.id);
    if (session === active && active.run === requestRun) {
      renderSlides(active);
    }
  }
}

async function generateSeries(active: CarouselSession): Promise<void> {
  if (active.batchBusy || active.busy.size > 0) return;
  if (active.draft.identityLock && active.draft.slides[0]?.source !== "synthetic") {
    setMessage(active, "Identity lock needs slide one to be a generated fictional character. Turn it off to mix uploaded sources.", true);
    return;
  }
  if (!active.draft.avatarDescription.trim() && active.draft.slides[0]?.source === "synthetic") {
    setMessage(active, "Describe the default avatar before generating the progression.", true);
    return;
  }
  active.batchBusy = true;
  renderSlides(active);
  const unfinished = active.draft.slides.filter((slide) => !activeImage(slide));
  if (!unfinished.length) {
    setMessage(active, "Every slide is already ready. Redo an individual slide if you want a new version.");
    active.batchBusy = false;
    renderSlides(active);
    return;
  }
  setMessage(active, `Building ${unfinished.length} unfinished slide${unfinished.length === 1 ? "" : "s"} in story order.`);
  try {
    for (const slide of unfinished) {
      const ok = await generateSlide(active, slide);
      if (!ok) break;
    }
  } finally {
    active.batchBusy = false;
    renderSlides(active);
  }
  const remaining = active.draft.slides.filter((slide) => !activeImage(slide)).length;
  setMessage(active, remaining ? `${remaining} slide${remaining === 1 ? "" : "s"} still need attention.` : "The full series is ready to review in the storyboard.", remaining > 0);
}

async function saveAll(active: CarouselSession): Promise<void> {
  const ready = active.draft.slides.filter((slide) => activeImage(slide));
  if (!ready.length) {
    setMessage(active, "Finish at least one slide before saving.", true);
    return;
  }
  setMessage(active, `Packing ${ready.length}${active.draft.includeCta ? " plus the CTA" : ""} into one ordered ZIP with a caption draft.`);
  try {
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < ready.length; index += 1) {
      const slide = ready[index];
      const dataUrl = await composeSlide(active, slide);
      if (!dataUrl) continue;
      const decoded = decodeImageDataUrl(dataUrl);
      if (!decoded) continue;
      files[`${String(index + 1).padStart(2, "0")}-${carouselLevelLabel(active.draft.theme, slide.level).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`] = new Uint8Array(await decoded.blob.arrayBuffer());
    }
    if (active.draft.includeCta) {
      const decoded = decodeImageDataUrl(await composeCta());
      if (decoded) files[`${String(ready.length + 1).padStart(2, "0")}-truemax-cta.jpg`] = new Uint8Array(await decoded.blob.arrayBuffer());
    }
    const theme = carouselTheme(active.draft.theme);
    const levels = ready.map((slide) => carouselLevelLabel(active.draft.theme, slide.level).toLowerCase()).join(" → ");
    files["caption.txt"] = new TextEncoder().encode([
      `${theme?.label ?? "TrueMax visual comparison"}: ${levels}.`,
      "",
      theme?.note ?? "Visual comparison only.",
      "",
      "Measure your face and build your next move at truemax.app.",
    ].join("\n"));
    const zip = buildStoredZip(files);
    const outcome = await saveFile(
      new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }),
      exportName("carousel", "zip", `${theme?.label ?? "series"}-pack`),
      "carousel",
    );
    setMessage(active, outcomeMessage(outcome));
  } catch (error) {
    setMessage(active, error instanceof Error ? error.message : "The carousel pack could not be saved.", true);
  }
}

function bindShell(active: CarouselSession): void {
  const theme = active.host.querySelector<HTMLSelectElement>("[data-carousel-theme]");
  if (theme) {
    theme.innerHTML = CAROUSEL_THEMES.map((item) => `<option value="${item.id}">${item.label}</option>`).join("");
    theme.value = active.draft.theme;
    theme.addEventListener("change", () => {
      if (active.busy.size > 0) return;
      const next = carouselTheme(theme.value);
      if (!next) return;
      active.draft.theme = next.id;
      // The profile preset is authored as a complete six-step ladder. Start
      // with all six visible so the exported sequence cannot silently skip an
      // intermediate band; the operator can still choose 3–5 afterwards.
      if (next.id === "jawline-strength") {
        while (active.draft.slides.length < CAROUSEL_MAX_SLIDES) {
          active.draft.slides.push(freshSlide(CAROUSEL_MAX_SLIDES));
        }
        active.host.querySelector<HTMLSelectElement>("[data-carousel-count]")!.value = String(active.draft.slides.length);
      }
      rebalanceProgression(active.draft.slides, active.draft.theme);
      scheduleDraftSave(active);
      updateThemeNote(active);
      renderSlides(active);
    });
  }
  const count = active.host.querySelector<HTMLSelectElement>("[data-carousel-count]");
  if (count) {
    count.value = String(active.draft.slides.length);
    count.addEventListener("change", () => {
      if (active.busy.size > 0) return;
      const desired = Number(count.value);
      while (active.draft.slides.length < desired) active.draft.slides.push(freshSlide(5));
      if (active.draft.slides.length > desired) active.draft.slides.splice(desired);
      rebalanceProgression(active.draft.slides, active.draft.theme);
      scheduleDraftSave(active);
      renderSlides(active);
    });
  }
  const cta = active.host.querySelector<HTMLInputElement>("[data-carousel-cta]");
  if (cta) {
    cta.checked = active.draft.includeCta;
    cta.addEventListener("change", () => {
      active.draft.includeCta = cta.checked;
      scheduleDraftSave(active);
      renderFilmstrip(active);
    });
  }
  const direction = active.host.querySelector<HTMLTextAreaElement>("[data-carousel-series-direction]");
  if (direction) {
    direction.value = active.draft.seriesDirection;
    direction.addEventListener("input", () => {
      active.draft.seriesDirection = direction.value.slice(0, CAROUSEL_MAX_SERIES_DIRECTION);
      scheduleDraftSave(active);
    });
  }
  const avatar = active.host.querySelector<HTMLTextAreaElement>("[data-carousel-avatar]");
  if (avatar) {
    avatar.value = active.draft.avatarDescription;
    avatar.addEventListener("input", () => {
      active.draft.avatarDescription = avatar.value.slice(0, CAROUSEL_MAX_DESCRIPTION);
      scheduleDraftSave(active);
    });
  }
  const layout = active.host.querySelector<HTMLSelectElement>("[data-carousel-layout]");
  if (layout) {
    layout.value = active.draft.layout;
    layout.addEventListener("change", () => {
      active.draft.layout = layout.value === "dossier" || layout.value === "immersive" ? layout.value : "editorial";
      scheduleDraftSave(active);
      renderSlides(active);
      setMessage(active, `${layout.selectedOptions[0]?.textContent ?? "Layout"} applied to every preview and export.`);
    });
  }
  const identity = active.host.querySelector<HTMLInputElement>("[data-carousel-identity-lock]");
  if (identity) {
    identity.checked = active.draft.identityLock;
    identity.addEventListener("change", () => {
      active.draft.identityLock = identity.checked;
      scheduleDraftSave(active);
      renderSlides(active);
      setMessage(active, identity.checked
        ? "Identity lock is on. Slide one becomes the source for the fictional series."
        : "Identity lock is off. Each generated slide can use a different character.");
    });
  }
  const safeGuides = active.host.querySelector<HTMLInputElement>("[data-carousel-safe-guides]");
  if (safeGuides) {
    safeGuides.checked = active.draft.safeGuides;
    safeGuides.addEventListener("change", () => {
      active.draft.safeGuides = safeGuides.checked;
      scheduleDraftSave(active);
      renderSlides(active);
    });
  }
  active.host.querySelector("[data-carousel-copy-character]")?.addEventListener("click", () => {
    if (active.busy.size > 0 || active.batchBusy) return;
    const anchor = active.draft.avatarDescription.trim();
    if (!anchor) {
      setMessage(active, "Describe the default avatar first.", true);
      return;
    }
    for (const slide of active.draft.slides.slice(1)) {
      if (slide.source !== "synthetic") continue;
      slide.description = anchor;
      invalidateGenerated(slide);
    }
    scheduleDraftSave(active);
    renderSlides(active);
    setMessage(active, "The default avatar now seeds every synthetic stage.");
  });
  active.host.querySelector("[data-carousel-generate-series]")?.addEventListener("click", () => void generateSeries(active));
  active.host.querySelector("[data-carousel-back]")?.addEventListener("click", active.leave);
  active.host.querySelector("[data-carousel-add]")?.addEventListener("click", () => {
    if (active.busy.size > 0 || active.draft.slides.length >= CAROUSEL_MAX_SLIDES) return;
    active.draft.slides.push(freshSlide(5));
    rebalanceProgression(active.draft.slides, active.draft.theme);
    scheduleDraftSave(active);
    renderSlides(active);
  });
  active.host.querySelector("[data-carousel-save-all]")?.addEventListener("click", () => void saveAll(active));
  updateThemeNote(active);
  renderSlides(active);
}

export async function openCarouselCreator(host: HTMLElement, ownerId: string, leave: () => void): Promise<void> {
  if (session?.host === host && session.ownerId === ownerId) {
    session.leave = leave;
    document.body.classList.add("carousel-open");
    renderSlides(session);
    setMessage(session, session.busy.size > 0 ? "Your slide is still generating." : "Your draft is ready.");
    return;
  }
  if (session?.busy.size) return;
  closeCarouselCreator();
  const run = ++runCounter;
  document.body.classList.add("carousel-open");
  host.innerHTML = html();
  const restored = await loadDraft(ownerId).catch(() => null);
  if (run !== runCounter) return;
  const recovered = normalizeDraft(restored);
  const active: CarouselSession = {
    host,
    ownerId,
    draft: recovered ?? freshDraft(),
    leave,
    run,
    busy: new Set(),
    batchBusy: false,
    saveTimer: null,
  };
  session = active;
  bindShell(active);
  setMessage(active, recovered ? "Draft recovered from this account on this device." : "Choose a theme, then build each slide.");
}

export function closeCarouselCreator(): void {
  document.body.classList.remove("carousel-open");
  document.querySelector(".carousel-zoom")?.remove();
  const closing = session;
  if (closing?.saveTimer !== null && closing?.saveTimer !== undefined) {
    window.clearTimeout(closing.saveTimer);
    closing.saveTimer = null;
  }
  if (closing) void storeDraft(closing).catch(() => undefined);
  if (closing?.busy.size) return;
  runCounter += 1;
  session = null;
}

window.addEventListener("beforeunload", (event) => {
  if (!session?.busy.size) return;
  event.preventDefault();
  event.returnValue = "";
});

import { applyEnhance, LOOKS, lookFor, upscaleFor } from "../engine/enhance.js";
import { enhanceVideo } from "./enhanceExport.js";

// ---------------------------------------------------------------------------
// The Enhance pillar: sharper, cleaner clips and photos, on the device.
//
// Two tiers, honestly labelled. The tier that ships is ON-DEVICE: clean
// resample toward 1080p, unsharp mask, colour and contrast — operations that
// recover what compression smeared, and cannot hallucinate. The server tier
// ("Studio") is a visible placeholder and stays OFF: the first engine we
// evaluated (a state-of-the-art commercial video enhancer) plasticised a
// face, and we will not ship a quality tool that makes faces worse. The
// placeholder exists so the pillar's shape is set and the day an engine
// passes our bar it has somewhere to live.
//
// The before/after wipe is the whole argument of the UI: nobody should
// export an "enhancement" they have not seen against the original. The wipe
// runs the same applyEnhance the export runs — the preview cannot lie.
// ---------------------------------------------------------------------------

interface EnhItem {
  kind: "image" | "video";
  name: string;
  url: string;
  file: File;
  image?: HTMLImageElement;
  video?: HTMLVideoElement;
}

let host: HTMLDivElement | null = null;
let items: EnhItem[] = [];
let selected = 0;
let lookKey: keyof typeof LOOKS = "standard";
let busy = false;
// The wipe position, 0..1. Half-and-half is the honest default.
let wipe = 0.5;
// Preview pixels are cached per (item, look): the enhance pass at preview
// size is cheap but not free, and the wipe slider repaints constantly.
let cachedFor = "";
let origCanvas: HTMLCanvasElement | null = null;
let enhCanvas: HTMLCanvasElement | null = null;

export function closeEnhancePanel(): void {
  if (busy) return;
  for (const it of items) URL.revokeObjectURL(it.url);
  items = [];
  selected = 0;
  lookKey = "standard";
  wipe = 0.5;
  cachedFor = "";
  origCanvas = null;
  enhCanvas = null;
  host?.remove();
  host = null;
}

export function openEnhancePanel(): void {
  closeEnhancePanel();
  const el = document.createElement("div");
  host = el;
  el.className = "brp enh";
  el.innerHTML = `
    <div class="brp-card" role="dialog" aria-modal="true" aria-labelledby="enh-h">
      <button class="brp-x" type="button" aria-label="Close">✕</button>
      <h2 id="enh-h">Enhance</h2>
      <p class="brp-sub">Sharper, cleaner, richer, processed on this device. Nothing is uploaded.</p>

      <section class="brp-sec">
        <div class="brp-head"><span>1 · YOUR FILES</span><small id="enh-note">Photos and clips, together is fine.</small></div>
        <div class="brp-clips" id="enh-items"></div>
        <input id="enh-input" type="file" accept="image/*,video/*" multiple hidden />
      </section>

      <section class="brp-sec">
        <div class="brp-head"><span>2 · THE LOOK</span><small id="enh-looknote">Clean resample + edge recovery + colour. Nothing invented.</small></div>
        <div class="brp-anamode enh-looks">
          <span>Strength</span>
          <button type="button" class="q-mode" data-look="subtle">Subtle</button>
          <button type="button" class="q-mode on" data-look="standard">Standard</button>
          <button type="button" class="q-mode" data-look="strong">Strong</button>
        </div>
        <div class="enh-tiers">
          <span class="enh-tier on">On this device, free, private</span>
          <span class="enh-tier off" title="The first server engine we evaluated plasticised faces. Not shipping that.">Studio · server, Max, coming soon</span>
        </div>
      </section>

      <section class="brp-sec" id="enh-prev-sec" hidden>
        <div class="brp-head"><span>3 · BEFORE / AFTER</span><small>Drag the line. Left is the original.</small></div>
        <div class="enh-prevwrap">
          <canvas id="enh-prev" width="540" height="540"></canvas>
          <input id="enh-wipe" type="range" min="0" max="100" value="50" aria-label="Before/after split" />
        </div>
      </section>

      <div class="brp-actions">
        <button class="btn pri" id="enh-go" disabled>Enhance &amp; save</button>
        <span class="brp-progress" id="enh-progress"></span>
      </div>
    </div>`;
  document.body.appendChild(el);
  wire(el);
  paint();
}

function wire(el: HTMLElement): void {
  el.querySelector<HTMLButtonElement>(".brp-x")!.onclick = () => {
    if (!busy) closeEnhancePanel();
  };
  el.onclick = (e) => {
    if (e.target === el && !busy) closeEnhancePanel();
  };
  const input = el.querySelector<HTMLInputElement>("#enh-input")!;
  input.onchange = async () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    for (const file of files) {
      const item = await loadItem(file);
      if (item) {
        items.push(item);
        selected = items.length - 1;
      }
      paint();
    }
  };
  for (const b of el.querySelectorAll<HTMLButtonElement>("[data-look]")) {
    b.onclick = () => {
      lookKey = (b.dataset.look as keyof typeof LOOKS) ?? "standard";
      paint();
    };
  }
  el.querySelector<HTMLInputElement>("#enh-wipe")!.oninput = (e) => {
    wipe = Number((e.target as HTMLInputElement).value) / 100;
    drawPreview();
  };
  el.querySelector<HTMLButtonElement>("#enh-go")!.onclick = () => void run();
}

async function loadItem(file: File): Promise<EnhItem | null> {
  const url = URL.createObjectURL(file);
  if (/^image\//.test(file.type)) {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
    return { kind: "image", name: file.name, url, file, image };
  }
  if (/^video\//.test(file.type)) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("no"));
      });
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
    return { kind: "video", name: file.name, url, file, video };
  }
  URL.revokeObjectURL(url);
  return null;
}

function paint(): void {
  if (!host) return;
  const wrap = host.querySelector<HTMLElement>("#enh-items")!;
  wrap.innerHTML = "";
  items.forEach((it, i) => {
    const cell = document.createElement("div");
    cell.className = "brp-clip" + (i === selected ? " open" : "");
    cell.innerHTML = `
      ${it.kind === "image" ? `<img alt="" />` : `<video muted playsinline preload="metadata"></video>`}
      <button type="button" class="q-cut-x" title="Remove">✕</button>
      <span class="brp-clip-n">${it.kind === "image" ? "IMG" : "VID"}</span>`;
    if (it.kind === "image") cell.querySelector("img")!.src = it.url;
    else {
      const v = cell.querySelector("video")!;
      v.src = it.url;
      v.currentTime = 0.1;
    }
    cell.querySelector(".q-cut-x")!.addEventListener("click", (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(it.url);
      items.splice(i, 1);
      selected = Math.max(0, Math.min(selected, items.length - 1));
      cachedFor = "";
      paint();
    });
    cell.addEventListener("click", () => {
      selected = i;
      paint();
    });
    wrap.append(cell);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "brp-add";
  add.innerHTML = `<span>+</span>${items.length ? "More files" : "Add photos or clips"}`;
  add.onclick = () => host!.querySelector<HTMLInputElement>("#enh-input")!.click();
  wrap.append(add);

  const note = host.querySelector<HTMLElement>("#enh-note")!;
  note.textContent = items.length
    ? `${items.length} file${items.length === 1 ? "" : "s"}, each is enhanced and saved separately.`
    : "Photos and clips, together is fine.";
  host.querySelector<HTMLElement>("#enh-prev-sec")!.hidden = !items.length;
  host.querySelector<HTMLButtonElement>("#enh-go")!.disabled = busy || !items.length;
  for (const b of host.querySelectorAll<HTMLButtonElement>("[data-look]")) {
    b.classList.toggle("on", b.dataset.look === lookKey);
  }
  cachedFor = "";
  void buildPreview();
}

/** The selected item's frame, at preview size, original and enhanced. */
async function buildPreview(): Promise<void> {
  const it = items[selected];
  const canvas = host?.querySelector<HTMLCanvasElement>("#enh-prev");
  if (!it || !canvas) return;
  const key = `${selected}:${it.url}:${lookKey}`;
  if (cachedFor === key) {
    drawPreview();
    return;
  }
  const sw = it.kind === "image" ? it.image!.naturalWidth : it.video!.videoWidth;
  const sh = it.kind === "image" ? it.image!.naturalHeight : it.video!.videoHeight;
  if (!sw || !sh) return;
  const scale = Math.min(540 / sw, 540 / sh, 1);
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));
  canvas.width = w;
  canvas.height = h;

  const orig = document.createElement("canvas");
  orig.width = w;
  orig.height = h;
  const octx = orig.getContext("2d", { willReadFrequently: true })!;
  octx.imageSmoothingQuality = "high";
  if (it.kind === "image") {
    octx.drawImage(it.image!, 0, 0, w, h);
  } else {
    const v = it.video!;
    if (v.readyState < 2 || v.currentTime === 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          v.removeEventListener("seeked", done);
          resolve();
        };
        v.addEventListener("seeked", done);
        setTimeout(done, 1500);
        v.currentTime = Math.min(0.5, (v.duration || 1) / 3);
      });
    }
    octx.drawImage(v, 0, 0, w, h);
  }
  const enh = document.createElement("canvas");
  enh.width = w;
  enh.height = h;
  const ectx = enh.getContext("2d")!;
  const data = octx.getImageData(0, 0, w, h);
  // The preview runs the exact export math, at the preview's own scale.
  applyEnhance(data.data, w, h, lookFor(LOOKS[lookKey], Math.max(w, h)));
  ectx.putImageData(data, 0, 0);

  origCanvas = orig;
  enhCanvas = enh;
  cachedFor = key;
  drawPreview();
}

function drawPreview(): void {
  const canvas = host?.querySelector<HTMLCanvasElement>("#enh-prev");
  if (!canvas || !origCanvas || !enhCanvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const split = Math.round(w * wipe);
  ctx.drawImage(origCanvas, 0, 0);
  if (split > 0) {
    // AFTER on the left of the line: the eye reads left-to-right, and the
    // range input's thumb IS the line, so dragging right reveals more result.
    ctx.drawImage(enhCanvas, 0, 0, split, h, 0, 0, split, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(split - 1, 0, 2, h);
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText("AFTER", 8, 16);
  const label = "BEFORE";
  ctx.fillText(label, w - ctx.measureText(label).width - 8, 16);
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

async function run(): Promise<void> {
  if (busy || !items.length || !host) return;
  busy = true;
  const go = host.querySelector<HTMLButtonElement>("#enh-go")!;
  go.disabled = true;
  const progress = host.querySelector<HTMLElement>("#enh-progress")!;
  try {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const tag = items.length > 1 ? `${i + 1}/${items.length} · ` : "";
      if (it.kind === "image") {
        progress.textContent = `${tag}Enhancing ${it.name}`;
        const img = it.image!;
        const scale = Math.min(upscaleFor(img.naturalWidth, img.naturalHeight), 4096 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(2, Math.round(img.naturalWidth * Math.max(1, scale)));
        const h = Math.max(2, Math.round(img.naturalHeight * Math.max(1, scale)));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        applyEnhance(data.data, w, h, lookFor(LOOKS[lookKey], Math.max(w, h)));
        ctx.putImageData(data, 0, 0);
        const png = /png$/i.test(it.file.type);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.95),
        );
        if (!blob) throw new Error("Could not encode the enhanced image.");
        download(blob, `${stem(it.name)}-enhanced.${png ? "png" : "jpg"}`);
      } else {
        const bytes = await it.file.arrayBuffer();
        const v = it.video!;
        const out = await enhanceVideo({
          video: v,
          bytes,
          look: LOOKS[lookKey],
          scale: upscaleFor(v.videoWidth, v.videoHeight),
          onProgress: (f, label) => {
            progress.textContent = `${tag}${label} ${it.name}, ${Math.round(f * 100)}%`;
          },
        });
        download(out.blob, `${stem(it.name)}-enhanced.${out.extension}`);
      }
    }
    progress.textContent = "Saved.";
  } catch (err) {
    progress.textContent = err instanceof Error ? err.message : "Enhancement failed.";
  } finally {
    busy = false;
    go.disabled = !items.length;
  }
}

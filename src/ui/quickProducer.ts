import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Sex } from "../engine/types.js";
import type { QuickExportScores } from "./quickVideoExport.js";
import { quickVideoDuration, renderQuickVideoFrame } from "./quickVideoExport.js";
import { showCaptionStep } from "./captionStep.js";
import { canShareFiles, saveFile } from "./saveFile.js";
import type { SaveOutcome } from "./saveFile.js";
import { track } from "../engine/track.js";

// ---------------------------------------------------------------------------
// The TikTok producer.
//
// Three clips from before, the analysis reel, three clips from after — one
// vertical MP4. The format every transformation account already posts, except
// the middle of this one is a measurement instead of a jump cut.
//
// What it deliberately does NOT do:
//   - no music. Platforms downrank videos with baked-in audio they cannot
//     license, and creators add trending sounds natively anyway.
//   - no headline text. Native text tools perform better and every platform
//     paints them differently.
//   - no re-encoding of the reel MP4. The analysis segment is re-rendered
//     frame by frame through the same compositor the export uses, so it is
//     first-generation quality at the producer's own resolution.
//
// Everything runs on-device, like the rest of the product: the clips never
// leave the browser.
// ---------------------------------------------------------------------------

export interface ProducerScan {
  photo: HTMLCanvasElement;
  landmarks: NormalizedLandmark[];
  scores: QuickExportScores;
}

export interface ProducerContext {
  photo: HTMLCanvasElement;
  landmarks: NormalizedLandmark[];
  sex: Sex;
  scores: QuickExportScores;
  /**
   * A second scan, when the operator photographed both ends of the change.
   *
   * With one scan there is a single analysis segment and it sits in the middle:
   * clips, measurement, clips. With two, the measurement becomes the frame
   * around the clips instead — the video opens on what they were and closes on
   * what they are, which is the shape the format actually uses and the reason
   * the reel mode asks for two photographs.
   */
  after?: ProducerScan;
}

// Where the measurement sits relative to the footage.
//
// Both orders come from the same observation about what these videos do, and
// which one is right depends on footage the operator has and we do not, so it
// is a choice rather than a default we defend:
//
//   paired    before clips, before score, after clips, after score. The default
//             whenever there are two scans, and the reason is retention rather
//             than symmetry: it keeps a question open across the whole video.
//             The viewer has seen the old number, and every second of after
//             footage is spent wondering what the new one will say. The other
//             two orders both answer that question early.
//   framed    open on the before scan, clips in the middle, close on the after.
//             The scan is the argument and the clips are the evidence.
//   sandwich  before clips, the measurement, after clips. The original shape,
//             and the only one available when there is a single scan.
//
// Putting the two score cards back to back — which "framed" nearly does — reads
// as a spreadsheet: two number cards in a row, and whatever footage follows has
// nothing left at stake. "paired" gets the delta legible a different way, by
// counting the second card up FROM the first number instead of from zero. Same
// comparison, without spending the tension to get it.
export type ProducerOrder = "paired" | "framed" | "sandwich";

// The most clips one side can hold.
//
// Six, because the format is a fast cut sequence and six two-second clips is
// already twelve seconds a side — past that the video stops being a
// transformation and becomes a montage, and the analysis it is built around
// gets buried. It is a ceiling, not a target: one clip a side still builds.
const MAX_SLOTS = 6;

// 1080×1920 at 30fps. The analysis compositor renders at its native 720×1280
// and is scaled up; the clips people supply are usually phone footage and
// arrive at or above 1080 wide, so the output deserves the larger frame.
const W = 1080;
const H = 1920;
const FPS = 30;
// 16 Mbps at 1080x1920.
//
// Well above what TikTok and Reels will keep — both re-encode on upload — and
// that is the point: the platform's encoder is the last stage, so whatever
// softness we ship gets compounded rather than corrected. Headroom going in is
// the only lever we have over what comes out. It costs file size on a video
// that is uploaded once and discarded, which is the cheapest possible thing to
// spend.
const BITRATE = 16_000_000;

type Transition = "cut" | "dip" | "flash";

interface Clip {
  kind: "image" | "video";
  media: HTMLVideoElement | HTMLImageElement;
  url: string;
  // Natural duration for a video; 0 for a still.
  duration: number;
  // Where the used window starts, chosen on the trim slider for long clips.
  trimStart: number;
  // How long this clip runs in the cut. Every clip carries its own, because a
  // sequence where all six are the same length reads as a slideshow — the beat
  // you want is a long establishing shot and then four fast ones, and that is
  // not something one global number can express.
  length: number;
  // Whether that length was chosen for this clip specifically. The default
  // control at the bottom moves every clip still sitting at the default and
  // leaves the ones somebody has already set, so changing it late does not
  // silently undo their work.
  custom: boolean;
}

/** How long a side runs, so the row can say it before anything is built. */
function runTime(slots: Slots): number {
  return (slots.filter(Boolean) as Clip[]).reduce((sum, clip) => sum + usedLength(clip), 0);
}

/** A clip cannot run longer than it is. Stills can be held for any length. */
function usedLength(clip: Clip): number {
  return clip.kind === "image"
    ? clip.length
    : Math.max(0.4, Math.min(clip.length, clip.duration - clip.trimStart));
}

type Slots = Array<Clip | null>;

let overlay: HTMLDivElement | null = null;

// Which empty slot a paste lands in.
//
// Pasting is the fastest way to fill this screen by a wide margin — a still off
// a search results page is two keystrokes, where the same image through the
// picker is a download, a trip to the camera roll and a scroll. Images were
// always accepted (the pickers take image/* and the compositor has held stills
// from the start); what was missing was any way in that did not go through the
// filesystem.
//
// A paste needs a destination, and the slot body already opens the picker on
// click, so arming is its own small chip rather than a second meaning for the
// same tap. Null means "the first free slot", which is what somebody who has
// not noticed the chips will expect anyway.
let pasteTarget: { row: "before" | "after"; index: number } | null = null;
// Set while the producer is open. Arming a slot has to clear the arming in the
// OTHER row, and a per-row redraw cannot do that.
let redrawBoth: (() => void) | null = null;

export function openProducer(ctx: ProducerContext): void {
  closeProducer();
  const before: Slots = Array(MAX_SLOTS).fill(null);
  const after: Slots = Array(MAX_SLOTS).fill(null);
  // The default every clip starts at. Each one can then be set on its own —
  // this only decides where a freshly added clip begins.
  let clipLen = 2.5;
  let transition: Transition = "cut";
  // Two scans means the measurement can bracket the footage instead of sitting
  // in the middle of it, so that becomes the default the moment it is possible.
  let order: ProducerOrder = ctx.after ? "paired" : "sandwich";

  overlay = document.createElement("div");
  overlay.className = "prod";
  overlay.innerHTML = `
    <div class="prod-inner">
      <button class="hist-close" aria-label="Close">✕</button>
      <header class="prod-head">
        <h1>Make a TikTok</h1>
        <p>Clips from before, your analysis, clips from after — one vertical video.
        Everything is built on this device; your clips never leave the browser.</p>
      </header>
      <section class="prod-row">
        <div class="prod-row-head">
          <h2>BEFORE</h2>
          <label class="prod-pick">Add clips
            <input type="file" accept="image/*,video/*" multiple data-pick="before" hidden>
          </label>
        </div>
        <div class="prod-slots" data-row="before"></div>
        <p class="prod-row-note" data-note="before">Pick up to six at once · one is enough · or hit <b>paste</b> on a slot and ⌘V an image straight in</p>
      </section>
      <section class="prod-row prod-mid">
        <h2>THEN</h2>
        <div class="prod-analysis"><b>${
          ctx.after ? "Both scans, before and after" : "Your analysis reel"
        }</b><span>${(quickVideoDuration("breakdown") * (ctx.after ? 2 : 1)).toFixed(1)}s · rendered in</span></div>
      </section>
      <section class="prod-row">
        <div class="prod-row-head">
          <h2>AFTER</h2>
          <label class="prod-pick">Add clips
            <input type="file" accept="image/*,video/*" multiple data-pick="after" hidden>
          </label>
        </div>
        <div class="prod-slots" data-row="after"></div>
        <p class="prod-row-note" data-note="after">Pick up to six at once · one is enough</p>
      </section>
      <div class="prod-opts">
        <div class="prod-opt">
          <span>Default clip length</span>
          <div class="prod-seg" data-opt="len">
            <button type="button" data-v="1.5">1.5s</button>
            <button type="button" data-v="2">2.0s</button>
            <button type="button" data-v="2.5" class="on">2.5s</button>
            <button type="button" data-v="3.5">3.5s</button>
          </div>
        </div>
        ${
          ctx.after
            ? `<div class="prod-opt">
          <span>Where the measurement sits</span>
          <div class="prod-seg" data-opt="order">
            <button type="button" data-v="paired" class="on">After each side</button>
            <button type="button" data-v="framed">Around the clips</button>
            <button type="button" data-v="sandwich">In the middle</button>
          </div>
        </div>`
            : ""
        }
        <div class="prod-opt">
          <span>Select your transition</span>
          <div class="prod-seg" data-opt="tr">
            <button type="button" data-v="cut" class="on">Cut</button>
            <button type="button" data-v="dip">Dip to black</button>
            <button type="button" data-v="flash">Flash</button>
          </div>
        </div>
      </div>
      <div class="prod-opt">
        <span>Headline (optional)</span>
        <input class="prod-input" id="prod-headline" maxlength="60"
          placeholder="e.g. 8 weeks. No surgery.">
      </div>
      <p class="prod-note">Music is still added natively in the app you post from — native
      sounds reach further than baked-in ones, and this cannot mix audio anyway.
      Text is the trade you get to make: typed natively it ranks a little better,
      typed here you skip the round trip through CapCut entirely.</p>
      <button class="btn pri prod-build" id="prod-build">Confirm — build the video</button>
      <p class="prod-note">${
        canShareFiles()
          ? "It opens in your share sheet when it's ready — “Save Video” puts it in your camera roll."
          : "It downloads when it's ready."
      }</p>
      <p class="prod-msg" id="prod-msg" role="status"></p>
      <div class="prod-caption hidden" id="prod-caption"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".hist-close")!.addEventListener("click", closeProducer);

  const slotsOf = (row: "before" | "after") => (row === "before" ? before : after);
  const cells: Record<"before" | "after", HTMLElement[]> = { before: [], after: [] };
  const redrawRow = (row: "before" | "after") => {
    cells[row].forEach((cell, i) => renderSlot(cell, slotsOf(row), i, row, () => redrawRow(row)));
    const note = overlay?.querySelector<HTMLElement>(`[data-note="${row}"]`);
    const used = slotsOf(row).filter(Boolean).length;
    if (note) {
      note.textContent = used
        ? `${used} of ${MAX_SLOTS} · ${runTime(slotsOf(row)).toFixed(1)}s${used < MAX_SLOTS ? " · add more or leave it here" : " · full"}`
        : `Pick up to ${MAX_SLOTS} at once · one is enough`;
    }
  };
  for (const row of ["before", "after"] as const) {
    const host = overlay.querySelector<HTMLElement>(`.prod-slots[data-row="${row}"]`)!;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const cell = document.createElement("div");
      cell.className = "prod-slot";
      host.appendChild(cell);
      cells[row].push(cell);
    }
    redrawRow(row);
  }

  // One picker per row, taking all three at once.
  //
  // The slots each owned a single-file input, which meant three separate trips
  // through the photo picker to fill a row — six for a before-and-after. The
  // row-level input is `multiple` and fills every free slot in order, so the
  // whole thing is two visits to the camera roll. Anything past the three
  // spare slots is dropped with a line saying so rather than silently.
  redrawBoth = () => {
    redrawRow("before");
    redrawRow("after");
  };

  // Paste an image straight into a slot.
  //
  // Bound to the document rather than to a slot: a paste is delivered to
  // whatever has focus, and the thing that has focus after clicking a chip is a
  // button that is about to be replaced by the redraw. Listening at the top and
  // routing by pasteTarget is the only version that survives the redraw.
  //
  // Files first, then items. Copying an image in a browser puts a File on
  // clipboardData.files in Chrome and only an item in Safari, and a screenshot
  // on macOS arrives as an item either way.
  const headlineOf = () =>
    overlay?.querySelector<HTMLInputElement>("#prod-headline")?.value.trim() ?? "";

  const onPaste = async (event: ClipboardEvent) => {
    if (!overlay) return;
    const data = event.clipboardData;
    if (!data) return;
    const media = [...data.files].filter((f) => /^(image|video)\//.test(f.type));
    if (!media.length) {
      for (const item of data.items) {
        if (!/^(image|video)\//.test(item.type)) continue;
        const file = item.getAsFile();
        if (file) media.push(file);
      }
    }
    if (!media.length) return;
    // Consumed here, and the scan's own paste handler must not also see it —
    // see the capture-phase note below.
    event.preventDefault();
    event.stopImmediatePropagation();

    // Where it lands: the armed slot, else the first free one, before-row
    // first — which is the order somebody filling this screen works in.
    const target = pasteTarget;
    const rows: Array<"before" | "after"> = target ? [target.row] : ["before", "after"];
    let placed = 0;
    for (const file of media) {
      let done = false;
      for (const row of rows) {
        const slots = slotsOf(row);
        const start = target && row === target.row && placed === 0 ? target.index : 0;
        // `slots` is null-FILLED, not sparse, so an empty slot is null and
        // never undefined. Testing for undefined meant the armed slot was
        // never honoured and every paste silently fell through to the first
        // free one — the chip lit up and then did nothing it said it would.
        const index = !slots[start] ? start : slots.findIndex((clip) => !clip);
        if (index < 0) continue;
        try {
          slots[index] = await loadClip(file, clipLen);
          placed++;
          done = true;
        } catch {
          // An unreadable paste is reported below rather than thrown: the
          // clipboard is full of things that claim to be images and are not.
        }
        break;
      }
      if (!done && placed === 0) break;
    }
    pasteTarget = null;
    redrawBoth?.();
    const note = overlay.querySelector<HTMLElement>(`[data-note="${rows[0]}"]`);
    if (note && !placed) note.textContent = "That paste had no image in it.";
  };
  // CAPTURE phase, for the same reason as the cutaway strip in quick.ts:
  // enablePhotoPaste listens on the document too and its job is to START A
  // SCAN. It is registered first, so on the bubble phase it wins, and a paste
  // meant for a producer slot kicked off a full analysis instead. Capture puts
  // this ahead regardless of registration order.
  document.addEventListener("paste", onPaste, true);
  overlay.addEventListener("prod-close", () => document.removeEventListener("paste", onPaste, true));

  for (const input of overlay.querySelectorAll<HTMLInputElement>("input[data-pick]")) {
    input.addEventListener("change", async () => {
      const row = input.dataset.pick as "before" | "after";
      const slots = slotsOf(row);
      const chosen = [...(input.files ?? [])];
      // Reset immediately: picking the same file twice in a row fires no change
      // event otherwise, which reads as the picker being broken.
      input.value = "";
      if (!chosen.length) return;
      const free = slots.reduce<number[]>((acc, clip, i) => (clip ? acc : [...acc, i]), []);
      const note = overlay?.querySelector<HTMLElement>(`[data-note="${row}"]`);
      const skipped = Math.max(0, chosen.length - free.length);
      let failed = 0;
      for (const [n, file] of chosen.slice(0, free.length).entries()) {
        try {
          slots[free[n]] = await loadClip(file, clipLen);
        } catch {
          failed++;
        }
      }
      // Redraw FIRST, then report — redrawRow rewrites this line with the count,
      // so anything said before it is overwritten and the person never learns
      // their fourth pick was dropped.
      redrawRow(row);
      if (note && (skipped || failed)) {
        note.textContent = [
          skipped ? `${skipped} skipped — ${MAX_SLOTS} is the most per side.` : "",
          failed ? `${failed} file${failed > 1 ? "s" : ""} could not be read.` : "",
        ].filter(Boolean).join(" ");
      }
    });
  }

  for (const seg of overlay.querySelectorAll<HTMLElement>(".prod-seg")) {
    seg.addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest("button");
      if (!btn) return;
      for (const other of seg.querySelectorAll("button")) other.classList.toggle("on", other === btn);
      if (seg.dataset.opt === "len") {
        clipLen = Number(btn.dataset.v);
        // Applies to every clip still sitting at the default, and to none that
        // has been set on its own — moving somebody's hand-picked 4s clip back
        // to 2.5s because they nudged the default afterwards is the kind of
        // quiet undo that makes an editor untrustworthy.
        for (const row of ["before", "after"] as const) {
          for (const clip of slotsOf(row)) if (clip && !clip.custom) clip.length = clipLen;
          redrawRow(row);
        }
      } else if (seg.dataset.opt === "order") {
        order = btn.dataset.v as ProducerOrder;
      } else {
        transition = btn.dataset.v as Transition;
      }
    });
  }

  const buildBtn = overlay.querySelector<HTMLButtonElement>("#prod-build")!;
  const msg = overlay.querySelector<HTMLElement>("#prod-msg")!;
  buildBtn.onclick = async () => {
    const heads = before.filter(Boolean) as Clip[];
    const tails = after.filter(Boolean) as Clip[];
    if (!heads.length || !tails.length) {
      msg.textContent = "Add at least one before clip and one after clip. Three of each works best.";
      return;
    }
    buildBtn.disabled = true;
    msg.textContent = "";
    try {
      const outcome = await buildVideo(ctx, heads, tails, transition, order, (p: number) => {
        buildBtn.textContent = `Building · ${Math.round(p * 100)}%`;
      }, headlineOf());
      // A dismissed share sheet is a decision, not a failure: the video is
      // built and the button offers it again rather than claiming it saved.
      if (outcome === "cancelled") {
        buildBtn.textContent = "Save the video";
        msg.textContent = "Not saved yet — tap again when you're ready.";
      } else {
        track("quick-video-downloaded");
        buildBtn.textContent = outcome === "shared" ? "Sent to your share sheet" : "Video downloaded";
        showCaptionStep(overlay!.querySelector<HTMLElement>("#prod-caption")!, {
          // Two scans means the video is about a CHANGE, and the caption's
          // headline is the delta rather than the number. One scan is the
          // plain reel, which is what this always produced.
          kind: ctx.after ? "beforeAfter" : "reel",
          overall: (ctx.after ?? ctx).scores.overall,
          percentile: (ctx.after ?? ctx).scores.percentile,
          from: ctx.after ? ctx.scores.overall : undefined,
        });
      }
    } catch (error) {
      console.error(error);
      msg.textContent = "The video could not be built in this browser. A recent Chrome, Safari or Edge can.";
      buildBtn.textContent = "Confirm — build the video";
    } finally {
      buildBtn.disabled = false;
    }
  };
}

export function closeProducer(): void {
  overlay?.dispatchEvent(new Event("prod-close"));
  pasteTarget = null;
  redrawBoth = null;
  overlay?.remove();
  overlay = null;
}

// One slot: empty it is an add button; filled it is a thumbnail, a duration
// chip, a remove ✕, and — only when the clip is longer than the window — a
// trim slider. Rendered as a function of state rather than patched, so every
// change redraws the whole cell and the cell can never disagree with itself.
function renderSlot(
  cell: HTMLElement,
  slots: Slots,
  index: number,
  row: "before" | "after",
  redrawRow: () => void,
): void {
  const clip = slots[index];
  if (!clip) {
    // An empty slot is a target, not a second way in: the row's own picker
    // fills these, and clicking one opens that same picker.
    const armed = pasteTarget?.row === row && pasteTarget.index === index;
    cell.innerHTML = `<button type="button" class="prod-add${armed ? " armed" : ""}" data-open="${row}">
      <span>+</span>Clip ${index + 1}</button>
      <button type="button" class="prod-paste" title="Paste an image here">${armed ? "⌘V ready" : "paste"}</button>`;
    cell.querySelector(".prod-add")!.addEventListener("click", () => {
      cell.ownerDocument.querySelector<HTMLInputElement>(`input[data-pick="${row}"]`)?.click();
    });
    cell.querySelector(".prod-paste")!.addEventListener("click", (event) => {
      // Not the picker. Arming and opening a file dialog are opposites: the
      // dialog takes the focus a paste needs.
      event.stopPropagation();
      pasteTarget = armed ? null : { row, index };
      (redrawBoth ?? redrawRow)();
    });
    return;
  }

  // A clip can never be asked to run longer than it is, so the options offered
  // are the ones this particular file can actually deliver. A still has no such
  // limit — it is held for as long as you like.
  const cap = clip.kind === "image" ? 6 : Math.max(0.5, clip.duration);
  const choices = [1, 1.5, 2, 2.5, 3, 4, 5, 6].filter((v) => v <= cap + 0.001);
  if (!choices.length) choices.push(Number(cap.toFixed(1)));
  if (clip.length > cap) clip.length = choices[choices.length - 1];
  const used = usedLength(clip);
  const needsTrim = clip.kind === "video" && clip.duration > clip.length + 0.05;
  cell.innerHTML = `
    <div class="prod-thumb"><canvas width="96" height="128"></canvas>
      <span class="prod-dur">${clip.kind === "image" ? "PHOTO" : `${clip.duration.toFixed(1)}s`}</span>
      <button type="button" class="prod-rm" aria-label="Remove clip">✕</button>
    </div>
    <div class="prod-len" role="group" aria-label="Clip length">
      ${choices
        .map(
          (v) =>
            `<button type="button" data-len="${v}"${Math.abs(v - clip.length) < 0.01 ? ' class="on"' : ""}>${
              Number.isInteger(v) ? v : v.toFixed(1)
            }s</button>`,
        )
        .join("")}
    </div>
    ${
      needsTrim
        ? `<label class="prod-trim">
            <input type="range" min="0" max="${(clip.duration - clip.length).toFixed(2)}" step="0.1" value="${Math.min(clip.trimStart, clip.duration - clip.length).toFixed(2)}">
            <span></span>
          </label>`
        : ""
    }`;
  for (const btn of cell.querySelectorAll<HTMLButtonElement>(".prod-len button")) {
    btn.addEventListener("click", () => {
      clip.length = Number(btn.dataset.len);
      clip.custom = true;
      clip.trimStart = Math.min(clip.trimStart, Math.max(0, clip.duration - clip.length));
      redrawRow();
    });
  }
  drawThumb(cell.querySelector("canvas")!, clip);
  cell.querySelector(".prod-rm")!.addEventListener("click", () => {
    URL.revokeObjectURL(clip.url);
    // Close the gap rather than leaving a hole: a row of [clip, empty, clip]
    // would render as a cut to nothing in the middle of the reel.
    slots.splice(index, 1);
    slots.push(null);
    redrawRow();
  });
  const range = cell.querySelector<HTMLInputElement>(".prod-trim input");
  if (range) {
    const label = cell.querySelector<HTMLElement>(".prod-trim span")!;
    const update = () => {
      clip.trimStart = Math.min(Number(range.value), Math.max(0, clip.duration - clip.length));
      label.textContent = `Using ${clip.trimStart.toFixed(1)}–${(clip.trimStart + used).toFixed(1)}s`;
      void seekVideo(clip.media as HTMLVideoElement, clip.trimStart).then(() =>
        drawThumb(cell.querySelector("canvas")!, clip),
      );
    };
    range.addEventListener("input", update);
    update();
  }
}

async function loadClip(file: File, defaultLen: number): Promise<Clip> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video")) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("unreadable video"));
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("unreadable video");
    return { kind: "video", media: video, url, duration: video.duration, trimStart: 0, length: defaultLen, custom: false };
  }
  const image = new Image();
  image.src = url;
  await image.decode();
  return { kind: "image", media: image, url, duration: 0, trimStart: 0, length: defaultLen, custom: false };
}

function mediaSize(media: Clip["media"]): { w: number; h: number } {
  return media instanceof HTMLVideoElement
    ? { w: media.videoWidth, h: media.videoHeight }
    : { w: media.naturalWidth, h: media.naturalHeight };
}

// Cover-fit, like CSS object-fit: cover — the frame is always full, whatever
// aspect the phone shot at, with an optional slow push-in for stills so they
// read as footage rather than a slideshow.
function drawCover(
  ctx2d: CanvasRenderingContext2D,
  media: Clip["media"],
  w: number,
  h: number,
  zoom = 1,
): void {
  const { w: mw, h: mh } = mediaSize(media);
  if (!mw || !mh) return;
  const scale = Math.max(w / mw, h / mh) * zoom;
  const dw = mw * scale;
  const dh = mh * scale;
  ctx2d.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawThumb(canvas: HTMLCanvasElement, clip: Clip): void {
  const ctx2d = canvas.getContext("2d")!;
  ctx2d.fillStyle = "#0a0c0b";
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  drawCover(ctx2d, clip.media, canvas.width, canvas.height);
}

// Some containers never fire "seeked" for edge times, so the promise also
// resolves on a timeout rather than hanging the whole build on one frame.
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    window.setTimeout(done, 400);
    video.currentTime = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));
  });
}

interface Segment {
  kind: "clip" | "analysis";
  clip?: Clip;
  /** Which scan an analysis segment renders. Ignored for clips. */
  scan?: ProducerScan;
  duration: number;
}

async function buildVideo(
  ctx: ProducerContext,
  before: Clip[],
  after: Clip[],
  transition: Transition,
  order: ProducerOrder,
  onProgress: (p: number) => void,
  /** Burned into the footage segments. Empty means none, which is the default. */
  headline = "",
): Promise<SaveOutcome> {
  const analysisDur = quickVideoDuration("breakdown");
  const firstScan: ProducerScan = { photo: ctx.photo, landmarks: ctx.landmarks, scores: ctx.scores };
  const clipSegs = (clips: Clip[]): Segment[] =>
    clips.map((clip) => ({ kind: "clip" as const, clip, duration: usedLength(clip) }));
  // The second card counts up out of the first number rather than out of zero.
  // Built here rather than at the call site because it is a property of the
  // PAIR, and nothing upstream of the producer knows there is a pair.
  const afterScan: ProducerScan | undefined = ctx.after && {
    ...ctx.after,
    scores: { ...ctx.after.scores, from: ctx.scores.overall },
  };

  // "framed" needs two scans to mean anything — one measurement cannot bracket
  // a change. Falling back rather than refusing keeps a half-finished run
  // usable, and the option is disabled in the UI anyway when there is no
  // second scan, so reaching this line means something else went wrong.
  // Both two-scan orders need a second scan to mean anything — one measurement
  // cannot bracket a change. Falling back rather than refusing keeps a
  // half-finished run usable; the options are hidden in the UI without a second
  // scan anyway, so reaching that branch means something else went wrong.
  const twoScans = afterScan && order !== "sandwich";
  const segments: Segment[] = !twoScans
    ? [
        ...clipSegs(before),
        { kind: "analysis", scan: firstScan, duration: analysisDur },
        ...clipSegs(after),
      ]
    : order === "framed"
      ? [
          { kind: "analysis", scan: firstScan, duration: analysisDur },
          ...clipSegs(before),
          ...clipSegs(after),
          { kind: "analysis", scan: afterScan, duration: analysisDur },
        ]
      : [
          ...clipSegs(before),
          { kind: "analysis", scan: firstScan, duration: analysisDur },
          ...clipSegs(after),
          { kind: "analysis", scan: afterScan, duration: analysisDur },
        ];
  const total = segments.reduce((sum, s) => sum + s.duration, 0);
  const frameCount = Math.round(total * FPS);

  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } =
    await import("mediabunny");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  // alpha:false lets the compositor skip per-pixel blending against a
  // transparent backdrop on every one of ~400 frames; the frame is always
  // fully painted anyway.
  const ctx2d = canvas.getContext("2d", { alpha: false })!;
  // Phone footage is usually larger than the frame and every clip is scaled;
  // the default smoothing is the browser's cheapest filter and shows as
  // stair-stepping on hair and jaw edges once the platform re-encodes.
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.imageSmoothingQuality = "high";
  const format = new Mp4OutputFormat({ fastStart: "in-memory" });
  const codec = await getFirstEncodableVideoCodec(
    format.getSupportedVideoCodecs().filter((candidate) => candidate === "avc"),
    { width: W, height: H, quality: QUALITY_HIGH },
  );
  if (!codec) throw new Error("This browser cannot encode an H.264 MP4.");
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, { codec, bitrate: BITRATE, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: frameCount + 4 });
  output.setMetadataTags({ title: "TrueMax transformation", artist: "TrueMax" });
  await output.start();

  // The analysis segment is re-rendered through the export's own compositor at
  // 1.5x, so it is drawn natively at this canvas's 1080x1920 rather than
  // upscaled from 720p. Same layout code, same numbers — only the transform
  // differs — so the reel and the producer can never disagree about one face.
  const analysisCanvas = document.createElement("canvas");
  const ANALYSIS_SCALE = W / 720;

  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    let acc = 0;
    let segIndex = 0;
    for (; segIndex < segments.length - 1 && t >= acc + segments[segIndex].duration; segIndex++) {
      acc += segments[segIndex].duration;
    }
    const seg = segments[segIndex];
    const local = Math.min(t - acc, seg.duration - 1e-6);

    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.fillStyle = "#050606";
    ctx2d.fillRect(0, 0, W, H);
    if (seg.kind === "analysis") {
      const scan = seg.scan ?? firstScan;
      renderQuickVideoFrame(
        analysisCanvas, scan.photo, scan.landmarks, ctx.sex, scan.scores, local, "breakdown", ANALYSIS_SCALE,
      );
      ctx2d.drawImage(analysisCanvas, 0, 0, W, H);
    } else {
      const clip = seg.clip!;
      if (clip.kind === "video") {
        await seekVideo(clip.media as HTMLVideoElement, clip.trimStart + local);
      }
      // Stills get a slow push-in so they read as footage; video is honest
      // motion already and is left alone.
      const zoom = clip.kind === "image" ? 1 + 0.06 * (local / seg.duration) : 1;
      drawCover(ctx2d, clip.media, W, H, zoom);
      drawHeadline(ctx2d, headline, W, H);
      drawProducerWatermark(ctx2d);
    }
    drawTransition(ctx2d, transition, segIndex, segments.length, local, seg.duration);

    await source.add(t, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
    if (frame % 6 === 0) onProgress(frame / frameCount);
  }
  await output.finalize();
  if (!target.buffer) throw new Error("The MP4 encoder returned no file.");
  onProgress(1);
  // Straight to the share sheet on a phone, where "Save Video" puts it in the
  // camera roll and the TikTok app is one tap further. This file exists to be
  // posted from the device that made it.
  return saveFile(
    new Blob([target.buffer], { type: format.mimeType }),
    `truemax-tiktok-${Date.now()}.mp4`,
  );
}

// The typed headline, burned into the footage.
//
// The screen used to say no headline was burned in "on purpose", and the
// reasoning was sound as far as it went: text typed natively in TikTok is
// indexed and does rank a little better than pixels. What that reasoning
// missed is the alternative it was pushing people towards, which is not
// "type it natively" — it is a round trip through CapCut to add one line, and
// a video that never gets cut ranks nowhere at all.
//
// So it is offered, empty by default, with the trade stated on the screen
// rather than decided for somebody. Music is genuinely different and stays
// native: this compositor writes a video track and no audio track, so there
// is nothing here to mix into.
//
// Drawn only over the FOOTAGE segments. The analysis card is a composition
// with its own typography and its own safe areas, and a second headline landing
// on top of it is two designs fighting.
function drawHeadline(ctx2d: CanvasRenderingContext2D, text: string, W: number, H: number): void {
  if (!text) return;
  ctx2d.save();
  ctx2d.textAlign = "center";
  ctx2d.font = `700 ${Math.round(W / 13)}px Inter, Arial, sans-serif`;

  // Wrapped to two lines at most, because a third is a paragraph and a
  // paragraph on a reel is not read.
  const words = text.split(/\s+/).filter(Boolean);
  const max = W * 0.86;
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx2d.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
      if (lines.length === 2) break;
    } else {
      line = next;
    }
  }
  if (lines.length < 2 && line) lines.push(line);

  // High in the frame, clear of TikTok's caption block at the bottom and of the
  // action rail on the right. A headline the app covers is a headline nobody
  // typed.
  const lh = Math.round(W / 11);
  let y = Math.round(H * 0.13);
  for (const l of lines) {
    // Stroke then fill, so it survives a light frame without a plate behind it.
    ctx2d.lineWidth = Math.max(6, W / 90);
    ctx2d.lineJoin = "round";
    ctx2d.strokeStyle = "rgba(3,5,5,0.82)";
    ctx2d.strokeText(l, W / 2, y);
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillText(l, W / 2, y);
    y += lh;
  }
  ctx2d.restore();
}

// Transitions are drawn as overlays at segment edges, never by blending two
// segments' pixels — non-overlapping by construction, so no clip ever has to
// be decoded twice for one frame.
const DIP = 0.28;
const FLASH = 0.14;
function drawTransition(
  ctx2d: CanvasRenderingContext2D,
  transition: Transition,
  segIndex: number,
  segCount: number,
  local: number,
  duration: number,
): void {
  if (transition === "cut") return;
  const first = segIndex === 0;
  const last = segIndex === segCount - 1;
  if (transition === "dip") {
    let dark = 0;
    if (!last && local > duration - DIP) dark = (local - (duration - DIP)) / DIP;
    if (!first && local < DIP) dark = Math.max(dark, 1 - local / DIP);
    if (dark > 0) {
      ctx2d.fillStyle = `rgba(0,0,0,${Math.min(1, dark).toFixed(3)})`;
      ctx2d.fillRect(0, 0, W, H);
    }
    return;
  }
  // Flash: a white pop on each incoming segment. Kept under full white so the
  // frame beneath stays legible and the cut reads as energy, not an error.
  if (!first && local < FLASH) {
    ctx2d.fillStyle = `rgba(255,255,255,${(0.85 * (1 - local / FLASH)).toFixed(3)})`;
    ctx2d.fillRect(0, 0, W, H);
  }
}

// The same signature the reel carries, at this canvas's scale. The analysis
// segment already brings its own from the compositor.
function drawProducerWatermark(ctx2d: CanvasRenderingContext2D): void {
  ctx2d.save();
  ctx2d.font = "500 24px Inter, Arial, sans-serif";
  ctx2d.letterSpacing = "3px";
  ctx2d.textAlign = "left";
  const name = "truemax";
  const tld = ".app";
  const total = ctx2d.measureText(name).width + ctx2d.measureText(tld).width;
  const x = (W - total) / 2;
  const y = H - 33;
  ctx2d.globalAlpha = 0.62;
  ctx2d.fillStyle = "#f5f5f1";
  ctx2d.fillText(name, x, y);
  ctx2d.fillStyle = "#0c876f";
  ctx2d.fillText(tld, x + ctx2d.measureText(name).width, y);
  ctx2d.restore();
}


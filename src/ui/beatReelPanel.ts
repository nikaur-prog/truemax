import { analyzeBeats, nearestDownbeat, onsetEnvelope, toMono } from "../engine/beats.js";
import type { BeatGrid } from "../engine/beats.js";
import { beatsIn, planBeatCuts, suggestWindow } from "../engine/beatPlan.js";
import type { BeatPlan } from "../engine/beatPlan.js";
import { renderBeatReel } from "./beatReelExport.js";
import type { ReelClip, ReelQuality } from "./beatReelExport.js";

// ---------------------------------------------------------------------------
// Attach clips. Attach a song. Get a cut.
//
// The ordering of this panel is the whole argument. Clips come first because
// how many you have decides how long each one is; the song comes second because
// its tempo turns that count into seconds; and the window is chosen LAST,
// against a number this panel has already worked out for you. At no point is
// anybody asked to guess a duration, which is the question the old creator
// asked and the reason its cuts never sat on the music.
//
// The waveform is drawn from the onset envelope rather than from the samples.
// A sample waveform of a modern master is a solid block — everything is
// squashed to the ceiling, so it shows a rectangle and tells you nothing. The
// onset envelope shows where the HITS are, which is the only thing anybody is
// looking for when they scrub a song for a section to cut to, and it lets the
// detected grid be drawn on top of the evidence it came from. If the ticks do
// not line up with the spikes, the analysis is wrong and you can SEE that it
// is wrong, rather than finding out after a two-minute render.
//
// Nothing here uploads anything. The song is decoded into memory, analysed,
// sliced and muxed on the device.
// ---------------------------------------------------------------------------

interface PanelClip extends ReelClip {
  name: string;
  url: string;
}

interface Song {
  name: string;
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  grid: BeatGrid;
  /** The onset envelope, for drawing. Downsampled per pixel at paint time. */
  env: Float32Array;
  envRate: number;
}

let host: HTMLDivElement | null = null;
let clips: PanelClip[] = [];
let song: Song | null = null;
let beatsPerClip = 2;
// When set, the section's length governs and the pace is whatever fills it.
// Null means the pace control governs and the length follows from it. Exactly
// one of the two is in charge at any moment, and the panel says which.
let fitSeconds: number | null = null;
let songStart = 0;
let dropAt: number | null = null;
let clipsBeforeDrop: number | null = null;
let quality: ReelQuality = "1080";
let barNudge = 0;
let busy = false;
// The growth loop, on by default and honestly labelled: the card is the one
// part of the reel that is ours, and it is a checkbox precisely so nobody
// discovers it in their export.
let outro = true;

export function closeBeatReelPanel(): void {
  // A render still writing must keep its sources: closing mid-render would
  // revoke the clip URLs the encoder is seeking through and turn the rest of
  // the export into two-second seek timeouts on dead blobs. The ✕ and the
  // backdrop are both disabled while busy, so this is belt and braces.
  if (busy) return;
  for (const c of clips) URL.revokeObjectURL(c.url);
  clips = [];
  song = null;
  dropAt = null;
  clipsBeforeDrop = null;
  barNudge = 0;
  // Every control resets with the panel. Leaving quality or the fitted
  // section length behind meant reopening showed the DEFAULTS while the state
  // still held the old choices — a 4K render out of a select that said 1080.
  beatsPerClip = 2;
  fitSeconds = null;
  quality = "1080";
  songStart = 0;
  outro = true;
  host?.remove();
  host = null;
}

const fmt = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

/** The grid with the user's bar correction applied. */
function grid(): BeatGrid | null {
  if (!song) return null;
  const g = song.grid;
  if (!barNudge) return g;
  return { ...g, downbeatOffset: ((g.downbeatOffset + barNudge) % g.beatsPerBar + g.beatsPerBar) % g.beatsPerBar };
}

function currentPlan(): BeatPlan | null {
  const g = grid();
  if (!g || !clips.length || !g.bpm) return null;
  return planBeatCuts({
    grid: g,
    clipCount: clips.length,
    beatsPerClip,
    ...(fitSeconds != null ? { totalBeats: beatsIn(g, fitSeconds) } : {}),
    songStart,
    dropAt: dropAt ?? undefined,
    clipsBeforeDrop: clipsBeforeDrop ?? undefined,
  });
}

export function openBeatReelPanel(): void {
  closeBeatReelPanel();
  const el = document.createElement("div");
  host = el;
  el.className = "brp";
  el.innerHTML = `
    <div class="brp-card" role="dialog" aria-modal="true" aria-labelledby="brp-h">
      <button class="brp-x" type="button" aria-label="Close">✕</button>
      <h2 id="brp-h">Cut to the beat</h2>
      <p class="brp-sub">Attach your clips, then a song. The tempo decides how long each clip is —
        you never pick a duration.</p>

      <section class="brp-sec">
        <div class="brp-head"><span>1 · YOUR CLIPS</span><small id="brp-clipnote">Nothing attached yet.</small></div>
        <div class="brp-clips" id="brp-clips"></div>
        <input id="brp-clip-input" type="file" accept="video/*" multiple hidden />
      </section>

      <section class="brp-sec">
        <div class="brp-head"><span>2 · THE SONG</span><small id="brp-songnote">Attach the full track — you pick the section next.</small></div>
        <div class="brp-song" id="brp-song">
          <button class="brp-add" type="button" id="brp-song-add"><span>♪</span>Add a song</button>
        </div>
        <input id="brp-song-input" type="file" accept="audio/*" hidden />
      </section>

      <section class="brp-sec" id="brp-window-sec" hidden>
        <div class="brp-head"><span>3 · THE SECTION</span><small id="brp-wantnote"></small></div>
        <div class="brp-wave-wrap">
          <canvas class="brp-wave" id="brp-wave" width="1200" height="150"></canvas>
          <div class="brp-wave-hint" id="brp-wave-hint">Click the waveform to set where the reel starts. It snaps to the nearest bar.</div>
        </div>
        <div class="brp-controls">
          <label class="brp-ctl">Pace
            <select id="brp-pace" class="q-input">
              <option value="1">1 beat a clip — frantic</option>
              <option value="2" selected>2 beats a clip — standard</option>
              <option value="3">3 beats a clip</option>
              <option value="4">4 beats a clip — cinematic</option>
            </select>
          </label>
          <!-- The same formula run backwards, for the common case of having a
               specific section in mind: type its length and the pace is chosen
               to fill it with whole beats. Never leaves a fractional beat over
               — it takes the largest whole number that fits and says what the
               window actually came out as. -->
          <label class="brp-ctl">Or fit a section of
            <input class="q-input" id="brp-fit" type="number" min="2" max="180" step="1" placeholder="20" />
          </label>
          <label class="brp-ctl">Quality
            <select id="brp-quality" class="q-input">
              <option value="1080" selected>1080 × 1920 — the platform native</option>
              <option value="4k">2160 × 3840 — 4K, about 4× the render time</option>
            </select>
          </label>
          <div class="brp-ctl brp-bar">
            <span>The "one"</span>
            <button type="button" class="btn gho" id="brp-bar-back">◂ nudge</button>
            <button type="button" class="btn gho" id="brp-bar-fwd">nudge ▸</button>
          </div>
        </div>
        <div class="brp-drop">
          <label class="brp-outro"><input type="checkbox" id="brp-outro" checked />
            End on the TrueMax card <em>one bar · "truemax.app"</em></label>
        </div>
        <div class="brp-drop">
          <button type="button" class="btn gho" id="brp-drop-set">Mark the drop here</button>
          <button type="button" class="btn gho" id="brp-drop-clear" hidden>Clear the drop</button>
          <label class="brp-ctl brp-before" hidden id="brp-before-wrap">Clips before it
            <input class="q-input" id="brp-before" type="number" min="1" step="1" />
          </label>
          <small id="brp-dropnote">Optional. The clip that starts on the drop is your reveal.</small>
        </div>
      </section>

      <section class="brp-sec" id="brp-plan-sec" hidden>
        <div class="brp-head"><span>4 · THE CUT</span><small id="brp-plannote"></small></div>
        <div class="brp-cuts" id="brp-cuts"></div>
      </section>

      <div class="brp-actions">
        <button class="btn pri" id="brp-go" disabled>Render the reel</button>
        <span class="brp-progress" id="brp-progress"></span>
      </div>
    </div>`;

  document.body.appendChild(el);
  wire(el);
  paint();
}

function wire(el: HTMLElement): void {
  el.querySelector<HTMLButtonElement>(".brp-x")!.onclick = () => {
    if (!busy) closeBeatReelPanel();
  };
  el.onclick = (e) => {
    if (e.target === el && !busy) closeBeatReelPanel();
  };

  const clipInput = el.querySelector<HTMLInputElement>("#brp-clip-input")!;
  clipInput.onchange = async () => {
    const files = [...(clipInput.files ?? [])];
    clipInput.value = "";
    for (const file of files) {
      const loaded = await loadClip(file);
      if (loaded) clips.push(loaded);
      paint();
    }
  };

  const songInput = el.querySelector<HTMLInputElement>("#brp-song-input")!;
  songInput.onchange = async () => {
    const file = songInput.files?.[0];
    songInput.value = "";
    if (!file) return;
    note("brp-songnote", "Reading the track…");
    const loaded = await loadSong(file);
    if (!loaded) {
      note("brp-songnote", "That file would not decode as audio.");
      return;
    }
    song = loaded;
    // Start a quarter of the way in rather than at zero: the opening of a
    // track is where the drums usually are not.
    songStart = nearestDownbeat(loaded.grid, loaded.duration * 0.25);
    dropAt = null;
    clipsBeforeDrop = null;
    barNudge = 0;
    paint();
  };
  el.querySelector<HTMLButtonElement>("#brp-song-add")!.onclick = () => songInput.click();

  el.querySelector<HTMLSelectElement>("#brp-pace")!.onchange = (e) => {
    beatsPerClip = Number((e.target as HTMLSelectElement).value) || 2;
    // Choosing a pace is a statement that the pace is what matters, so it
    // releases the section length rather than silently doing nothing.
    fitSeconds = null;
    const fit = host!.querySelector<HTMLInputElement>("#brp-fit");
    if (fit) fit.value = "";
    paint();
  };
  el.querySelector<HTMLInputElement>("#brp-fit")!.oninput = (e) => {
    const raw = (e.target as HTMLInputElement).value.trim();
    const seconds = Number(raw);
    // Emptying the box hands control back to the pace select rather than
    // leaving the edit stuck at whatever was last typed.
    fitSeconds = raw && seconds > 0 ? seconds : null;
    paint();
  };
  el.querySelector<HTMLSelectElement>("#brp-quality")!.onchange = (e) => {
    quality = (e.target as HTMLSelectElement).value === "4k" ? "4k" : "1080";
  };
  el.querySelector<HTMLButtonElement>("#brp-bar-back")!.onclick = () => { barNudge--; snapStart(); paint(); };
  el.querySelector<HTMLButtonElement>("#brp-bar-fwd")!.onclick = () => { barNudge++; snapStart(); paint(); };

  el.querySelector<HTMLInputElement>("#brp-outro")!.onchange = (e) => {
    outro = (e.target as HTMLInputElement).checked;
    paint();
  };
  el.querySelector<HTMLButtonElement>("#brp-drop-set")!.onclick = () => {
    const plan = currentPlan();
    const g = grid();
    if (!plan || !g) return;
    // Defaults to the middle of the window, on a beat — a starting point to
    // drag from rather than a demand to have already decided.
    dropAt = songStart + Math.round(plan.duration / 2 / g.period) * g.period;
    clipsBeforeDrop = Math.max(1, Math.floor(clips.length / 2));
    paint();
  };
  el.querySelector<HTMLButtonElement>("#brp-drop-clear")!.onclick = () => {
    dropAt = null;
    clipsBeforeDrop = null;
    paint();
  };
  el.querySelector<HTMLInputElement>("#brp-before")!.oninput = (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    clipsBeforeDrop = Math.max(1, Math.min(clips.length - 1, v || 1));
    paint();
  };

  const wave = el.querySelector<HTMLCanvasElement>("#brp-wave")!;
  wave.onclick = (e) => {
    const g = grid();
    if (!song || !g) return;
    const rect = wave.getBoundingClientRect();
    const at = ((e.clientX - rect.left) / rect.width) * song.duration;
    // Shift-click marks the drop, which is a beat rather than a bar: a drop
    // does not always land on a "one".
    if (e.shiftKey && dropAt !== null) {
      dropAt = Math.round((at - songStart) / g.period) * g.period + songStart;
    } else {
      songStart = nearestDownbeat(g, at);
      if (dropAt !== null && (dropAt <= songStart || dropAt >= songStart + (currentPlan()?.duration ?? 0))) {
        dropAt = null;
        clipsBeforeDrop = null;
      }
    }
    paint();
  };

  el.querySelector<HTMLButtonElement>("#brp-go")!.onclick = () => void render();
}

/** Keep the chosen start on a bar after the bar itself has been redefined. */
function snapStart(): void {
  const g = grid();
  if (g) songStart = nearestDownbeat(g, songStart);
}

function note(id: string, text: string): void {
  const n = host?.querySelector<HTMLElement>(`#${id}`);
  if (n) n.textContent = text;
}

async function loadClip(file: File): Promise<PanelClip | null> {
  if (!/^video\//.test(file.type)) return null;
  const url = URL.createObjectURL(file);
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
  return { video, url, name: file.name, startAt: 0, bias: 0 };
}

async function loadSong(file: File): Promise<Song | null> {
  try {
    const bytes = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i).slice());
    const mono = toMono(channels);
    const g = analyzeBeats(mono, buffer.sampleRate);
    const env = onsetEnvelope(mono, buffer.sampleRate);
    return {
      name: file.name,
      channels,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      grid: g,
      env: env.values,
      envRate: env.frameRate,
    };
  } catch {
    return null;
  }
}

function paint(): void {
  if (!host) return;
  paintClips();
  paintSong();
  paintWindow();
  paintPlan();
  const go = host.querySelector<HTMLButtonElement>("#brp-go")!;
  go.disabled = busy || !currentPlan();
}

// Which clip's trim controls are open, by index. One at a time: eight open
// scrubbers is a mixing desk, and this is a phone screen.
let openClip: number | null = null;

function paintClips(): void {
  const wrap = host!.querySelector<HTMLElement>("#brp-clips")!;
  wrap.innerHTML = "";
  // The trim editor lives OUTSIDE the strip (wrap.after), so clearing the
  // strip's innerHTML does not clear it. Every paint removes the old one and
  // the open clip, if any, gets a fresh one below.
  for (const old of host!.querySelectorAll(".brp-trim")) old.remove();
  clips.forEach((clip, i) => {
    const cell = document.createElement("div");
    cell.className = "brp-clip" + (openClip === i ? " open" : "");
    // Reorder is two arrows rather than drag. Drag needs a long-press to
    // disambiguate from scroll on a phone, ghosting, and a drop indicator;
    // arrows need nothing and work identically everywhere. The order IS the
    // edit, so it must be changeable without re-attaching everything.
    cell.innerHTML = `
      <video muted playsinline preload="metadata"></video>
      <button type="button" class="q-cut-x" title="Remove">✕</button>
      <span class="brp-clip-n">${i + 1}</span>
      <span class="brp-clip-moves">
        <button type="button" data-move="-1" title="Earlier" ${i === 0 ? "disabled" : ""}>‹</button>
        <button type="button" data-move="1" title="Later" ${i === clips.length - 1 ? "disabled" : ""}>›</button>
      </span>`;
    const v = cell.querySelector("video")!;
    v.src = clip.url;
    v.currentTime = clip.startAt + 0.1;
    cell.querySelector(".q-cut-x")!.addEventListener("click", (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(clip.url);
      clips.splice(i, 1);
      openClip = null;
      if (clipsBeforeDrop !== null) clipsBeforeDrop = Math.min(clipsBeforeDrop, Math.max(1, clips.length - 1));
      paint();
    });
    for (const btn of cell.querySelectorAll<HTMLButtonElement>("[data-move]")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const to = i + Number(btn.dataset.move);
        const [moved] = clips.splice(i, 1);
        clips.splice(to, 0, moved);
        openClip = null;
        paint();
      });
    }
    // Tapping the clip opens its trim controls under the strip.
    cell.addEventListener("click", () => {
      openClip = openClip === i ? null : i;
      paint();
    });
    wrap.append(cell);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "brp-add";
  add.innerHTML = `<span>+</span>${clips.length ? "More clips" : "Add clips"}`;
  add.onclick = () => host!.querySelector<HTMLInputElement>("#brp-clip-input")!.click();
  wrap.append(add);

  // The open clip's trim controls, under the strip. `startAt` is where in the
  // SOURCE this clip begins — the cut still lands on the beat; this decides
  // which moment of the footage is playing when it does. The preview seeks as
  // the handle moves, so the in-point is chosen by looking at the frame.
  if (openClip !== null && clips[openClip]) {
    const clip = clips[openClip];
    const dur = Math.max(0, (clip.video.duration || 0) - 0.3);
    const editor = document.createElement("div");
    editor.className = "brp-trim";
    editor.innerHTML = `
      <video muted playsinline preload="metadata"></video>
      <div class="brp-trim-fields">
        <b>Clip ${openClip + 1}</b>
        <label>Starts at
          <input type="range" data-k="start" min="0" max="${dur.toFixed(1)}" step="0.1" value="${clip.startAt}" />
          <em data-out>${clip.startAt.toFixed(1)}s</em>
        </label>
        <label>Framing
          <select class="q-input" data-k="bias">
            <option value="-0.35"${clip.bias === -0.35 ? " selected" : ""}>Favour the top — heads in wide shots</option>
            <option value="0"${!clip.bias ? " selected" : ""}>Centre</option>
            <option value="0.35"${clip.bias === 0.35 ? " selected" : ""}>Favour the bottom</option>
          </select>
        </label>
      </div>`;
    const pv = editor.querySelector("video")!;
    pv.src = clip.url;
    pv.currentTime = clip.startAt + 0.05;
    const out = editor.querySelector<HTMLElement>("[data-out]")!;
    editor.querySelector<HTMLInputElement>('[data-k="start"]')!.oninput = (e) => {
      clip.startAt = Number((e.target as HTMLInputElement).value);
      pv.currentTime = clip.startAt + 0.05;
      out.textContent = `${clip.startAt.toFixed(1)}s`;
    };
    editor.querySelector<HTMLSelectElement>('[data-k="bias"]')!.onchange = (e) => {
      clip.bias = Number((e.target as HTMLSelectElement).value) || 0;
    };
    wrap.after(editor);
  }

  note(
    "brp-clipnote",
    clips.length
      ? `${clips.length} clip${clips.length === 1 ? "" : "s"}, cut in the order shown.`
      : "Nothing attached yet.",
  );
}

function paintSong(): void {
  const wrap = host!.querySelector<HTMLElement>("#brp-song")!;
  if (!song) return;
  const g = grid()!;
  const sure = g.confidence >= 0.5;
  wrap.innerHTML = `
    <div class="brp-songcard${sure ? "" : " unsure"}">
      <b>${g.bpm ? g.bpm.toFixed(1) : "—"} BPM</b>
      <span>${song.name}</span>
      <em>${
        !g.bpm
          ? "No steady tempo found — this track cannot be cut to automatically."
          : sure
            ? `Steady tempo, read with confidence ${g.confidence.toFixed(2)}. Bars of ${g.beatsPerBar}.`
            : `Read with low confidence (${g.confidence.toFixed(2)}) — check the ticks line up with the spikes below before rendering.`
      }</em>
      <button type="button" class="btn gho" id="brp-song-swap">Different song</button>
    </div>`;
  wrap.querySelector<HTMLButtonElement>("#brp-song-swap")!.onclick = () =>
    host!.querySelector<HTMLInputElement>("#brp-song-input")!.click();
  note("brp-songnote", `Decoded on this device — ${fmt(song.duration)} long. Nothing was uploaded.`);
}

function paintWindow(): void {
  const sec = host!.querySelector<HTMLElement>("#brp-window-sec")!;
  const g = grid();
  sec.hidden = !song || !g?.bpm || !clips.length;
  if (sec.hidden || !song || !g) return;

  const plan = currentPlan();
  const pace = host!.querySelector<HTMLSelectElement>("#brp-pace")!;
  pace.disabled = fitSeconds != null;
  if (plan && fitSeconds != null) {
    // Read the pace back OFF the plan rather than restating what was asked
    // for: with a remainder shared out, the clips are not all the same length,
    // and saying "6 beats each" when two of them are seven is the kind of
    // small lie that makes somebody distrust the whole panel.
    const counts = plan.cuts.map((c) => c.beats);
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    note(
      "brp-wantnote",
      `Filling ${plan.duration.toFixed(2)}s of song with ${clips.length} clips — ${
        lo === hi ? `${lo} beats each` : `${lo}–${hi} beats each, the spares on the first and last`
      }. Starting at ${fmt(songStart)}.`,
    );
  } else {
    const want = suggestWindow(g.bpm, clips.length, beatsPerClip);
    note(
      "brp-wantnote",
      `${clips.length} clips × ${beatsPerClip} beat${beatsPerClip === 1 ? "" : "s"} = ${want.seconds.toFixed(
        2,
      )}s (${want.bars} bars). Starting at ${fmt(songStart)}.`,
    );
  }

  const before = host!.querySelector<HTMLInputElement>("#brp-before")!;
  const beforeWrap = host!.querySelector<HTMLElement>("#brp-before-wrap")!;
  const clear = host!.querySelector<HTMLElement>("#brp-drop-clear")!;
  const set = host!.querySelector<HTMLElement>("#brp-drop-set")!;
  const marked = dropAt !== null;
  beforeWrap.hidden = !marked;
  clear.hidden = !marked;
  set.hidden = marked;
  before.max = String(Math.max(1, clips.length - 1));
  before.value = String(clipsBeforeDrop ?? 1);
  note(
    "brp-dropnote",
    marked
      ? `The drop is at ${fmt(dropAt!)} — shift-click the waveform to move it. The reveal starts exactly there.`
      : "Optional. The clip that starts on the drop is your reveal.",
  );

  drawWave();
}

/**
 * The onset envelope, the detected beat grid, and the chosen window.
 *
 * Drawn from the envelope rather than the samples because a modern master's
 * waveform is a solid block — every peak is at the ceiling, so it shows a
 * rectangle. The envelope shows the hits, which is what somebody scrubbing for
 * a section is actually looking for, and it lets the grid be checked against
 * the evidence it was derived from.
 */
function drawWave(): void {
  const canvas = host!.querySelector<HTMLCanvasElement>("#brp-wave");
  const g = grid();
  if (!canvas || !song || !g) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#12161a";
  ctx.fillRect(0, 0, W, H);

  // Envelope, one column per pixel, peak-holding so a single-frame spike is
  // never averaged into invisibility.
  const perPx = song.env.length / W;
  let max = 0;
  for (const v of song.env) if (v > max) max = v;
  ctx.fillStyle = "#3f4d57";
  for (let x = 0; x < W; x++) {
    let peak = 0;
    const from = Math.floor(x * perPx);
    const to = Math.min(song.env.length, Math.floor((x + 1) * perPx) + 1);
    for (let i = from; i < to; i++) if (song.env[i] > peak) peak = song.env[i];
    const h = max > 0 ? (peak / max) * (H - 34) : 0;
    ctx.fillRect(x, H - 22 - h, 1, h);
  }

  const xAt = (t: number) => (t / song!.duration) * W;

  // Bar lines only — every beat at this width is a grey wash.
  ctx.strokeStyle = "rgba(120,190,255,0.30)";
  ctx.lineWidth = 1;
  for (let i = g.downbeatOffset; i < g.beats.length; i += g.beatsPerBar) {
    const x = Math.round(xAt(g.beats[i])) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H - 22);
    ctx.lineTo(x, H - 14);
    ctx.stroke();
  }

  // The chosen window.
  const plan = currentPlan();
  if (plan) {
    const x0 = xAt(plan.songStart);
    const x1 = xAt(plan.songEnd);
    ctx.fillStyle = "rgba(96,214,164,0.16)";
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H - 22);
    ctx.strokeStyle = "#60d6a4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, H - 22);
    ctx.stroke();
    // Each cut, so the edit is visible before it is rendered.
    ctx.strokeStyle = "rgba(96,214,164,0.55)";
    ctx.lineWidth = 1;
    for (const cut of plan.cuts.slice(1)) {
      const x = Math.round(xAt(plan.songStart + cut.start)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, H - 22);
      ctx.stroke();
    }
    if (dropAt !== null) {
      const x = Math.round(xAt(dropAt)) + 0.5;
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 22);
      ctx.stroke();
    }
  }

  // A time ruler, so a position on this canvas maps to a position in a player.
  ctx.fillStyle = "#7c8a94";
  ctx.font = "10px ui-monospace, monospace";
  const step = song.duration > 240 ? 60 : song.duration > 90 ? 30 : 10;
  for (let t = 0; t < song.duration; t += step) {
    ctx.fillText(fmt(t), Math.min(W - 30, xAt(t) + 2), H - 6);
  }
}

function paintPlan(): void {
  const sec = host!.querySelector<HTMLElement>("#brp-plan-sec")!;
  const plan = currentPlan();
  sec.hidden = !plan;
  if (!plan) return;
  const g2 = grid();
  const outroSec = outro && g2 ? g2.period * g2.beatsPerBar : 0;
  note(
    "brp-plannote",
    `${plan.cuts.length} cuts, ${plan.duration.toFixed(2)}s${outroSec ? ` + ${outroSec.toFixed(2)}s card` : ""}, every one on a beat at ${plan.bpm.toFixed(1)} BPM.`,
  );
  const wrap = host!.querySelector<HTMLElement>("#brp-cuts")!;
  wrap.innerHTML = plan.cuts
    .map(
      (c) => `<span class="brp-cut${c.onDrop ? " drop" : ""}" style="flex:${c.beats}">
        <b>${c.clip + 1}</b><em>${c.beats}♩</em>${c.onDrop ? "<i>DROP</i>" : ""}
      </span>`,
    )
    .join("");
}

async function render(): Promise<void> {
  const plan = currentPlan();
  if (!plan || !song || busy) return;
  busy = true;
  const go = host!.querySelector<HTMLButtonElement>("#brp-go")!;
  go.disabled = true;
  const progress = host!.querySelector<HTMLElement>("#brp-progress")!;
  try {
    const rendered = await renderBeatReel({
      clips,
      plan,
      song: { channels: song.channels, sampleRate: song.sampleRate },
      quality,
      outroBeats: outro ? grid()!.beatsPerBar : 0,
      onProgress: (f, label) => {
        progress.textContent = `${label} — ${Math.round(f * 100)}%`;
      },
    });
    const url = URL.createObjectURL(rendered.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `truemax-reel.${rendered.extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    progress.textContent =
      rendered.container === "mp4"
        ? "Saved."
        : "Saved as WebM — this browser cannot encode H.264. It plays everywhere but some uploaders prefer MP4.";
  } catch (err) {
    progress.textContent = err instanceof Error ? err.message : "The render failed.";
  } finally {
    busy = false;
    go.disabled = false;
  }
}

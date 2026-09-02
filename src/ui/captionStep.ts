import { buildCaption } from "../engine/caption.js";
import type { CaptionKind, Platform } from "../engine/caption.js";

// ---------------------------------------------------------------------------
// After the file lands: the words to post it with.
//
// This was inside quickProducer, available only to the before/after cut, and
// the other two exports — the rundown and the breakdown/verdict MP4s — dropped
// somebody at a saved file with nothing to post it with. That is the step where
// a good video becomes a bad post: the caption gets invented on a phone, the
// score gets typed wrong, the hashtags get forgotten.
//
// Lifted here unchanged in behaviour and parameterised by CUT, because three
// copies of a clipboard button is three places for the fallback to drift — and
// the fallback is the interesting part. navigator.clipboard is missing or
// blocked in every in-app browser inside a social app, which is exactly where
// somebody is standing when they want to paste a caption.
//
// Platform and subject are asked rather than assumed because both change the
// wording; everything else is derived from the scan that is already on screen.
// ---------------------------------------------------------------------------

export interface CaptionStepOptions {
  kind: CaptionKind;
  overall: number;
  percentile: number;
  /** The potential estimate, when the cut showed one. */
  potential?: number;
  /** The earlier score, for a before/after. */
  from?: number;
  /**
   * A name the operator already typed elsewhere — the rundown asks for one
   * before it renders. Pre-fills "someone else" rather than making them type it
   * twice.
   */
  name?: string;
}

export function showCaptionStep(host: HTMLElement, options: CaptionStepOptions): void {
  const preset = options.name?.trim() ?? "";
  host.classList.remove("hidden");
  host.innerHTML = `
    <h2>The caption</h2>
    <div class="prod-opt">
      <span>What platform is this on?</span>
      <div class="prod-seg" data-q="platform">
        <button type="button" data-v="tiktok" class="on">TikTok</button>
        <button type="button" data-v="instagram">Instagram</button>
      </div>
    </div>
    <div class="prod-opt">
      <span>Who is this about?</span>
      <div class="prod-seg" data-q="who">
        <button type="button" data-v="me"${preset ? "" : ' class="on"'}>Me</button>
        <button type="button" data-v="name"${preset ? ' class="on"' : ""}>Someone else</button>
      </div>
    </div>
    <input class="prod-input${preset ? "" : " hidden"}" id="prod-who-name"
      placeholder="Their first name" maxlength="40" value="${escapeAttr(preset)}">
    <input class="prod-input" id="prod-desc" placeholder="One line about it (optional), e.g. 8 weeks of training" maxlength="140">
    <small class="prod-cap-note hidden" id="prod-desc-note" role="status"></small>
    <div class="prod-cap-out">
      <pre id="prod-cap-text"></pre>
      <button type="button" class="btn pri" id="prod-copy">Copy caption + hashtags</button>
    </div>
    <p class="prod-cap-safety"><b>Before posting:</b> for promotional TikToks, turn on
      Content disclosure → Your brand. If realistic AI media appears, also turn on
      AI-generated content, and use a commercially cleared sound.</p>`;

  let platform: Platform = "tiktok";
  let whoMode = preset ? "name" : "me";
  const nameInput = host.querySelector<HTMLInputElement>("#prod-who-name")!;
  const descInput = host.querySelector<HTMLInputElement>("#prod-desc")!;
  const out = host.querySelector<HTMLElement>("#prod-cap-text")!;
  const descNote = host.querySelector<HTMLElement>("#prod-desc-note")!;

  const regenerate = () => {
    const who = whoMode === "me" ? "me" : nameInput.value;
    const result = buildCaption({
      platform,
      who,
      description: descInput.value,
      kind: options.kind,
      overall: options.overall,
      percentile: options.percentile,
      potential: options.potential,
      from: options.from,
    });
    out.textContent = result.full;
    descNote.classList.toggle("hidden", !result.descriptionOmitted);
    descNote.textContent = result.descriptionOmitted
      ? "That optional line was left out because it contains wording or hashtags that can be misread by platform safety systems."
      : "";
  };

  for (const seg of host.querySelectorAll<HTMLElement>(".prod-seg")) {
    seg.addEventListener("click", (event) => {
      const btn = (event.target as HTMLElement).closest("button");
      if (!btn) return;
      for (const other of seg.querySelectorAll("button")) other.classList.toggle("on", other === btn);
      if (seg.dataset.q === "platform") platform = btn.dataset.v as Platform;
      else {
        whoMode = btn.dataset.v!;
        nameInput.classList.toggle("hidden", whoMode === "me");
      }
      regenerate();
    });
  }
  nameInput.addEventListener("input", regenerate);
  descInput.addEventListener("input", regenerate);
  regenerate();

  const copy = host.querySelector<HTMLButtonElement>("#prod-copy")!;
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(out.textContent ?? "");
      copy.textContent = "Copied";
    } catch {
      // Clipboard permission denied — select the text so a manual copy is one
      // keystroke instead of a drag.
      const range = document.createRange();
      range.selectNodeContents(out);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      copy.textContent = "Press ⌘C / Ctrl-C";
    }
    window.setTimeout(() => (copy.textContent = "Copy caption + hashtags"), 2000);
  };
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The name goes into an attribute, and it is operator-typed text. Nothing here
// is hostile input in practice — it is a first name somebody types about a
// celebrity — but it reaches innerHTML, and "in practice" is not a reason to
// leave a quote able to close the attribute it sits in.
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

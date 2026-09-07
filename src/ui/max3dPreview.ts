import { mountMax3D, MAX_3D_STATES, MAX_3D_VIEWS, type Max3DState, type Max3DView } from "./max3d.js";
import { maxCharacterMarkup } from "./maxCharacter.js";
import { MAX_3D_EXAMPLES, recordMax3DExample } from "./max3dExport.js";

/** Development-only visual review. No account, scan, photo or provider call. */
export function mountMax3DPreview(container: HTMLElement = document.body): () => void {
  const host = document.createElement("section");
  host.setAttribute("aria-label", "Max 3D character preview");
  host.style.cssText = "max-width:980px;margin:24px auto;padding:24px;color:#172334;background:#f3f7fa;border-radius:24px;font-family:system-ui,sans-serif";
  host.innerHTML = `<style>
    [data-max-workbench]{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,1fr);gap:24px;align-items:center}
    [data-max-state-grid]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
    [data-max-state]{min-height:44px;border:1px solid #ccd7e1;border-radius:12px;background:white;color:#20364a;padding:8px;font:inherit;font-size:13px}
    [data-max-state][aria-pressed=true]{background:#123555;color:white;border-color:#123555}
    [data-max-state]:focus-visible{outline:3px solid #2a947c;outline-offset:2px}
    @media(max-width:650px){[data-max-workbench]{grid-template-columns:minmax(0,1fr);gap:4px}}
  </style><h1 style="margin:0 0 8px;font-size:clamp(24px,4vw,36px)">Max, with a little more life</h1>
    <p>The original Max face on a round 3D body. Try a gesture, an expression or a five-second prop routine. This is a local prototype, not a replacement for the live scan character yet.</p>
    <div data-max-workbench>
    <div data-max-preview-stage style="display:block;position:relative;width:min(100%,420px);aspect-ratio:1;margin:12px auto;background:radial-gradient(ellipse at center,#fff,#e1ebf4);border-radius:28px">
      ${maxCharacterMarkup()}
    </div>
    <div>
    <p data-max-preview-status role="status">Static fallback until you choose to load the preview.</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <button type="button" data-max-preview-load style="min-height:44px;padding:10px 16px;border:0;border-radius:12px;background:#123555;color:white">Load 3D Max</button>
      <label>Animation <select data-max-preview-clip style="min-height:44px;padding:10px;border-radius:10px">${MAX_3D_STATES.map((state) => `<option value="${state}">${state}</option>`).join("")}</select></label>
      <label>View <select data-max-preview-view style="min-height:44px;padding:10px;border-radius:10px">${MAX_3D_VIEWS.map((view) => `<option value="${view}"${view === "front" ? " selected" : ""}>${view}</option>`).join("")}</select></label>
      <button type="button" data-max-preview-static style="min-height:44px;padding:10px 16px;border-radius:12px">Return to static</button>
    </div>
    <div data-max-state-grid aria-label="Try a Max animation">${MAX_3D_STATES.map((state) => `<button type="button" data-max-state="${state}" aria-label="Play ${state}" aria-pressed="${state === "idle"}">${state === "celebrate" ? "Celebrate" : state.charAt(0).toUpperCase() + state.slice(1)}</button>`).join("")}</div>
    <label style="display:flex;gap:10px;align-items:center;min-height:44px"><input type="checkbox" data-max-playful checked> Playful moments while idle or thinking</label>
    <p style="font-size:13px;color:#57677a">After 5 to 10 seconds of waiting, Max plays one five-second routine. Listening and speaking take priority. Quiet is intentionally still.</p>
    <button type="button" data-max-speak style="min-height:44px;padding:10px 16px;border-radius:12px">Hear a speaking demo</button>
    <p data-max-voice-status role="status" style="font-size:13px;color:#57677a">Uses your browser's voice, not a new Coach voice service. No microphone needed.</p>
    </div></div>
    <section aria-label="Export actual 3D animation examples" style="padding:18px 0">
      <h2 style="font-size:20px">Export example videos</h2>
      <p>576 by 576 pixels, recorded locally from the actual 3D character. Silent clips with simple labels. No upload. Keep this tab and the character visible until the file is ready.</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${MAX_3D_EXAMPLES.map((example) => `<button type="button" data-max-export="${example.id}" style="min-height:44px;padding:10px 14px;border-radius:12px">Export ${example.title.toLowerCase()}</button>`).join("")}
      <button type="button" data-max-export-cancel disabled style="min-height:44px;padding:10px 14px;border-radius:12px">Cancel export</button></div>
      <p data-max-export-status role="status">12 to 15 seconds each. MP4 where supported; otherwise WebM. All twelve animations appear across the five examples.</p>
      <div data-max-export-files style="display:grid;gap:10px"></div>
    </section>
    <p>Reduced motion and data-saving preferences keep the static character. Hidden tabs and offscreen stages pause animation. Example videos are silent; the speaking demo is optional.</p>
    <div style="height:650px;padding-top:30px;color:#57677a">Scroll the character offscreen to check the paused state.</div>`;
  const stage = host.querySelector<HTMLElement>("[data-max-preview-stage]")!;
  const fallback = stage.querySelector<SVGSVGElement>("svg")!;
  fallback.style.cssText = "display:block;width:100%;height:100%";
  const status = host.querySelector<HTMLElement>("[data-max-preview-status]")!;
  const clip = host.querySelector<HTMLSelectElement>("select")!;
  const view = host.querySelector<HTMLSelectElement>("[data-max-preview-view]")!;
  const playful = host.querySelector<HTMLInputElement>("[data-max-playful]")!;
  const voiceStatus = host.querySelector<HTMLElement>("[data-max-voice-status]")!;
  const voiceButton = host.querySelector<HTMLButtonElement>("[data-max-speak]")!;
  const exportStatus = host.querySelector<HTMLElement>("[data-max-export-status]")!;
  const cancelExport = host.querySelector<HTMLButtonElement>("[data-max-export-cancel]")!;
  const files = host.querySelector<HTMLElement>("[data-max-export-files]")!;
  const downloads = new Map<string, { url: string; link: HTMLAnchorElement }>();
  let recording: AbortController | null = null;
  let disposed = false;
  let handle: ReturnType<typeof mountMax3D> | null = null;
  let utterance: SpeechSynthesisUtterance | null = null;
  let painted = false;
  let activeAnimation = "";
  const firstFrame = (event: Event): void => {
    const animation = (event.target as HTMLCanvasElement).dataset.animation;
    if (!painted) { painted = true; status.textContent = "3D Max is ready. Pick a gesture or turn him sideways to inspect the round body."; }
    if (!animation || animation === activeAnimation) return;
    activeAnimation = animation;
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-max-state]")) button.setAttribute("aria-pressed", String(button.dataset.maxState === animation));
    status.textContent = animation === "quiet" ? "Quiet mode: Max settles and stays still." : `Now playing: ${animation}. Gestures return to the previous coach state.`;
  };
  stage.addEventListener("max3dframe", firstFrame);
  const cancelVoice = (): void => {
    if (!utterance) return;
    utterance.onend = utterance.onerror = null;
    utterance = null;
    window.speechSynthesis?.cancel();
    voiceButton.textContent = "Hear a speaking demo";
  };
  const load = (): void => {
    handle?.destroy();
    painted = false;
    activeAnimation = "";
    handle = mountMax3D(stage, clip.value as Max3DState);
    handle.setView(view.value as Max3DView);
    handle.setPlayfulEnabled(playful.checked);
    status.textContent = "3D requested. The static character remains until the first successful render; motion preferences can keep it static.";
  };
  const selectState = (state: Max3DState): void => {
    cancelVoice();
    clip.value = state;
    if (!handle) load();
    handle?.setSpeechLevel(null);
    handle?.setAnimation(state);
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-max-state]")) button.setAttribute("aria-pressed", String(button.dataset.maxState === state));
    status.textContent = state === "quiet" ? "Quiet mode: Max settles and stays still." : `Playing ${state}. Choose a view to see the full 3D movement.`;
  };
  host.querySelector<HTMLButtonElement>("[data-max-preview-load]")!.onclick = load;
  clip.onchange = () => selectState(clip.value as Max3DState);
  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-max-state]")) button.onclick = () => selectState(button.dataset.maxState as Max3DState);
  playful.onchange = () => handle?.setPlayfulEnabled(playful.checked);
  view.onchange = () => handle?.setView(view.value as Max3DView);
  host.querySelector<HTMLButtonElement>("[data-max-preview-static]")!.onclick = () => {
    cancelVoice();
    handle?.destroy(); handle = null;
    status.textContent = "Static fallback selected. The 3D context has been released.";
  };
  voiceButton.onclick = () => {
    if (utterance) { cancelVoice(); selectState("idle"); voiceStatus.textContent = "Speaking demo stopped."; return; }
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") { voiceStatus.textContent = "This browser has no speech playback. Choose Speaking to see the mouth animation."; return; }
    selectState("speaking");
    const speech = new SpeechSynthesisUtterance("Hey, I'm Max. Let's take this one step at a time. You've got this!");
    utterance = speech;
    speech.rate = 0.96;
    speech.onend = () => { if (utterance !== speech) return; utterance = null; voiceButton.textContent = "Hear a speaking demo"; selectState("idle"); voiceStatus.textContent = "Speaking demo complete."; };
    speech.onerror = () => { if (utterance !== speech) return; utterance = null; voiceButton.textContent = "Hear a speaking demo"; selectState("idle"); voiceStatus.textContent = "Voice playback was unavailable. The Speaking animation is still available."; };
    voiceButton.textContent = "Stop speaking demo";
    voiceStatus.textContent = "Playing a browser voice with Max's opening-mouth animation. This is not phoneme-perfect lip sync.";
    window.speechSynthesis.speak(speech);
  };
  const exportControls = [...host.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("[data-max-preview-load], [data-max-preview-static], select, [data-max-export], [data-max-state], [data-max-playful], [data-max-speak]")];
  const escape = (event: KeyboardEvent): void => { if (event.key === "Escape" && recording) { event.preventDefault(); recording.abort(); } };
  host.addEventListener("keydown", escape);
  cancelExport.onclick = () => recording?.abort();
  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-max-export]")) button.onclick = async () => {
    if (recording || disposed) return;
    const example = MAX_3D_EXAMPLES.find((item) => item.id === button.dataset.maxExport);
    if (!example) return;
    cancelVoice();
    recording = new AbortController();
    const thisRecording = recording;
    for (const control of exportControls) control.disabled = true;
    cancelExport.disabled = false;
    stage.scrollIntoView({ block: "center", behavior: "instant" });
    if (!handle) {
      handle = mountMax3D(stage);
      status.textContent = "3D requested. The static character remains until the first successful render; motion preferences can keep it static.";
    }
    handle.setPlayfulEnabled(false);
    handle.setSpeechLevel(null);
    try {
      const result = await recordMax3DExample(stage, handle, example, {
        signal: thisRecording.signal,
        onStatus: (message) => { if (!disposed) exportStatus.textContent = message; },
      });
      if (disposed || thisRecording.signal.aborted) return;
      const previous = downloads.get(example.id);
      if (previous) { URL.revokeObjectURL(previous.url); previous.link.remove(); }
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url; link.download = result.filename;
      link.textContent = `Download ${example.title.toLowerCase()} (${result.extension.toUpperCase()}, ${(result.blob.size / 1_000_000).toFixed(1)} MB)`;
      link.style.cssText = "padding:12px 14px;background:white;border-radius:12px;color:#164861;font-weight:600";
      files.append(link);
      downloads.set(example.id, { url, link });
      status.textContent = "The real 3D character was rendered and recorded successfully.";
      exportStatus.textContent = "Video ready. Choose its download link below. Nothing was uploaded.";
      link.focus({ preventScroll: true });
    } catch (error) {
      if (!disposed) exportStatus.textContent = error instanceof Error ? error.message : "The example could not be exported.";
    } finally {
      if (recording === thisRecording) recording = null;
      if (!disposed) {
        for (const control of exportControls) control.disabled = false;
        cancelExport.disabled = true;
        handle?.setAnimation(clip.value as Max3DState);
        handle?.setView(view.value as Max3DView);
        handle?.setPlayfulEnabled(playful.checked);
      }
    }
  };
  container.append(host);
  return () => {
    disposed = true; cancelVoice(); recording?.abort(); handle?.destroy();
    stage.removeEventListener("max3dframe", firstFrame);
    host.removeEventListener("keydown", escape);
    for (const { url } of downloads.values()) URL.revokeObjectURL(url);
    downloads.clear(); host.remove();
  };
}

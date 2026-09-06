import { mountMax3D, MAX_3D_STATES, MAX_3D_VIEWS, type Max3DState, type Max3DView } from "./max3d.js";
import { maxCharacterMarkup } from "./maxCharacter.js";

/** Development-only visual review. No account, scan, photo or provider call. */
export function mountMax3DPreview(container: HTMLElement = document.body): () => void {
  const host = document.createElement("section");
  host.setAttribute("aria-label", "Max 3D character preview");
  host.style.cssText = "max-width:780px;margin:40px auto;padding:28px;color:#172334;background:#f3f7fa;border-radius:24px;font-family:system-ui,sans-serif";
  host.innerHTML = `<h1 style="margin:0 0 12px">Meet the 3D Max prototype</h1>
    <p>Original geometry, three shared materials, six animation clips. This first iteration needs visual approval. The scan experience has not been replaced.</p>
    <div data-max-preview-stage style="display:block;position:relative;width:min(100%,420px);aspect-ratio:1;margin:12px auto;background:radial-gradient(ellipse at center,#fff,#e1ebf4);border-radius:28px">
      ${maxCharacterMarkup()}
    </div>
    <p data-max-preview-status role="status">Static fallback until you choose to load the preview.</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
      <button type="button" data-max-preview-load style="min-height:44px;padding:10px 16px;border:0;border-radius:12px;background:#123555;color:white">Load 3D Max</button>
      <label>Animation <select data-max-preview-clip style="min-height:44px;padding:10px;border-radius:10px">${MAX_3D_STATES.map((state) => `<option value="${state}">${state}</option>`).join("")}</select></label>
      <label>View <select data-max-preview-view style="min-height:44px;padding:10px;border-radius:10px">${MAX_3D_VIEWS.map((view) => `<option value="${view}"${view === "three-quarter" ? " selected" : ""}>${view}</option>`).join("")}</select></label>
      <button type="button" data-max-preview-static style="min-height:44px;padding:10px 16px;border-radius:12px">Return to static</button>
    </div>
    <p>Reduced motion and data-saving preferences keep the static character. Hidden tabs and offscreen stages pause animation. Speaking is a visual clip only and does not play audio.</p>
    <div style="height:650px;padding-top:30px;color:#57677a">Scroll the character offscreen to check the paused state.</div>`;
  const stage = host.querySelector<HTMLElement>("[data-max-preview-stage]")!;
  const fallback = stage.querySelector<SVGSVGElement>("svg")!;
  fallback.style.cssText = "display:block;width:100%;height:100%";
  const status = host.querySelector<HTMLElement>("[data-max-preview-status]")!;
  const clip = host.querySelector<HTMLSelectElement>("select")!;
  const view = host.querySelector<HTMLSelectElement>("[data-max-preview-view]")!;
  let handle: ReturnType<typeof mountMax3D> | null = null;
  host.querySelector<HTMLButtonElement>("[data-max-preview-load]")!.onclick = () => {
    handle?.destroy();
    handle = mountMax3D(stage, clip.value as Max3DState);
    handle.setView(view.value as Max3DView);
    status.textContent = "3D requested. The static character remains until the first successful render; motion preferences can keep it static.";
  };
  clip.onchange = () => handle?.setAnimation(clip.value as Max3DState);
  view.onchange = () => handle?.setView(view.value as Max3DView);
  host.querySelector<HTMLButtonElement>("[data-max-preview-static]")!.onclick = () => {
    handle?.destroy(); handle = null;
    status.textContent = "Static fallback selected. The 3D context has been released.";
  };
  container.append(host);
  return () => { handle?.destroy(); host.remove(); };
}

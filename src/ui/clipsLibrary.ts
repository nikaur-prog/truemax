import {
  clearLibraryClips,
  deleteLibraryClip,
  libraryClipToFile,
  listLibraryClips,
  saveLibraryFile,
} from "../engine/clipLibrary.js";
import { listFaces, type SavedFace } from "../engine/faceLibrary.js";

export interface ClipsLibraryActions {
  onBack: () => void;
  onUseFiles: (files: File[]) => void;
  onUseFace: (face: SavedFace) => void;
}

const DEMOS = [
  { name: "Adrian", src: "/demo/adrian.mp4", cover: "/demo/adrian.jpg" },
  { name: "Amara", src: "/demo/amara.mp4", cover: "/demo/amara.jpg" },
  { name: "Dev", src: "/demo/dev.mp4", cover: "/demo/dev.jpg" },
  { name: "Freya", src: "/demo/freya.mp4", cover: "/demo/freya.jpg" },
  { name: "Kai", src: "/demo/kai.mp4", cover: "/demo/kai.jpg" },
  { name: "Mei", src: "/demo/mei.mp4", cover: "/demo/mei.jpg" },
] as const;

let objectUrls: string[] = [];

function releaseUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function demoFile(src: string, name: string): Promise<File | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], `${name.toLowerCase()}-demo.mp4`, { type: blob.type || "video/mp4" });
  } catch {
    return null;
  }
}

export function closeClipsLibrary(): void {
  releaseUrls();
}

export async function openClipsLibrary(host: HTMLElement, actions: ClipsLibraryActions): Promise<void> {
  releaseUrls();
  host.innerHTML = `
    <div class="q-modebar">
      <button type="button" class="linkish" id="q-clips-back">← All tools</button>
      <span class="q-modebar-name">Clips Library</span>
      <span class="q-modebar-step">Kept on this device</span>
    </div>
    <div class="q-library-head">
      <div><h1>Your filming shelf</h1><p>Preview clips, keep source photos, and send a selection straight into Make a TikTok.</p></div>
      <button type="button" class="btn pri" id="q-clips-add">Add clips or photos</button>
      <input type="file" id="q-clips-input" accept="video/*,image/*" multiple hidden />
    </div>
    <p class="q-library-status" id="q-clips-status" role="status"></p>
    <section class="q-library-section">
      <div class="q-library-title"><div><span>YOUR FILES</span><small>Local to this browser and account</small></div><button type="button" class="linkish" id="q-clips-clear">Clear all</button></div>
      <div class="q-library-grid" id="q-clips-grid"></div>
    </section>
    <section class="q-library-section">
      <div class="q-library-title"><div><span>SAVED FACES</span><small>Open a previous scan without finding the photo again</small></div></div>
      <div class="q-library-grid q-library-faces" id="q-clips-faces"></div>
    </section>
    <section class="q-library-section">
      <div class="q-library-title"><div><span>TRUEMAX DEMO CLIPS</span><small>Preview, download, or add one to a cut</small></div></div>
      <div class="q-library-grid" id="q-clips-demos">
        ${DEMOS.map((demo, index) => `<article class="q-library-card">
          <video controls muted playsinline preload="metadata" poster="${demo.cover}" src="${demo.src}"></video>
          <div class="q-library-meta"><b>${demo.name}</b><small>TrueMax demo</small></div>
          <div class="q-library-actions"><button type="button" data-demo-use="${index}">Use in TikTok</button><a href="${demo.src}" download>Download</a></div>
        </article>`).join("")}
      </div>
    </section>`;

  const status = host.querySelector<HTMLElement>("#q-clips-status")!;
  const input = host.querySelector<HTMLInputElement>("#q-clips-input")!;
  host.querySelector<HTMLButtonElement>("#q-clips-back")!.onclick = actions.onBack;
  host.querySelector<HTMLButtonElement>("#q-clips-add")!.onclick = () => input.click();

  const renderLocal = async () => {
    releaseUrls();
    const [clips, faces] = await Promise.all([listLibraryClips(), listFaces()]);
    const grid = host.querySelector<HTMLElement>("#q-clips-grid")!;
    const faceGrid = host.querySelector<HTMLElement>("#q-clips-faces")!;
    grid.innerHTML = clips.length ? clips.map((clip) => {
      const url = URL.createObjectURL(clip.blob);
      objectUrls.push(url);
      const preview = clip.kind === "video"
        ? `<video controls muted playsinline preload="metadata" src="${url}"></video>`
        : `<img src="${url}" alt="" />`;
      return `<article class="q-library-card" data-clip="${clip.id}">
        ${preview}<div class="q-library-meta"><b title="${esc(clip.name)}">${esc(clip.name)}</b><small>${sizeLabel(clip.size)}</small></div>
        <div class="q-library-actions"><button type="button" data-clip-use="${clip.id}">Use in TikTok</button><button class="danger" type="button" data-clip-delete="${clip.id}">Delete</button></div>
      </article>`;
    }).join("") : `<div class="q-library-empty"><b>No saved files yet</b><span>Add source clips once and reuse them across edits.</span></div>`;
    faceGrid.innerHTML = faces.length ? faces.map((face) => `<article class="q-library-card" data-face="${face.id}">
      <img src="${face.photo}" alt="" />
      <div class="q-library-meta"><b>${esc(face.label)}</b><small>${face.score.toFixed(1)}/10 · saved scan</small></div>
      <div class="q-library-actions"><button type="button" data-face-use="${face.id}">Open analysis</button></div>
    </article>`).join("") : `<div class="q-library-empty"><b>No saved faces yet</b><span>Faces you keep after a scan appear here.</span></div>`;

    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-clip-use]")) {
      button.onclick = () => {
        const clip = clips.find((entry) => entry.id === button.dataset.clipUse);
        if (clip) actions.onUseFiles([libraryClipToFile(clip)]);
      };
    }
    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-clip-delete]")) {
      button.onclick = async () => {
        await deleteLibraryClip(button.dataset.clipDelete ?? "");
        await renderLocal();
      };
    }
    for (const button of faceGrid.querySelectorAll<HTMLButtonElement>("[data-face-use]")) {
      button.onclick = () => {
        const face = faces.find((entry) => entry.id === button.dataset.faceUse);
        if (face) actions.onUseFace(face);
      };
    }
    host.querySelector<HTMLButtonElement>("#q-clips-clear")!.disabled = clips.length === 0;
  };

  input.onchange = async () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (!files.length) return;
    status.textContent = `Saving ${files.length} ${files.length === 1 ? "item" : "items"}…`;
    let saved = 0;
    let lastError = "";
    for (const file of files) {
      const result = await saveLibraryFile(file);
      if (result.entry) saved += 1;
      if (result.error) lastError = result.error;
    }
    status.textContent = saved
      ? `${saved} ${saved === 1 ? "item is" : "items are"} ready in your library.`
      : lastError || "Those files could not be saved.";
    await renderLocal();
  };

  host.querySelector<HTMLButtonElement>("#q-clips-clear")!.onclick = async () => {
    if (!confirm("Remove every saved clip and photo from this device?")) return;
    await clearLibraryClips();
    status.textContent = "Your saved files were removed from this device.";
    await renderLocal();
  };

  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-demo-use]")) {
    button.onclick = async () => {
      const demo = DEMOS[Number(button.dataset.demoUse)];
      if (!demo) return;
      button.disabled = true;
      button.textContent = "Loading…";
      const file = await demoFile(demo.src, demo.name);
      button.disabled = false;
      button.textContent = "Use in TikTok";
      if (file) actions.onUseFiles([file]);
      else status.textContent = "That demo could not be loaded just now.";
    };
  }

  await renderLocal();
}

import { HiggsfieldClient } from "@higgsfield/client";
import { createHiggsfieldClient } from "@higgsfield/client/v2";
import { RENDER_LAYERS } from "../src/engine/goalCatalogue.js";
import type { RenderLayer } from "../src/engine/goalCatalogue.js";
import { downloadRemoteImage } from "./_remoteImage.js";

// ---------------------------------------------------------------------------
// The image provider behind the Goal preview, behind one interface.
//
// The route never talks to a provider directly. It hands this module the two
// prepared photographs and the bounded instruction set the catalogue
// produced, and gets two rendered views back or a plain error. The first
// implementation is Higgsfield, with the same client, upload and polling the
// carousel route uses; the fallback is the OpenAI edit endpoint. Which one
// runs is decided by which credentials the deployment holds, so the choice
// is a deployment setting and not a code change. A later in-house renderer
// implements the same three-line interface.
//
// A retention fact the consent copy has to carry: the Higgsfield path
// uploads the two prepared photographs to the provider to reference them,
// and the installed client offers no call to delete an upload. The upload
// references are returned as providerRef and stored on the preview row so
// a deletion can be made the day the provider exposes one; until then the
// dialog states the provider's own retention terms and links them, as the
// cloud-pass consent does. The OpenAI path sends the bytes in the request
// and stores no reference.
//
// What a prompt may say is fixed here and nowhere else. Every render carries
// the identity clauses (same person, same bone structure, same age and sex
// presentation, same skin tone as photographed), and only the phrases for
// the layers the catalogue allowed are added. No text a person typed ever
// reaches a prompt. See docs/FACIAL_MORPH_PLAN.md section 5c.
// ---------------------------------------------------------------------------

export type PreviewProviderName = "higgsfield" | "openai";

export interface PreviewRenderInput {
  /** Prepared JPEGs, upright, at most 1600 px on the long side. */
  front: Buffer;
  side: Buffer;
  /** From previewInstructions; nothing else. */
  instructions: string;
  /** Absolute time by which everything must be done. */
  deadline: number;
}

export interface PreviewRenderOutput {
  front: Buffer;
  side: Buffer;
  providerRef: string | null;
}

export interface PreviewRenderFailure {
  error: string;
  status: number;
}

export interface PreviewProvider {
  name: PreviewProviderName;
  render(input: PreviewRenderInput): Promise<PreviewRenderOutput | PreviewRenderFailure>;
}

const IDENTITY_CLAUSES =
  "Photorealistic portrait of the same person as the reference photograph, in the same pose, framing, camera angle and lighting. " +
  "Keep the identity exactly: the same bone structure, face shape, eye shape, nose, lips, chin and jaw, the same age and sex presentation, the same skin tone and complexion as photographed, the same hair colour. " +
  "Do not infer or alter ethnicity. No cosmetic surgery, no procedure, no filler, no reshaping of any feature. No text, no watermark, no caption, no frame.";

const LAYER_PHRASES: Record<RenderLayer, string> = {
  hair: "The hair is neatly styled and well kept, the same colour and length as photographed; no new hair growth.",
  facialHair: "Facial hair is neatly groomed with a clean, well defined edge, the same coverage as photographed.",
  brows: "The eyebrows are tidily groomed and shaped, the same thickness and colour as photographed.",
  skinSurface: "The skin surface reads well rested and evenly lit, with the same features, marks and texture as photographed; no diagnosis and no cosmetic-treatment claim.",
  leanerPresentation: "A modestly leaner, less puffy presentation of the lower face and neck, within what sleep, hydration and diet change over weeks; the jaw and chin bone unchanged.",
  posture: "Upright posture, the chin level and the head carried straight, the neck long.",
  expression: "A relaxed, natural expression with a soft closed-mouth smile, eyes open and calm.",
  lighting: "Even, flattering soft light from slightly above, without harsh shadows.",
  wardrobe: "A clean, plain, well fitting neckline, the same colours as photographed.",
};

/**
 * The instruction set for a render, from the layers alone. Unknown layers
 * are dropped, never passed through; an empty set still carries the
 * identity clauses, so a render with nothing allowed changes nothing.
 */
export function previewInstructions(layers: readonly string[]): string {
  const allowed = RENDER_LAYERS.filter((l) => layers.includes(l));
  const changes = allowed.length
    ? `Only the following presentation may differ from the photograph: ${allowed.map((l) => LAYER_PHRASES[l]).join(" ")}`
    : "Nothing about the person's presentation differs from the photograph.";
  return `${IDENTITY_CLAUSES} ${changes}`;
}

interface Credentials {
  key: string;
  secret: string;
  joined: string;
}

function higgsfieldCredentials(env: NodeJS.ProcessEnv): Credentials | null {
  const joined = env.HF_CREDENTIALS?.trim() ?? "";
  const separator = joined.indexOf(":");
  if (separator < 1 || separator === joined.length - 1) return null;
  return { key: joined.slice(0, separator), secret: joined.slice(separator + 1), joined };
}

function remaining(deadline: number): number {
  return deadline - Date.now();
}

function higgsfield(credentials: Credentials, endpoint: string): PreviewProvider {
  const renderOne = async (image: Buffer, instructions: string, deadline: number, refs: string[]): Promise<Buffer | PreviewRenderFailure> => {
    if (remaining(deadline) <= 1_000) return { error: "The image service did not respond in time.", status: 504 };
    const uploader = new HiggsfieldClient({
      apiKey: credentials.key,
      apiSecret: credentials.secret,
      timeout: Math.min(30_000, Math.max(1_000, remaining(deadline))),
      maxRetries: 1,
    });
    let reference: string;
    try {
      reference = await uploader.uploadImage(image, "jpeg");
    } finally {
      uploader.close();
    }
    refs.push(reference);
    if (remaining(deadline) <= 1_000) return { error: "The image service did not respond in time.", status: 504 };
    const client = createHiggsfieldClient({
      credentials: credentials.joined,
      timeout: Math.min(120_000, Math.max(1_000, remaining(deadline))),
      maxRetries: 1,
      pollInterval: 2_000,
      maxPollTime: Math.min(150_000, Math.max(1_000, remaining(deadline))),
    });
    const result = await client.subscribe(endpoint, {
      input: {
        prompt: instructions,
        width_and_height: "1024x1280",
        quality: "1080p",
        batch_size: 1,
        image_reference: { type: "image_url", image_url: reference },
      },
      withPolling: true,
    });
    const url = result.status === "completed" ? result.images?.[0]?.url : undefined;
    if (!url) {
      return result.status === "nsfw"
        ? { error: "That preview was refused by the image service.", status: 400 }
        : { error: "The image service returned no preview.", status: 502 };
    }
    const bytes = await downloadRemoteImage(url, deadline);
    if (!bytes) return { error: "The preview could not be downloaded.", status: 502 };
    return bytes;
  };
  return {
    name: "higgsfield",
    async render(input) {
      // Both views together: the budget is shared and the calls are independent.
      const refs: string[] = [];
      const [front, side] = await Promise.all([
        renderOne(input.front, input.instructions, input.deadline, refs),
        renderOne(input.side, `${input.instructions} This is the side profile of the same person.`, input.deadline, refs),
      ]);
      if (!Buffer.isBuffer(front)) return front;
      if (!Buffer.isBuffer(side)) return side;
      return { front, side, providerRef: refs.length ? refs.join(" ") : null };
    },
  };
}

function openai(apiKey: string): PreviewProvider {
  const editOne = async (image: Buffer, instructions: string, deadline: number): Promise<Buffer | PreviewRenderFailure> => {
    const left = remaining(deadline);
    if (left <= 1_000) return { error: "The image service did not respond in time.", status: 504 };
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", instructions);
    form.append("size", "1024x1536");
    form.append("quality", "high");
    form.append("image", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "source.jpg");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.min(120_000, left));
    try {
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: abort.signal,
      });
      if (response.status === 400) return { error: "That preview was refused by the image service.", status: 400 };
      if (!response.ok) return { error: "The image service returned no preview.", status: 502 };
      const body = (await response.json().catch(() => null)) as { data?: Array<{ b64_json?: string }> } | null;
      const b64 = body?.data?.[0]?.b64_json;
      if (!b64) return { error: "The image service returned no preview.", status: 502 };
      return Buffer.from(b64, "base64");
    } catch {
      return { error: "The image service did not respond in time.", status: 504 };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    name: "openai",
    async render(input) {
      const [front, side] = await Promise.all([
        editOne(input.front, input.instructions, input.deadline),
        editOne(input.side, `${input.instructions} This is the side profile of the same person.`, input.deadline),
      ]);
      if (!Buffer.isBuffer(front)) return front;
      if (!Buffer.isBuffer(side)) return side;
      return { front, side, providerRef: null };
    },
  };
}

/** The provider this deployment can use, or null when none is configured. */
export function previewProvider(env: NodeJS.ProcessEnv = process.env): PreviewProvider | null {
  const hf = higgsfieldCredentials(env);
  const endpoint = env.HIGGSFIELD_PREVIEW_ENDPOINT?.trim();
  if (hf && endpoint) return higgsfield(hf, endpoint);
  const key = env.OPENAI_API_KEY?.trim();
  if (key) return openai(key);
  return null;
}

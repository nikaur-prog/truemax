import { HiggsfieldClient } from "@higgsfield/client";
import { createHiggsfieldClient } from "@higgsfield/client/v2";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import sharp from "sharp";
import {
  authenticatedUser,
  claimTtsRender,
  finalizeTtsRender,
  getSupabaseAdmin,
  json,
  refundTtsRender,
  requestOrigin,
  safeMessage,
} from "./_shared.js";
import { carouselProviderPrompt, parseCarouselGeneration } from "../src/engine/carouselSpec.js";
import { safeRemoteAddress, safeRemoteImageUrl } from "../src/engine/remoteImageUrl.js";

const MAX_SOURCE_BYTES = 3 * 1024 * 1024;
const MAX_PROVIDER_BYTES = 15 * 1024 * 1024;
const MAX_RESPONSE_JPEG_BYTES = 3 * 1024 * 1024;
const TOTAL_BUDGET_MS = 160_000;

interface ProviderCredentials {
  key: string;
  secret: string;
  joined: string;
}

function credentials(): ProviderCredentials | null {
  const joined = process.env.HF_CREDENTIALS?.trim() ?? "";
  const separator = joined.indexOf(":");
  if (separator < 1 || separator === joined.length - 1) return null;
  return { key: joined.slice(0, separator), secret: joined.slice(separator + 1), joined };
}

function decodeSourceDataUrl(value: string): Buffer | null {
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) return null;
  return buffer;
}

async function boundedImage(response: IncomingMessage): Promise<Buffer | null> {
  const declared = Number(response.headers["content-length"] ?? 0);
  if (declared > MAX_PROVIDER_BYTES) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > MAX_PROVIDER_BYTES) {
      response.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function pinnedHttpsGet(url: URL, signal: AbortSignal): Promise<IncomingMessage | null> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => !safeRemoteAddress(address))) return null;
  const pinned = addresses[0];
  return await new Promise<IncomingMessage | null>((resolve) => {
    const request = httpsRequest({
      protocol: "https:",
      hostname: pinned.address,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { accept: "image/*", host: url.host },
      servername: hostname,
      signal,
    }, resolve);
    request.once("error", () => resolve(null));
    request.end();
  });
}

async function downloadGenerated(url: string, deadline: number): Promise<Buffer | null> {
  let current = safeRemoteImageUrl(url);
  if (!current) return null;
  const remaining = deadline - Date.now();
  if (remaining <= 1_000) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.min(25_000, remaining));
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await pinnedHttpsGet(current, abort.signal);
      if (!response) return null;
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        response.destroy();
        if (!location) return null;
        const next = safeRemoteImageUrl(location, current);
        if (!next) return null;
        current = next;
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        return null;
      }
      return await boundedImage(response);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function responseJpeg(generated: Buffer): Promise<Buffer | null> {
  for (const quality of [86, 74, 60]) {
    const jpeg = await sharp(generated, { failOn: "error" })
      .rotate()
      .resize(1080, 1920, { fit: "cover", position: "attention" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (jpeg.length <= MAX_RESPONSE_JPEG_BYTES) return jpeg;
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  let reservation: string | null = null;
  let claimant: string | null = null;
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin generation is not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to generate a slide." }, 401);

    const { data: staff, error: staffError } = await getSupabaseAdmin()
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();
    if (staffError) throw new Error(`Carousel access check failed: ${staffError.message}`);

    let metered = false;
    if (!staff) {
      const { data: creator, error: creatorError } = await getSupabaseAdmin()
        .from("league_creators")
        .select("status, pillar_grants")
        .eq("user_id", user.id)
        .maybeSingle<{ status: string; pillar_grants: Record<string, unknown> | null }>();
      if (creatorError) throw new Error(`Carousel access check failed: ${creatorError.message}`);
      if (creator?.status !== "approved" || creator.pillar_grants?.studio !== true) {
        return json({ error: "Not found." }, 404);
      }
      metered = true;
    }
    claimant = user.id;

    const parsed = parseCarouselGeneration(await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const providerCredentials = credentials();
    const endpoint = process.env.HIGGSFIELD_CAROUSEL_ENDPOINT?.trim();
    if (!providerCredentials || !endpoint) {
      return json({ error: "Carousel generation is not configured on this deployment." }, 503);
    }

    let sourceBuffer: Buffer | null = null;
    if (parsed.value.spec.sourceMode === "morph") {
      sourceBuffer = decodeSourceDataUrl(parsed.value.sourceDataUrl ?? "");
      if (!sourceBuffer) return json({ error: "The source photo is missing, unsupported or too large." }, 413);
    }

    if (metered) {
      reservation = await claimTtsRender(user.id, "studio");
      if (!reservation) return json({ error: "Monthly render quota reached. It resets on the 1st." }, 429);
    }

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let imageReference: string | undefined;
    if (sourceBuffer) {
      const normalized = await sharp(sourceBuffer, { failOn: "error" })
        .rotate()
        .resize({ width: 1600, height: 2000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      if (Date.now() >= deadline - 1_000) return json({ error: "The image service did not respond in time." }, 504);
      const uploader = new HiggsfieldClient({
        apiKey: providerCredentials.key,
        apiSecret: providerCredentials.secret,
        timeout: Math.min(30_000, Math.max(1_000, deadline - Date.now())),
        maxRetries: 1,
      });
      try {
        imageReference = await uploader.uploadImage(normalized, "jpeg");
      } finally {
        uploader.close();
      }
    }

    if (Date.now() >= deadline - 1_000) return json({ error: "The image service did not respond in time." }, 504);
    const client = createHiggsfieldClient({
      credentials: providerCredentials.joined,
      timeout: Math.min(120_000, Math.max(1_000, deadline - Date.now())),
      maxRetries: 1,
      pollInterval: 2_000,
      maxPollTime: Math.min(135_000, Math.max(1_000, deadline - Date.now())),
    });
    const result = await client.subscribe(endpoint, {
      input: {
        prompt: carouselProviderPrompt(parsed.value.spec),
        width_and_height: "1080x1920",
        quality: "1080p",
        batch_size: 1,
        ...(imageReference ? { image_reference: { type: "image_url", image_url: imageReference } } : {}),
      },
      withPolling: true,
    });
    const generatedUrl = result.status === "completed" ? result.images?.[0]?.url : undefined;
    if (!generatedUrl) {
      const refused = result.status === "nsfw";
      return json(
        { error: refused ? "That request was refused. Try a different source or description." : "The image service returned no slide." },
        refused ? 400 : 502,
      );
    }

    const generated = await downloadGenerated(generatedUrl, deadline);
    if (!generated) return json({ error: "The generated slide could not be downloaded." }, 502);
    const jpeg = await responseJpeg(generated);
    if (!jpeg) return json({ error: "The generated slide was too large to deliver safely." }, 502);

    if (reservation) {
      const consumed = reservation;
      reservation = null;
      await finalizeTtsRender(consumed, user.id).catch((finalizeError) => {
        // Leave the row reserved. The stale sweep releases it after 15 minutes.
        // Refunding here would give back a slot after the image was delivered.
        console.error("carousel finalize failed, slot left reserved", safeMessage(finalizeError));
      });
    }
    return json({ image: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  } catch (error) {
    console.error("carousel generation failed", safeMessage(error));
    return json({ error: "The slide could not be generated." }, 500);
  } finally {
    if (reservation && claimant) {
      await refundTtsRender(reservation, claimant).catch((refundError) => {
        console.error("carousel refund failed", safeMessage(refundError));
      });
    }
  }
}

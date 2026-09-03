import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { safeRemoteAddress, safeRemoteImageUrl } from "../src/engine/remoteImageUrl.js";

// A provider hands back a URL; the server fetches it with the address pinned
// to what DNS said and refused if it points anywhere private, follows at
// most three redirects through the same check, and stops reading past a
// ceiling. Lifted from api/carousel-slide.ts so a second provider route
// cannot drift from the first; the carousel keeps its own copy until its
// source-slicing tests are moved.

export const MAX_PROVIDER_BYTES = 15 * 1024 * 1024;

export async function boundedBody(response: IncomingMessage, limit = MAX_PROVIDER_BYTES): Promise<Buffer | null> {
  const declared = Number(response.headers["content-length"] ?? 0);
  if (declared > limit) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > limit) {
      response.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function pinnedHttpsGet(url: URL, signal: AbortSignal): Promise<IncomingMessage | null> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => !safeRemoteAddress(address))) return null;
  const pinned = addresses[0];
  return await new Promise<IncomingMessage | null>((resolve) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: pinned.address,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "image/*", host: url.host },
        servername: hostname,
        signal,
      },
      resolve,
    );
    request.once("error", () => resolve(null));
    request.end();
  });
}

/** Download a provider's output image, bounded and pinned, within the deadline. */
export async function downloadRemoteImage(url: string, deadline: number): Promise<Buffer | null> {
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
      return await boundedBody(response);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

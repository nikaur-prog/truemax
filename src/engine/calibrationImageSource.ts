/** A match key for private calibration images, never a photograph or a file name. */
export interface CalibrationImageSource {
  schemaVersion: 1;
  /** SHA-256 of original upload bytes, before decoding, resizing or orientation handling. */
  originalFileSha256?: string;
  /** SHA-256 of the versioned dimensions header followed by displayed RGBA bytes. */
  reviewPixelsSha256: string;
  width: number;
  height: number;
  pixelFormat: "rgba8";
  /** Coordinates refer to this decoded review raster, not raw EXIF file orientation. */
  orientation: "review-image-as-displayed";
}

type CalibrationCanvas = Pick<HTMLCanvasElement, "width" | "height" | "getContext">;
const hashPattern = /^[a-f0-9]{64}$/;
const isDimension = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const cancelled = () => new DOMException("Calibration image matching was cancelled.", "AbortError");

/** Strip unrecognised fields, including names or pixels, from locally stored metadata. */
export function snapshotCalibrationImageSource(
  value: unknown,
  dimensions?: { width: number; height: number },
): CalibrationImageSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The calibration photo match is missing.");
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || !isDimension(source.width) || !isDimension(source.height)
    || source.pixelFormat !== "rgba8" || source.orientation !== "review-image-as-displayed"
    || typeof source.reviewPixelsSha256 !== "string" || !hashPattern.test(source.reviewPixelsSha256)
    || (source.originalFileSha256 !== undefined && (typeof source.originalFileSha256 !== "string" || !hashPattern.test(source.originalFileSha256)))) {
    throw new Error("The calibration photo match is invalid. Review the photo again before saving.");
  }
  if (dimensions && (source.width !== dimensions.width || source.height !== dimensions.height)) {
    throw new Error("The calibration photo and point dimensions do not match. Review the photo again before saving.");
  }
  return {
    schemaVersion: 1,
    ...(source.originalFileSha256 === undefined ? {} : { originalFileSha256: source.originalFileSha256 as string }),
    reviewPixelsSha256: source.reviewPixelsSha256,
    width: source.width,
    height: source.height,
    pixelFormat: "rgba8",
    orientation: "review-image-as-displayed",
  };
}

// Native digest/file reads cannot be interrupted, but an obsolete capture must
// stop waiting immediately and must never publish its eventual match key.
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(cancelled()); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((result) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(cancelled()); else resolve(result);
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort);
      reject(signal.aborted ? cancelled() : error);
    });
  });
}

async function sha256(bytes: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw cancelled();
  const digest = await abortable(crypto.subtle.digest("SHA-256", bytes), signal);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Call only in the authorized calibration flow, before any overlays are painted.
 * Snapshot synchronously so retakes cannot replace the pixels while hashing.
 * The review digest is for this raster, not a promise that different browsers
 * decode/resample a file identically; the original-file digest is the archive key.
 */
export async function fingerprintCalibrationImage(
  canvas: CalibrationCanvas,
  options: { originalFile?: Blob; signal?: AbortSignal } = {},
): Promise<CalibrationImageSource> {
  const { signal } = options;
  if (signal?.aborted) throw cancelled();
  const { width, height } = canvas;
  if (!isDimension(width) || !isDimension(height)) throw new Error("The calibration photo has no readable dimensions.");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The calibration photo could not be matched. Try opening it again.");
  const pixels = context.getImageData(0, 0, width, height).data;
  if (pixels.length !== width * height * 4) throw new Error("The calibration photo pixels are incomplete.");
  const header = new TextEncoder().encode(`truemax-calibration-rgba8-v1\n${width}x${height}\n`);
  const reviewBytes = new Uint8Array(header.length + pixels.length);
  reviewBytes.set(header);
  reviewBytes.set(pixels, header.length);
  const reviewPixelsSha256 = await sha256(reviewBytes.buffer, signal);
  const originalFileSha256 = options.originalFile
    ? await sha256(await abortable(options.originalFile.arrayBuffer(), signal), signal)
    : undefined;
  if (signal?.aborted) throw cancelled();
  return {
    schemaVersion: 1,
    ...(originalFileSha256 ? { originalFileSha256 } : {}),
    reviewPixelsSha256,
    width, height,
    pixelFormat: "rgba8",
    orientation: "review-image-as-displayed",
  };
}

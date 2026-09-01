// ---------------------------------------------------------------------------
// A canvas is not a photograph.
//
// In particular, iOS WebKit is allowed to discard a canvas backing buffer when
// the browser is backgrounded. The DOM node survives, as do the independently
// painted landmark canvases, but the pixels come back transparent. Inside the
// dark face frame that reads as a black photograph with a handful of points on
// it — exactly the worst possible failure mode for a finished scan.
//
// Keep an encoded, CPU-backed copy of every result photograph and repaint the
// canvases when the page returns. The copy is bounded before encoding so this
// does not turn a pair of phone captures into several permanent full-resolution
// buffers. It lives only for the mounted report and is never uploaded.
// ---------------------------------------------------------------------------

const MAX_EDGE = 1_600;
const JPEG_QUALITY = 0.9;

interface Snapshot {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  encoded: Promise<Blob | null>;
}

export interface CanvasRecoveryHandle {
  /** Repaint every source canvas from its encoded copy. */
  restore(): Promise<boolean>;
  /** Remove lifecycle listeners and ignore any in-flight decode. */
  destroy(): void;
}

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(canvas.width, canvas.height));
    // Normal phone captures are already inside the bound. Let the browser
    // encode that backing store directly instead of synchronously copying a
    // second full canvas during the result reveal — recovery must not re-add
    // the very arrival hitch the performance pass removed.
    if (scale === 1) {
      return new Promise((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
        } catch {
          resolve(null);
        }
      });
    }
    const copy = document.createElement("canvas");
    copy.width = Math.max(1, Math.round(canvas.width * scale));
    copy.height = Math.max(1, Math.round(canvas.height * scale));
    copy.getContext("2d")?.drawImage(canvas, 0, 0, copy.width, copy.height);
    return new Promise((resolve) => {
      try {
        copy.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return Promise.resolve(null);
  }
}

function drawBlob(target: HTMLCanvasElement, blob: Blob, width: number, height: number): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const finish = (ok: boolean) => {
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    image.onload = () => {
      try {
        // Preserve the capture's intrinsic dimensions. Overlay recipes and
        // side points use this coordinate space even though the encoded copy
        // itself may have been scaled down before compression.
        target.width = width;
        target.height = height;
        const context = target.getContext("2d");
        if (!context) return finish(false);
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        finish(true);
      } catch {
        finish(false);
      }
    };
    image.onerror = () => finish(false);
    image.src = url;
  });
}

/**
 * Protect a mounted report's source canvases from mobile background eviction.
 *
 * `onRestore` repaints the one visible pane and its overlay after the hidden
 * source canvases have been rebuilt. Calls are coalesced because iOS commonly
 * fires focus, visibilitychange and pageshow together on one return.
 */
export function mountCanvasRecovery(
  canvases: Array<HTMLCanvasElement | null | undefined>,
  onRestore: () => void,
): CanvasRecoveryHandle {
  const snapshots: Snapshot[] = canvases
    .filter((canvas): canvas is HTMLCanvasElement => Boolean(canvas))
    .map((canvas) => ({
      canvas,
      width: canvas.width,
      height: canvas.height,
      // Encoding starts immediately, while WebKit is known to hold the pixels.
      encoded: encode(canvas),
    }));

  let dead = false;
  let running: Promise<boolean> | null = null;

  const restore = (): Promise<boolean> => {
    if (dead || !snapshots.length) return Promise.resolve(false);
    if (running) return running;
    running = Promise.all(
      snapshots.map(async (snapshot) => {
        const blob = await snapshot.encoded;
        if (dead || !blob) return false;
        return drawBlob(snapshot.canvas, blob, snapshot.width, snapshot.height);
      }),
    )
      .then((results) => {
        const restored = results.some(Boolean);
        if (!dead && restored) onRestore();
        return restored;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const onVisibility = () => {
    if (!document.hidden) void restore();
  };
  const onPageShow = () => void restore();
  // A focus event can arrive while the document is still hidden during an
  // app-switch transition. Waiting for visibilitychange avoids decoding and
  // repainting into a background page for no user-visible benefit.
  const onFocus = () => {
    if (!document.hidden) void restore();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focus", onFocus);

  return {
    restore,
    destroy() {
      dead = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
    },
  };
}

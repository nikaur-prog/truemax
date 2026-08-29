import { activeScanOwner } from "./scanScope.js";
import { scopedStorageKey } from "./scanScope.js";

// ---------------------------------------------------------------------------
// The profile picture: the person's own face, from their own first scan.
//
// Until now the account had no face anywhere — a product whose entire subject
// is your face represented you with nothing. The first front photo a member
// scans OF THEMSELVES becomes their picture automatically; it can be swapped
// to any other scan's photo, or removed, from settings. Guests' scans are
// never adopted: somebody else's face must not become your profile.
//
// Storage is a small square JPEG data URL in owner-scoped localStorage, ~4KB
// at 96px. Deliberately NOT a pointer into the photo store: an avatar that is
// a reference dies the moment its scan's thumbnail is pruned or "delete this
// profile's stored photos" is pressed, and a profile picture that silently
// vanishes reads as a bug. A copy this small is cheaper than the coupling.
// Like every photograph in this product, it never leaves the device.
// ---------------------------------------------------------------------------

const KEY = () => scopedStorageKey("truemax:avatar");

// The header's account disc renders whatever this module holds, and it is
// painted at auth time — which on the very first scan is BEFORE any avatar
// exists. Announcing every write lets that disc (or anything else showing the
// face) repaint the moment the first front capture is adopted, instead of the
// picture only appearing after a reload.
const CHANGE_EVENT = "truemax:avatar-changed";

export function onAvatarChange(listener: () => void): void {
  window.addEventListener(CHANGE_EVENT, listener);
}

function announceAvatarChange(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* no window (tests) — nothing is listening anyway */
  }
}

export function loadAvatar(): string | null {
  try {
    const key = KEY();
    if (!key) return null;
    const v = localStorage.getItem(key);
    return v && v.startsWith("data:image/") ? v : null;
  } catch {
    return null;
  }
}

export function saveAvatar(dataUrl: string): void {
  try {
    const key = KEY();
    if (key) {
      localStorage.setItem(key, dataUrl);
      announceAvatarChange();
    }
  } catch {
    /* storage refused — the avatar just doesn't persist */
  }
}

export function clearAvatar(): void {
  try {
    const key = KEY();
    if (key) {
      localStorage.removeItem(key);
      announceAvatarChange();
    }
  } catch {
    /* nothing to clear */
  }
}

const SIZE = 96;

/**
 * A source image squared down to avatar size, centre-cropped.
 *
 * Centre-crop rather than letterbox because the capture flow already frames
 * the face in the middle of the photograph — the guide insists on it — so the
 * centre square of a front capture IS the face.
 */
export function toAvatarThumb(src: CanvasImageSource & { width: number; height: number }): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = SIZE;
    c.height = SIZE;
    const g = c.getContext("2d");
    if (!g) return null;
    const side = Math.min(src.width, src.height);
    g.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return c.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** The same crop, from a stored thumbnail's data URL. */
export function dataUrlToAvatar(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(toAvatarThumb(img));
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Adopt a face as the avatar only when the account does not have one yet —
 * the "first ever front scan" behaviour, safe to call after every scan.
 *
 * Owner-gated twice: the key is owner-scoped, and a missing owner (identity
 * still resolving) adopts nothing rather than writing into limbo.
 */
export function maybeAdoptAvatar(front: CanvasImageSource & { width: number; height: number }): void {
  if (!activeScanOwner()) return;
  if (loadAvatar()) return;
  const thumb = toAvatarThumb(front);
  if (thumb) saveAvatar(thumb);
}

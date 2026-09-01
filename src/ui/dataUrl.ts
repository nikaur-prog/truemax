const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

export interface DecodedImageDataUrl {
  blob: Blob;
  extension: "png" | "jpg" | "webp";
}
/** Decode locally. Fetching a data URL is blocked by the production connect-src CSP. */
export function decodeImageDataUrl(value: string): DecodedImageDataUrl | null {
  const match = value.match(IMAGE_DATA_URL);
  if (!match) return null;
  const mime = match[1].toLowerCase() === "jpeg" ? "jpeg" : match[1].toLowerCase();
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return {
    blob: new Blob([bytes], { type: `image/${mime}` }),
    extension: mime === "jpeg" ? "jpg" : mime as "png" | "webp",
  };
}

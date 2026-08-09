// EXIF orientation.
//
// Phones store portrait shots as landscape pixels plus a rotation flag. Every
// browser is supposed to honour that flag when decoding, and in practice not
// all of them do — an iPhone portrait came through this engine rotated 92°,
// which drops landmark accuracy and cost a full score point in testing. So we
// read the flag ourselves and apply it, rather than trusting the decoder.

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export async function readOrientation(file: Blob): Promise<Orientation> {
  try {
    // The marker lives in the first APP1 segment, well inside the first 128KB
    const head = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (head.getUint16(0, false) !== 0xffd8) return 1; // not a JPEG

    let offset = 2;
    while (offset + 4 < head.byteLength) {
      const marker = head.getUint16(offset, false);
      const size = head.getUint16(offset + 2, false);
      if (marker === 0xffe1) {
        // APP1 — check for the "Exif\0\0" signature
        if (head.getUint32(offset + 4, false) !== 0x45786966) return 1;
        const tiff = offset + 10;
        const little = head.getUint16(tiff, false) === 0x4949;
        const ifd = tiff + head.getUint32(tiff + 4, little);
        const entries = head.getUint16(ifd, little);
        for (let i = 0; i < entries; i++) {
          const entry = ifd + 2 + i * 12;
          if (head.getUint16(entry, little) === 0x0112) {
            const v = head.getUint16(entry + 8, little);
            return v >= 1 && v <= 8 ? (v as Orientation) : 1;
          }
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      offset += 2 + size;
    }
  } catch {
    /* unreadable header — assume upright */
  }
  return 1;
}

// Does this orientation swap width and height?
export function swapsAxes(o: Orientation): boolean {
  return o >= 5;
}

// Apply the orientation to a context sized for the FINAL (displayed) image.
export function applyOrientation(
  ctx: CanvasRenderingContext2D,
  o: Orientation,
  w: number,
  h: number,
): void {
  switch (o) {
    case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;
    case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0, h); ctx.scale(1, -1); break;
    case 5: ctx.rotate(Math.PI / 2); ctx.scale(1, -1); break;
    case 6: ctx.rotate(Math.PI / 2); ctx.translate(0, -h); break;
    case 7: ctx.rotate(Math.PI / 2); ctx.translate(w, -h); ctx.scale(-1, 1); break;
    case 8: ctx.rotate(-Math.PI / 2); ctx.translate(-w, 0); break;
    default: break;
  }
}

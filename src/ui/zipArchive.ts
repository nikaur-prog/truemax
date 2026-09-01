// A tiny stored-ZIP writer for the Carousel Creator export pack. JPEG slides
// are already compressed, so adding a general compression dependency would
// grow the application without making the pack meaningfully smaller.

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true);
}

function u32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function dosTimestamp(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function buildStoredZip(files: Record<string, Uint8Array>, now = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const timestamp = dosTimestamp(now);
  let localOffset = 0;
  let count = 0;

  for (const [filename, data] of Object.entries(files)) {
    const name = encoder.encode(filename.replace(/[\\/]+/g, "-").slice(0, 160));
    if (!name.length) continue;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    u32(local, 0, 0x04034b50);
    u16(local, 4, 20);
    u16(local, 6, 0x0800);
    u16(local, 8, 0);
    u16(local, 10, timestamp.time);
    u16(local, 12, timestamp.day);
    u32(local, 14, checksum);
    u32(local, 18, data.length);
    u32(local, 22, data.length);
    u16(local, 26, name.length);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    u32(central, 0, 0x02014b50);
    u16(central, 4, 20);
    u16(central, 6, 20);
    u16(central, 8, 0x0800);
    u16(central, 10, 0);
    u16(central, 12, timestamp.time);
    u16(central, 14, timestamp.day);
    u32(central, 16, checksum);
    u32(central, 20, data.length);
    u32(central, 24, data.length);
    u16(central, 28, name.length);
    u32(central, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
    count += 1;
  }

  const central = concat(centralParts);
  const end = new Uint8Array(22);
  u32(end, 0, 0x06054b50);
  u16(end, 8, count);
  u16(end, 10, count);
  u32(end, 12, central.length);
  u32(end, 16, localOffset);
  return concat([...localParts, central, end]);
}

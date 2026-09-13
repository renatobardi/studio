/**
 * A real, decodable PNG of an exact byte size, for tests that must exercise photos of
 * representative sizes rather than a handful of bytes (#48). Pixels are random noise stored
 * uncompressed, so the size is predictable; a private ancillary chunk (which every decoder
 * skips) makes up the last few bytes. No Node or DOM dependency — it runs in bun and in
 * Playwright's Node process alike.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib stream made of uncompressed ("stored") deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 0xffff));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  const view = new DataView(out.buffer);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const piece = raw.subarray(i * 0xffff, (i + 1) * 0xffff);
    out[at] = i === blocks - 1 ? 1 : 0;
    view.setUint16(at + 1, piece.length, true);
    view.setUint16(at + 3, ~piece.length & 0xffff, true);
    out.set(piece, at + 5);
    at += 5 + piece.length;
  }
  view.setUint32(at, adler32(raw));
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
  return bytes;
}

export function makePng(targetBytes: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Leave room for headers and the padding chunk; each stored block costs 5 bytes.
  const side = Math.max(1, Math.floor(Math.sqrt(Math.max(0, targetBytes * 0.9 - 200) / 3)));
  const raw = new Uint8Array((side * 3 + 1) * side);
  const noise = randomBytes(side * side * 3);
  for (let y = 0; y < side; y++) raw.set(noise.subarray(y * side * 3, (y + 1) * side * 3), y * (side * 3 + 1) + 1);

  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, side);
  new DataView(ihdr.buffer).setUint32(4, side);
  ihdr.set([8, 2, 0, 0, 0], 8);

  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlibStored(raw))];
  const iend = chunk("IEND", new Uint8Array(0));
  const used = parts.reduce((sum, part) => sum + part.length, 0) + iend.length;
  const padding = targetBytes - used - 12;
  if (padding < 0) throw new Error(`a ${targetBytes}-byte PNG is too small to build`);
  parts.push(chunk("paDd", new Uint8Array(padding)), iend);

  const png = new Uint8Array(targetBytes);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

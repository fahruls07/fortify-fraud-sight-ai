import { inflateRawSync } from "node:zlib";

// Minimal ZIP writer (stored, no compression) and reader (stored + deflate). Enough for rule packages; no dependency.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function makeZip(files: { name: string; data: Buffer }[]) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), crc = crc32(f.data), n = f.data.length;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(n, 18); h.writeUInt32LE(n, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(n, 20); c.writeUInt32LE(n, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, name, f.data); central.push(c, name);
    off += 30 + name.length + n;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

const MAX_ENTRY = 2 * 1024 * 1024;
// Reads via the central directory. Throws on anything unexpected (encrypted, zip64, oversize, bad CRC).
export function readZip(buf: Buffer): Map<string, Buffer> {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Not a ZIP file.");
  const count = buf.readUInt16LE(e + 10);
  if (count > 500) throw new Error("ZIP has too many files.");
  const out = new Map<string, Buffer>();
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt ZIP directory.");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), raw = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("Encrypted ZIP files are not supported.");
    if (raw > MAX_ENTRY) throw new Error(`${name} is too large.`);
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body, { maxOutputLength: MAX_ENTRY }) : null;
    if (!data) throw new Error(`${name}: unsupported compression.`);
    if (crc32(data) !== crc) throw new Error(`${name}: checksum mismatch.`);
    out.set(name.replace(/^\.\//, ""), data);
  }
  return out;
}

import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

/**
 * Tiny inline ZIP writer (DEFLATE + STORE fallback) — produces a valid
 * .zip archive without pulling in a dependency. Sufficient for the
 * single-file (or handful of files) GDPR export bundle. Conforms to
 * APPNOTE.TXT v6.3.4 Section 4 (local file header + central directory
 * + EOCD record).
 */
export interface ZipEntry {
  /** Path inside the archive. */
  name: string;
  /** File contents (text or binary). */
  data: Buffer | string;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const crc = crc32(raw);

    let method = 8; // DEFLATE
    let compressed: Buffer;
    try {
      compressed = deflateRawSync(raw);
      if (compressed.length >= raw.length) {
        method = 0;
        compressed = raw;
      }
    } catch {
      method = 0;
      compressed = raw;
    }

    // Local file header (offset 0, 30 bytes + name)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);     // signature
    local.writeUInt16LE(20, 4);             // version needed
    local.writeUInt16LE(0, 6);              // flags
    local.writeUInt16LE(method, 8);         // compression
    local.writeUInt16LE(0, 10);             // mod time
    local.writeUInt16LE(0, 12);             // mod date
    local.writeUInt32LE(crc, 14);           // crc-32
    local.writeUInt32LE(compressed.length, 18); // compressed size
    local.writeUInt32LE(raw.length, 22);    // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);             // extra length
    localChunks.push(local, nameBuf, compressed);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);   // signature
    central.writeUInt16LE(20, 4);           // version made by
    central.writeUInt16LE(20, 6);           // version needed
    central.writeUInt16LE(0, 8);            // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);           // extra length
    central.writeUInt16LE(0, 32);           // comment length
    central.writeUInt16LE(0, 34);           // disk number
    central.writeUInt16LE(0, 36);           // internal attrs
    central.writeUInt32LE(0, 38);           // external attrs
    central.writeUInt32LE(offset, 42);      // local header offset
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const central = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                 // disk number
  eocd.writeUInt16LE(0, 6);                 // disk with cd
  eocd.writeUInt16LE(entries.length, 8);    // cd entries on this disk
  eocd.writeUInt16LE(entries.length, 10);   // total cd entries
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);           // cd offset
  eocd.writeUInt16LE(0, 20);                // comment length

  return Buffer.concat([...localChunks, central, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Hex sha256 of a buffer — used to checksum bundles. */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

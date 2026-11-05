/** Minimal in-memory ZIP reader. No filesystem extraction, ZIP64, encryption or multipart archives. */
import { crc32, inflateRawSync } from 'node:zlib';

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/** Central-directory sizes also support entries whose local header uses a data descriptor. */
export function extractJsonFromZip(zip: Buffer): Buffer {
  const fail = (message: string): never => {
    throw new Error(`Invalid ZIP: ${message}`);
  };
  const range = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > zip.length) fail('truncated archive');
  };
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('missing end of central directory');
  const count = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  const directoryOffset = zip.readUInt32LE(end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) fail('ZIP64 unsupported');
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== count)
    fail('multipart archives unsupported');
  if (directoryOffset + directorySize !== end) fail('invalid central directory bounds');
  range(directoryOffset, directorySize);
  const entries: Entry[] = [];
  let cursor = directoryOffset;
  for (let i = 0; i < count; i++) {
    range(cursor, 46);
    if (zip.readUInt32LE(cursor) !== 0x02014b50) fail('invalid central directory entry');
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const length = 46 + nameLength + extraLength + commentLength;
    range(cursor, length);
    if (zip.readUInt16LE(cursor + 34)) fail('multipart entry unsupported');
    const entry: Entry = {
      name: zip.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      flags: zip.readUInt16LE(cursor + 8),
      method: zip.readUInt16LE(cursor + 10),
      crc: zip.readUInt32LE(cursor + 16),
      compressed: zip.readUInt32LE(cursor + 20),
      size: zip.readUInt32LE(cursor + 24),
      offset: zip.readUInt32LE(cursor + 42),
    };
    if ([entry.compressed, entry.size, entry.offset].includes(0xffffffff)) fail('ZIP64 entry unsupported');
    entries.push(entry);
    cursor += length;
  }
  if (cursor !== directoryOffset + directorySize) fail('central directory size mismatch');
  const preferred = entries.filter((entry) => entry.name.split('/').at(-1) === 'combined.json');
  const candidates = preferred.length ? preferred : entries.filter((entry) => /\.(?:geojson|json)$/i.test(entry.name));
  if (candidates.length !== 1) fail('expected combined.json or a single JSON/GeoJSON entry');
  const entry = candidates[0];
  if (entry.flags & 0x41) fail('encrypted entry unsupported');
  if (entry.method !== 0 && entry.method !== 8) fail(`unsupported compression method ${entry.method}`);
  // The pinned file expands to 173 MB; cap decompression to avoid accidental resource exhaustion.
  if (entry.size > 256 * 1024 * 1024) fail('JSON entry exceeds 256 MiB');
  range(entry.offset, 30);
  if (zip.readUInt32LE(entry.offset) !== 0x04034b50) fail('missing local header');
  if (zip.readUInt16LE(entry.offset + 6) !== entry.flags || zip.readUInt16LE(entry.offset + 8) !== entry.method)
    fail('local header mismatch');
  const localNameLength = zip.readUInt16LE(entry.offset + 26);
  const dataOffset = entry.offset + 30 + localNameLength + zip.readUInt16LE(entry.offset + 28);
  range(entry.offset + 30, localNameLength);
  if (zip.toString('utf8', entry.offset + 30, entry.offset + 30 + localNameLength) !== entry.name)
    fail('local filename mismatch');
  range(dataOffset, entry.compressed);
  if (dataOffset + entry.compressed > directoryOffset) fail('entry overlaps central directory');
  const compressed = zip.subarray(dataOffset, dataOffset + entry.compressed);
  const output = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.size || 1 });
  if (output.length !== entry.size) fail('uncompressed size mismatch');
  if (crc32(output) !== entry.crc) fail('CRC-32 mismatch');
  return output;
}

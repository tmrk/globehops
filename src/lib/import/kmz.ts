import { ImportFailure, invalid, MAX_TEXT_BYTES } from './common.ts';
/** Bounded ZIP central-directory reader. ZIP64, encryption and multi-disk archives are deliberately unsupported. */
export async function extractKml(bytes: Uint8Array): Promise<string> {
  if (bytes.length < 22) invalid('Truncated KMZ archive');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) invalid('Missing ZIP central directory');
  if (
    view.getUint16(eocd + 4, true) ||
    view.getUint16(eocd + 6, true) ||
    view.getUint16(eocd + 8, true) !== view.getUint16(eocd + 10, true)
  )
    throw new ImportFailure('unsupported', 'Multi-disk KMZ archives are unsupported.');
  const entries = view.getUint16(eocd + 10, true),
    size = view.getUint32(eocd + 12, true),
    offset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff)
    throw new ImportFailure('unsupported', 'ZIP64 KMZ archives are unsupported.');
  if (offset + size > eocd) invalid('Invalid ZIP central directory bounds');
  const decoder = new TextDecoder();
  let selected: {
    offset: number;
    compressed: number;
    uncompressed: number;
    method: number;
    flags: number;
    crc: number;
    name: string;
  } | null = null;
  let pos = offset;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > offset + size || view.getUint32(pos, true) !== 0x02014b50) invalid('Invalid ZIP directory entry');
    const nameLength = view.getUint16(pos + 28, true),
      extra = view.getUint16(pos + 30, true),
      comment = view.getUint16(pos + 32, true);
    if (pos + 46 + nameLength + extra + comment > offset + size) invalid('Truncated ZIP directory entry');
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (
      /\.kml$/i.test(name) &&
      (!selected || (/(^|\/)doc\.kml$/i.test(name) && !/(^|\/)doc\.kml$/i.test(selected.name)))
    ) {
      selected = {
        name,
        offset: view.getUint32(pos + 42, true),
        compressed: view.getUint32(pos + 20, true),
        uncompressed: view.getUint32(pos + 24, true),
        method: view.getUint16(pos + 10, true),
        flags: view.getUint16(pos + 8, true),
        crc: view.getUint32(pos + 16, true),
      };
    }
    pos += 46 + nameLength + extra + comment;
  }
  if (!selected) throw new ImportFailure('no_path', 'This KMZ archive contains no KML file.');
  const s = selected;
  if (s.uncompressed > MAX_TEXT_BYTES) throw new ImportFailure('too_large', 'Expanded KML exceeds 20 MB.');
  if (s.flags & 1) throw new ImportFailure('unsupported', 'Encrypted KMZ archives are unsupported.');
  if (s.offset + 30 > offset || view.getUint32(s.offset, true) !== 0x04034b50) invalid('Invalid ZIP local entry');
  const start = s.offset + 30 + view.getUint16(s.offset + 26, true) + view.getUint16(s.offset + 28, true);
  if (start + s.compressed > offset) invalid('Truncated ZIP file');
  const compressed = bytes.slice(start, start + s.compressed);
  let output: Uint8Array;
  if (s.method === 0) output = compressed;
  else if (s.method === 8) {
    if (typeof DecompressionStream === 'undefined')
      throw new ImportFailure('unsupported', 'This runtime cannot decompress KMZ files.');
    let stream: DecompressionStream;
    try {
      stream = new DecompressionStream('deflate-raw');
    } catch {
      throw new ImportFailure('unsupported', 'This runtime does not support raw DEFLATE for KMZ.');
    }
    const reader = new Blob([compressed]).stream().pipeThrough(stream).getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > MAX_TEXT_BYTES || length > s.uncompressed) {
          await reader.cancel();
          throw new ImportFailure('too_large', 'Expanded KML exceeds its size limit.');
        }
        chunks.push(next.value);
      }
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
      invalid('Corrupt compressed KML');
    }
    output = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) {
      output.set(chunk, cursor);
      cursor += chunk.length;
    }
  } else
    throw new ImportFailure('unsupported', `ZIP compression method ${s.method} is unsupported.`, { method: s.method });
  if (output.length !== s.uncompressed) invalid('KML size differs from ZIP directory');
  if (crc32(output) !== s.crc) invalid('KML checksum differs from ZIP directory');
  return decoder.decode(output);
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

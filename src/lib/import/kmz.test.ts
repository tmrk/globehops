import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { importRoute } from './index.ts';
import { context } from './testContext.ts';
const kml =
  '<kml><Placemark><LineString><coordinates>-0.45,51.47,10 -73.78,40.64,20</coordinates></LineString></Placemark></kml>';
const encoder = new TextEncoder();
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
/** Tiny real ZIP fixture writer: tests the reader against local headers and central metadata independently. */
function zip(entries: { name: string; text: string; method?: number; flags?: number; size?: number }[]): Uint8Array {
  const locals: Uint8Array[] = [],
    centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name),
      text = encoder.encode(entry.text),
      method = entry.method ?? 0;
    const data = method === 8 ? new Uint8Array(deflateRawSync(text)) : text;
    const local = new Uint8Array(30 + name.length + data.length),
      lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, entry.flags ?? 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc32(text), true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, entry.size ?? text.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length),
      cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, entry.flags ?? 0, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc32(text), true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, entry.size ?? text.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}
describe('bounded KMZ extraction', () => {
  it.each([0, 8])('reads stored/deflated ZIP method %i and prefers doc.kml', async (method) => {
    const data = zip([
      { name: 'other.kml', text: '<kml/>' },
      { name: 'icons/file.txt', text: 'ignored' },
      { name: 'folder/doc.kml', text: kml, method },
    ]);
    const r = await importRoute(data, context);
    expect(r.ok).toBe(true);
    expect(r.format).toBe('kmz');
    expect(r.flights[0].track.points.map((p) => p.altM)).toEqual([10, 20]);
  });
  it('falls back to the first KML and never extracts assets to the filesystem', async () => {
    const r = await importRoute(
      zip([
        { name: '../../assets.txt', text: 'irrelevant' },
        { name: 'myflight.KML', text: kml },
      ]),
      context,
      { fileName: 'flight.kmz' },
    );
    expect(r.ok).toBe(true);
    expect(r.flights[0].track.source).toEqual({ format: 'kmz', name: 'flight.kmz' });
  });
  it('reports missing KML, text pretending to be KMZ and malformed archives', async () => {
    expect((await importRoute(zip([{ name: 'file.txt', text: 'test' }]), context)).error?.code).toBe('no_path');
    expect((await importRoute(kml, context, { fileName: 'x.kmz' })).error?.code).toBe('invalid');
    const bytes = zip([{ name: 'doc.kml', text: kml }]);
    expect((await importRoute(bytes.subarray(0, bytes.length - 10), context)).error?.code).toBe('invalid');
    bytes[50] ^= 1;
    expect((await importRoute(bytes, context)).error?.code).toBe('invalid');
  });
  it('detects unsupported encryption and compression methods', async () => {
    expect((await importRoute(zip([{ name: 'doc.kml', text: kml, flags: 1 }]), context)).error?.code).toBe(
      'unsupported',
    );
    expect((await importRoute(zip([{ name: 'doc.kml', text: kml, method: 12 }]), context)).error?.code).toBe(
      'unsupported',
    );
  });
  it('feature-detects raw DEFLATE but keeps stored archives usable', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      expect((await importRoute(zip([{ name: 'doc.kml', text: kml, method: 8 }]), context)).error?.code).toBe(
        'unsupported',
      );
      expect((await importRoute(zip([{ name: 'doc.kml', text: kml }]), context)).ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('rejects ZIP bombs by both declared size and bounded actual decompression', async () => {
    expect(
      (await importRoute(zip([{ name: 'doc.kml', text: kml, size: 21 * 1024 * 1024 }]), context)).error?.code,
    ).toBe('too_large');
    expect(
      (await importRoute(zip([{ name: 'doc.kml', text: kml.repeat(1000), size: 1, method: 8 }]), context)).error?.code,
    ).toBe('too_large');
  });
  it('rejects corrupt central-directory bounds', async () => {
    const bytes = zip([{ name: 'doc.kml', text: kml }]);
    new DataView(bytes.buffer).setUint32(bytes.length - 6, 0xfffffff0, true);
    expect((await importRoute(bytes, context)).error?.code).toBe('invalid');
  });
});

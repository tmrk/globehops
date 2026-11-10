import { descendants, value, type XmlNode } from './xml.ts';
import type { ParsedDocument } from './types.ts';
import type { ParseState } from './common.ts';
import type { TrackPoint } from '../track.ts';

export function parseGpx(root: XmlNode, state: ParseState): ParsedDocument {
  const tracks = descendants(root, ['trk', 'rte'], true);
  const readPoint = (node: XmlNode): TrackPoint | null =>
    state.point(node.attrs.lat, node.attrs.lon, value(node, 'ele'), value(node, 'time'), value(node, 'name'));
  const paths = tracks.map((track) => {
    const points: TrackPoint[] = [];
    for (const node of descendants(track, track.tag === 'trk' ? ['trkpt'] : ['rtept'])) {
      const point = readPoint(node);
      if (point) points.push(point);
    }
    return {
      points,
      name: value(track, 'name'),
      description: value(track, 'desc'),
      ...(track.tag === 'rte' ? { kind: 'planned' as const } : {}),
    };
  });
  if (!tracks.length) {
    const points: TrackPoint[] = [];
    for (const node of descendants(root, ['wpt'])) {
      const point = readPoint(node);
      if (point) points.push(point);
    }
    paths.push({ points, name: value(root, 'name'), description: value(root, 'desc'), kind: 'planned' });
  }
  const metadata = root.children.find((n) => n.tag === 'metadata');
  return { paths, name: metadata ? value(metadata, 'name') : paths[0]?.name };
}

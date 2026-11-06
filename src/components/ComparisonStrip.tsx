import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ComparedJourney } from '../lib/compare.ts';
import { comparisonSegments } from '../lib/compareView.ts';

export function ComparisonStrip({
  entry,
  list,
  range,
}: {
  entry: ComparedJourney;
  list: ComparedJourney[];
  range?: { start: number; end: number } | null;
}) {
  const segments = useMemo(() => comparisonSegments(entry, list, range), [entry, list, range]);
  return (
    <span className="comparison-strip" style={{ '--journey-color': entry.color } as CSSProperties} aria-hidden="true">
      {segments.map((segment, i) => (
        <span
          key={i}
          className={`comparison-strip__${segment.kind}`}
          style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        />
      ))}
    </span>
  );
}

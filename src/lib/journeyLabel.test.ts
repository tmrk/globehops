import { describe, expect, it } from 'vitest';
import { MAX_LABEL_LENGTH, normalizeJourneyLabel } from './journeyLabel.ts';
import { validateItineraryDocument } from '../agent/itinerary.ts';
import { parseLink, serializeLink } from '../state/link.ts';

describe('journey labels', () => {
  it('trims padding and measures Unicode code points', () => {
    expect(normalizeJourneyLabel('  Via London  ')).toBe('Via London');
    expect(normalizeJourneyLabel('🌍'.repeat(MAX_LABEL_LENGTH))).toBe('🌍'.repeat(MAX_LABEL_LENGTH));
    expect(normalizeJourneyLabel('🌍'.repeat(MAX_LABEL_LENGTH + 1))).toBeNull();
  });

  it.each(['', ' ', '\u00a0', '\uFEFF', '\tVia London', 'Via London\n', 'a\u007fb', 'a\u0085b'])(
    'rejects empty or control-containing labels: %j',
    (label) => {
      expect(normalizeJourneyLabel(label)).toBeNull();
      expect(parseLink(`?label=${encodeURIComponent(label)}`).issues).toEqual(['Invalid label value in this link.']);
      expect(() => serializeLink([], {}, false, { label })).toThrow(TypeError);
      expect(validateItineraryDocument({ version: 1, journeys: [{ label, stops: [{ airport: 'CPH' }] }] }).ok).toBe(
        false,
      );
    },
  );

  it('preserves schema length on untrimmed documents and trimmed length on readable links', () => {
    const label = ` ${'x'.repeat(MAX_LABEL_LENGTH)} `;
    expect(parseLink(`?label=${encodeURIComponent(label)}`).label).toBe(label.trim());
    expect(serializeLink([], {}, false, { label })).toBe(`?label=${label.trim()}`);
    expect(validateItineraryDocument({ version: 1, journeys: [{ label, stops: [{ airport: 'CPH' }] }] }).ok).toBe(
      false,
    );
  });
});

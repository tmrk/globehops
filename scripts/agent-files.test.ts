import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { generateAgentFiles } from './build-agent-files.ts';
import { ITINERARY_SCHEMA } from '../src/agent/schema.ts';
import { documentToLinkState, type ItineraryDocument } from '../src/agent/itinerary.ts';
import { parseLink } from '../src/state/link.ts';
const files = await generateAgentFiles();
interface Example {
  title: string;
  itinerary: ItineraryDocument;
  url: string;
  itineraryParamUrl: string;
  expected: { valid: boolean };
}
const examples = JSON.parse(files['examples.json']) as Example[];
const validate = new Ajv2020().compile(ITINERARY_SCHEMA);
describe('committed agent discovery', () => {
  it.each(Object.entries(files))('%s is deterministic and current', async (name, content) => {
    expect(readFileSync(new URL(`../public/agent/${name}`, import.meta.url), 'utf8')).toBe(content);
    expect((await generateAgentFiles())[name]).toBe(content);
  });
  it('has all eight complete examples including a previous-local-day arrival', () => {
    expect(examples.length).toBeGreaterThanOrEqual(8);
    const line = examples.find((e) => e.title === 'Crossing the date line')!;
    expect(line.itinerary.stops![1].arrival!.slice(0, 10) < line.itinerary.stops![0].departure!.slice(0, 10)).toBe(
      true,
    );
  });
  it.each(examples)('$title validates and both links round-trip to the same itinerary state', (example) => {
    expect(validate(example.itinerary), JSON.stringify(validate.errors)).toBe(true);
    expect(example.expected.valid).toBe(true);
    const expected = documentToLinkState(example.itinerary);
    expect(parseLink(new URL(example.url).search, new URL(example.url).pathname)).toEqual(
      expected.stops?.some((s) => s.track)
        ? {
            ...expected,
            stops: expected.stops.map((s) =>
              s.track ? { ...s, track: { ...s.track, source: { ...s.track.source, name: null } } } : s,
            ),
          }
        : expected,
    );
    expect(parseLink(new URL(example.itineraryParamUrl).search, new URL(example.itineraryParamUrl).pathname)).toEqual(
      expected,
    );
  });
});

it('parses the booking-to-link example with every outbound and return stop', () => {
  const guide = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
  const example = guide
    .split('Example – out via Frankfurt on 1 December, back nonstop on 10 December:\n')[1]
    ?.split('\n')[0];
  expect(example).toBeDefined();
  const link = parseLink(new URL(example!).search);
  expect(link.issues).toEqual([]);
  expect(link.stops).toHaveLength(3);
  expect(link.sections?.[0].stops).toHaveLength(2);
});

it('parses the named travellers example as two named round trips', () => {
  const guide = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
  const example = guide
    .split('Example – Anna from London and Ben from New York meet in Tokyo and fly home a week later:\n')[1]
    ?.split('\n')[0];
  expect(example).toBeDefined();
  const link = parseLink(new URL(example!).search);
  expect(link.issues).toEqual([]);
  expect(link.label).toBe('Anna');
  expect(link.sections?.map((section) => section.stops.map((stop) => stop.code))).toEqual([['HND', 'LHR']]);
  expect(link.compare?.map(({ label, sections }) => [label, sections?.length])).toEqual([['Ben', 1]]);
});

it('publishes worked planned and recorded paths and their point limit', () => {
  const tracks = examples.flatMap((e) => e.itinerary.stops?.flatMap((s) => (s.track ? [s.track] : [])) ?? []);
  expect(tracks.map((t) => t.kind)).toEqual(expect.arrayContaining(['planned', 'recorded']));
  expect(JSON.parse(files['capabilities.json']).limits.trackPoints).toBe(20000);
});

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
    expect(parseLink(new URL(example.url).search, new URL(example.url).pathname)).toEqual(expected);
    expect(parseLink(new URL(example.itineraryParamUrl).search, new URL(example.itineraryParamUrl).pathname)).toEqual(
      expected,
    );
  });
});

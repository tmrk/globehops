import { readFileSync } from 'node:fs';
import { decodeDataset } from '../src/data/airports.ts';
import { decodeTimeZones } from '../src/data/timezones.ts';
import { createAgentContext } from '../src/agent/plan.ts';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
/** Module-relative paths allow launching the server from any working directory. */
export function loadContext(baseUrl = process.env.GLOBEHOPS_BASE_URL) {
  return createAgentContext({
    airports: decodeDataset(read('../src/data/generated/airports.json')),
    timezones: decodeTimeZones(read('../src/data/generated/timezones.json')),
    baseUrl,
  });
}
export const context = loadContext();

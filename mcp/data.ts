import { decodeNavaids } from '../src/data/navaids.ts';
import { readFileSync } from 'node:fs';
import { decodeDataset } from '../src/data/airports.ts';
import { decodeTimeZones } from '../src/data/timezones.ts';
import { createAgentContext } from '../src/agent/plan.ts';
import { decodeAirspace } from '../src/data/airspace.ts';
import { decodeDiversionAirports } from '../src/data/diversion.ts';
import { createRouter } from '../src/lib/router.ts';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
/** Module-relative paths allow launching the server from any working directory. */
function loadContext(baseUrl = process.env.GLOBEHOPS_BASE_URL) {
  return createAgentContext({
    airports: decodeDataset(read('../src/data/generated/airports.json')),
    timezones: decodeTimeZones(read('../src/data/generated/timezones.json')),
    baseUrl,
    navaids: decodeNavaids(read('../src/data/generated/navaids.json')),
    // Used only when a request opts into routing; results stay great circles otherwise.
    router: createRouter({
      airspace: decodeAirspace(read('../src/data/generated/airspace.json')),
      diversion: decodeDiversionAirports(read('../src/data/generated/diversion-airports.json')),
    }),
  });
}
export const context = loadContext();

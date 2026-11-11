import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('real stdio MCP server', () => {
  it('negotiates, lists tools and calls every tool from a different cwd', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./server.ts', import.meta.url))],
      cwd: tmpdir(),
      stderr: 'pipe',
      env: { ...process.env, GLOBEHOPS_BASE_URL: 'https://example.com/globe/' } as Record<string, string>,
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: 'globehops-integration-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toEqual({
        name: 'globehops',
        version: (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
          .version,
      });
      const list = await client.listTools();
      expect(list.tools.map((t) => t.name).sort()).toEqual([
        'calculate_route',
        'compare_journeys',
        'get_journey_timeline',
        'import_route',
        'search_airports',
        'validate_itinerary',
        'visualize_route',
      ]);
      for (const tool of list.tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.outputSchema).toBeDefined();
        expect(tool.title).toMatch(/^[A-Z]/);
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
      const calls = [
        ['import_route', { text: 'EGLL CPT KJFK' }],
        ['compare_journeys', { journeys: [{ route: 'CPH-JFK' }, { route: 'CPH-LHR-JFK' }] }],
        ['search_airports', { query: 'CPH', limit: 1 }],
        ['calculate_route', { route: 'CPH-LHR_180-JFK' }],
        ['validate_itinerary', { route: 'CPH-JFK' }],
        ['visualize_route', { route: 'CPH-JFK' }],
        ['get_journey_timeline', { route: 'CPH-JFK', samples: 3, assumeDeparture: '2026-11-20T08:00Z' }],
      ] as const;
      for (const [name, args] of calls) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent).toBeDefined();
        if (name === 'visualize_route')
          expect((result.structuredContent as Record<string, unknown>).url).toBe(
            'https://example.com/globe/?route=CPH-JFK',
          );
      }
      const data = (value: Record<string, unknown>) => value.structuredContent as Record<string, unknown>;
      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(4);
      for (const resource of resources.resources) {
        const read = await client.readResource({ uri: resource.uri });
        const content = read.contents[0];
        expect('text' in content).toBe(true);
        if ('text' in content && resource.mimeType === 'application/json')
          expect(() => JSON.parse(content.text)).not.toThrow();
      }
      expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['plan_and_visualize']);
      expect(
        (
          await client.getPrompt({
            name: 'plan_and_visualize',
            arguments: { journey: 'Budapest via London to New York' },
          })
        ).messages[0].content,
      ).toMatchObject({ type: 'text' });
      for (const query of ['São Paulo', 'Sao Paulo', 'Budapest', 'EKCH', 'CPH', '!!!']) {
        const found = await client.callTool({ name: 'search_airports', arguments: { query, limit: 2 } });
        expect(found.isError).not.toBe(true);
        const airports = data(found).airports as { code: string }[];
        if (query === 'CPH' || query === 'EKCH') expect(airports[0].code).toBe('CPH');
        if (query === 'Budapest') expect(airports[0].code).toBe('BUD');
        if (query === '!!!') expect(airports).toEqual([]);
        if (query.includes('Paulo')) expect(airports[0].code).toBe('GRU');
      }
      for (const route of [
        'CPH',
        'CPH-LHR_180-JFK-CPH',
        'AKL-HNL',
        'CPH-LHR-JFK-LAX-HNL-AKL-SYD-SIN-DXB-CPH',
        'EKCH-EGLL',
      ]) {
        const calculated = await client.callTool({ name: 'calculate_route', arguments: { route } });
        expect(calculated.isError, JSON.stringify(calculated)).not.toBe(true);
        if (route === 'CPH') expect(data(calculated).legs).toEqual([]);
        if (route.includes('_180'))
          expect(data(calculated).transfers).toEqual(
            expect.arrayContaining([expect.objectContaining({ airport: 'LHR', minutes: 180 })]),
          );
      }
      for (const [departure, code, isError] of [
        ['2026-11-01T01:30', 'ambiguous_local_time', false],
        ['2026-03-08T02:30', 'nonexistent_local_time', true],
        ['2026-11-01T01:30+01:00', 'offset_mismatch', true],
      ] as const) {
        const validated = await client.callTool({
          name: 'validate_itinerary',
          arguments: { itinerary: { version: 1, stops: [{ airport: 'JFK', departure }, { airport: 'LHR' }] } },
        });
        expect(validated.isError === true).toBe(isError);
        expect(data(validated).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
      }
      const visual = await client.callTool({
        name: 'visualize_route',
        arguments: {
          route: 'CPH-LHR_180-JFK',
          view: {
            lang: 'hu',
            names: true,
            borders: false,
            follow: true,
            leg: 2,
            time: '2026-11-20T10:00Z',
            play: true,
            speed: 1800,
            units: 'mi',
            clock: 'utc',
            dayNight: false,
          },
        },
      });
      expect(visual.isError).not.toBe(true);
      expect(data(visual).url).toContain('/globe/hu/?route=CPH-LHR_180-JFK');
      expect(data(visual).itineraryParamUrl).toContain('/globe/hu/?itinerary=');
      expect(data(visual).humanSummary).toContain('CPH → LHR → JFK');
      for (const [name, args] of [
        ['calculate_route', { route: Array(11).fill('CPH').join('-') }],
        ['validate_itinerary', { itinerary: { version: 2, stops: [] } }],
        ['visualize_route', { route: 'CPH-LHR', view: { leg: 2 } }],
        ['get_journey_timeline', { route: 'CPH-JFK' }],
        ['get_journey_timeline', { route: 'CPH', assumeDeparture: '2026-11-20T10:00Z' }],
        ['get_journey_timeline', { route: 'CPH-JFK', at: ['nonsense'] }],
      ] as const)
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      const bad = await client.callTool({ name: 'calculate_route', arguments: { route: 'CPH-ZZZ-JFK' } });
      expect(bad.isError).toBe(true);
      expect(stderr).toBe('');
    } finally {
      await client.close();
    }
  }, 15000);
});

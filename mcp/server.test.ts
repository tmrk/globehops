import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('real stdio MCP server', () => {
  it('negotiates, lists tools and calls all five from a different cwd', async () => {
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
        'get_journey_timeline',
        'search_airports',
        'validate_itinerary',
        'visualize_route',
      ]);
      for (const tool of list.tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.outputSchema).toBeDefined();
      }
      const calls = [
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
      const bad = await client.callTool({ name: 'calculate_route', arguments: { route: 'CPH-ZZZ-JFK' } });
      expect(bad.isError).toBe(true);
      expect(stderr).toBe('');
    } finally {
      await client.close();
    }
  }, 15000);
});

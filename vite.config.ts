import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import type { DatasetMeta } from './src/data/airports.ts';
import type { TimeZoneMeta } from './src/data/timezones.ts';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://tmrk.github.io/globehops/
// Override with BASE_PATH=/ for other hosts.
const base = process.env.BASE_PATH ?? '/globehops/';

function agentDataset(): Plugin {
  const dataset = () => {
    const airports = JSON.parse(
      readFileSync(new URL('./data/airports-build.json', import.meta.url), 'utf8'),
    ) as DatasetMeta;
    const zones = JSON.parse(readFileSync(new URL('./src/data/generated/timezones.json', import.meta.url), 'utf8')) as {
      meta: TimeZoneMeta;
    };
    return `${JSON.stringify(
      {
        airports: {
          generatedAt: airports.generatedAt,
          upstreamCommit: airports.upstreamCommit,
          counts: airports.counts,
          source: airports.source,
        },
        timeZones: zones.meta,
        timeZoneDatabase: 'https://raw.githubusercontent.com/tmrk/globehops/main/src/data/generated/timezones.json',
      },
      null,
      2,
    )}\n`;
  };
  return {
    name: 'agent-dataset',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'agent/dataset.json', source: dataset() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== `${base}agent/dataset.json` && path !== '/agent/dataset.json') return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(dataset());
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), agentDataset()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'mcp/**/*.test.ts'],
  },
});

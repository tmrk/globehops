import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://tmrk.github.io/globehops/
// Override with BASE_PATH=/ for other hosts.
const base = process.env.BASE_PATH ?? '/globehops/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});

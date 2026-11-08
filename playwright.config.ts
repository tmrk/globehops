import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL runs the suite against an existing deployment (e.g. the live GitHub Pages site)
// instead of a local production preview.
const externalBaseURL = process.env.E2E_BASE_URL;
// E2E_PORT lets several checkouts (e.g. git worktrees) run their own preview server side by side.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // Each page owns a WebGL renderer; bound GPU/memory contention on laptops and CI.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${port}/globehops/`,
    locale: 'en-GB',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: process.env.E2E_SKIP_BUILD
          ? `npx vite preview --port ${port} --strictPort`
          : `npx vite build && npx vite preview --port ${port} --strictPort`,
        url: `http://localhost:${port}/globehops/`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

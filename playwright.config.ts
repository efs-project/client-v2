import { defineConfig, devices } from '@playwright/test';

// Static suite: tests the BUILT artifact (apps/web/dist, or $EFS_DIST) served as plain
// files at the root and under a deep, IPFS-like path prefix. No Vite, no chain.
const DIST = process.env.EFS_DIST ?? 'apps/web/dist';
const ROOT_PORT = Number(process.env.EFS_E2E_ROOT_PORT ?? 41730);
const PREFIX_PORT = Number(process.env.EFS_E2E_PREFIX_PORT ?? 41731);
export const PREFIX = '/ipfs/bafybeigdyrztktx5b5m2y4sogf2hf5uq3k5knv5c5k2pvx7aq5ekhnoyu/deep/path/';

const serve = (port: number, prefix: string) => ({
  command: `node tools/serve/static-serve.ts --dir ${DIST} --port ${port} --prefix ${prefix}`,
  url: `http://127.0.0.1:${port}${prefix}index.html`,
  reuseExistingServer: false,
});

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${ROOT_PORT}/`,
    trace: 'retain-on-failure',
  },
  webServer: [serve(ROOT_PORT, '/'), serve(PREFIX_PORT, PREFIX)],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /@chromium-only/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: /@chromium-only/ },
  ],
});

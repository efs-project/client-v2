// Theme screenshots for James (PM, 2026-11-27): cypher and paper, light and dark, 320 px and
// desktop, a folder view (Guides/: its entries, and on a desktop its README in the Overview) and a
// file preview (getting-started.txt), on `pnpm demo`'s seed with the dev personas, so nothing
// personal shows.
//
// Not a test: skipped unless EFS_SHOTS is set, on a live fixture chain in Chromium:
//   EFS_SHOTS=1 EFS_CHAIN=live pnpm exec playwright test tests/e2e/theme-shots --project=chromium
// The PNGs go to shots/themes/ (gitignored), named <theme>-<mode>-<width>-<view>.png.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect, preview } from './edit-support.ts';
import { row } from './folder-support.ts';
import { press } from './press.ts';
import { booted, openSettings, serveConfig, serveDeployment, TEST_CONFIG } from './support.ts';

test.skip(
  !process.env.EFS_SHOTS || CHAIN_MODE !== 'live',
  'screenshots only: EFS_SHOTS=1 EFS_CHAIN=live',
);

const OUT = fileURLToPath(new URL('../../shots/themes/', import.meta.url));

const SATOSHI = { name: 'Satoshi Nakamoto', address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' };
const HAL = { name: 'Hal Finney', address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' };

/** The test network as `pnpm demo` serves it: a local RPC and its dev accounts' personas. */
const DEMO_CONFIG = {
  ...TEST_CONFIG,
  networks: TEST_CONFIG.networks.map((n) => ({
    ...n,
    rpcs: [{ url: 'http://127.0.0.1:8545/', label: 'Local test chain' }],
    devAccounts: [SATOSHI, HAL],
  })),
};

const THEMES = ['cypher', 'paper'] as const;
const MODES = ['light', 'dark'] as const;
const SIZES = [
  ['desktop', { width: 1440, height: 900 }],
  ['320', { width: 320, height: 720 }],
] as const;

/** Settings → Theme, as a person picks it (kept in the settings record for the next loads). */
async function pickTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await openSettings(page);
  await press(page.locator('wa-select[label="Theme"]'));
  await press(page.locator(`wa-option[value="${theme}"]`));
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\befs-theme-${theme}\\b`));
  await page.keyboard.press('Escape');
  await expect(page.locator('wa-drawer.efs-settings')).not.toHaveAttribute('open');
}

test('theme screenshots: cypher and paper, light and dark, 320 px and desktop @chromium-only', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const chain = await testChain('client-theme-shots', 'Screenshots only, never recorded.');
  try {
    await chain.seedDemo();
    const folder = chain.ids['demo.folder'] as string;
    mkdirSync(OUT, { recursive: true });
    await chain.attach(page);
    await serveConfig(page, DEMO_CONFIG);
    await serveDeployment(page, chain.deployment);
    for (const theme of THEMES) {
      for (const mode of MODES) {
        // The default colour mode follows the system: emulate it.
        await page.emulateMedia({ colorScheme: mode });
        for (const [size, viewport] of SIZES) {
          await page.setViewportSize(viewport);
          await page.goto(`./#/r/testnet/${folder}`);
          await booted(page);
          if (!(await page.locator('html').getAttribute('class'))?.includes(`efs-theme-${theme}`)) {
            await pickTheme(page, theme);
          }
          await expect(page.locator('html')).toHaveClass(new RegExp(`\\bwa-${mode}\\b`));
          // The folder's entries (at phone width a folder link fronts the Entries tab; on a
          // desktop the README Overview, the entries and the Preview sit side by side).
          await expect(row(page, 'getting-started.txt')).toBeVisible();
          await page.screenshot({ path: `${OUT}${theme}-${mode}-${size}-folder.png` });

          await press(row(page, 'getting-started.txt').getByRole('link'));
          await expect(preview(page).locator('.efs-preview-text')).toBeVisible();
          await page.screenshot({ path: `${OUT}${theme}-${mode}-${size}-file.png` });
        }
      }
    }
  } finally {
    await chain.finish();
  }
});

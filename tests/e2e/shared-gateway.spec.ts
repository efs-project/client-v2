// A shared IPFS path gateway (`gateway/ipfs/<cid>/…`) serves every site it hosts from one origin,
// so there the app runs read-only (docs/design/offline-brief.md §2): settings last for the tab,
// nothing is stored, no wallet is touched, and saving points to an isolated copy. The prefix
// server in playwright.config.ts is exactly that shape (`/ipfs/<cid>/deep/path/`, on an IP host).
// Also: the install manifest is linked only on the operator's stable origin (§7).

import { link } from '@efs/sdk';
import { expect, type Page, test } from '@playwright/test';
import { PREFIX } from '../../playwright.config.ts';
import {
  booted,
  openSettings,
  replayRpc,
  serveConfig,
  serveDeployment,
  TEST_CONFIG,
  transcript,
  trapWallet,
  walletTouches,
} from './support.ts';

const AT = `http://127.0.0.1:${process.env.EFS_E2E_PREFIX_PORT ?? 41731}${PREFIX}`;
const html = (page: Page) => page.locator('html');

const stored = (page: Page) =>
  page.evaluate(async () => ({
    databases: 'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [],
    localStorage: localStorage.length,
  }));

test('settings last for the tab on a shared gateway, and nothing is stored', async ({ page }) => {
  await page.goto(`${AT}#/files`);
  await booted(page);
  await openSettings(page);
  await expect(page.locator('[data-section="data"]')).toContainText(
    'served from a shared IPFS gateway',
  );
  await page.locator('wa-select[label="Theme"]').click();
  await page.locator('wa-option[value="paper"]').click();
  await expect(html(page)).toHaveClass(/\befs-theme-paper\b/);
  // Applied for this tab, written nowhere: no settings database, no appearance mirror.
  expect(await stored(page)).toEqual({ databases: [], localStorage: 0 });
  await page.reload();
  await booted(page);
  await expect(html(page)).toHaveClass(/\befs-theme-cypher\b/);
});

test('Connect on a shared gateway explains why saving is off and touches no wallet', async ({
  page,
}) => {
  await trapWallet(page);
  await page.goto(`${AT}#/files`);
  await booted(page);
  await page.locator('efs-wallet wa-button.efs-wallet-button').click();
  const dialog = page.locator('wa-dialog.efs-wallet-dialog');
  await expect(dialog).toContainText("Saving is off on this copy: it's served from a shared");
  // An IP-address host can't carry a subdomain copy, and no copy is configured: no link.
  await expect(dialog.locator('a.efs-shared-isolated')).toHaveCount(0);
  await expect(dialog).toContainText('open this app from its own address');
  expect(await walletTouches(page)).toEqual([]);
});

test("a shared gateway's Preview reads, offers the configured isolated copy instead of Edit, and opens no journal", async ({
  page,
}) => {
  await trapWallet(page);
  await serveConfig(page, { ...TEST_CONFIG, delivery: { isolatedCopy: 'https://efs.example/' } });
  await serveDeployment(page);
  const replay = await replayRpc(page, ['pin-verified', 'open-inline']);
  const { ids } = transcript('open-inline');
  const file = link({ kind: 'object', subject: ids.file as `0x${string}` });
  await page.goto(`${AT}#/r/testnet/${file}`);
  await booted(page);
  const preview = page.locator('efs-files-preview');
  await expect(preview.locator('.efs-preview-text')).toHaveText('Meeting at 10:00.\n');
  await expect(preview.locator('wa-button.efs-edit-start')).toHaveCount(0);
  await expect(preview.locator('a.efs-shared-isolated')).toHaveAttribute(
    'href',
    'https://efs.example/',
  );
  expect(await stored(page)).toEqual({ databases: [], localStorage: 0 });
  expect(await walletTouches(page)).toEqual([]);
  expect(replay.misses).toEqual([]);
});

// Each case gets a fresh page: a config fetched once may be served from the browser's memory
// cache on the next navigation, past the test's route.
test('no delivery config: no install manifest', async ({ page }) => {
  await page.goto('./#/files');
  await booted(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('this origin named as the stable origin: the manifest is linked, with the fixed id', async ({
  page,
  baseURL,
}) => {
  await serveConfig(page, {
    ...TEST_CONFIG,
    delivery: { stableOrigin: new URL(baseURL as string).origin },
  });
  await page.goto('./#/files');
  await booted(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const body = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? '';
    return (await fetch(href)).json();
  });
  expect(body).toMatchObject({ id: './', scope: './', start_url: './' });
});

test('another origin named as the stable origin: no manifest here', async ({ page }) => {
  await serveConfig(page, { ...TEST_CONFIG, delivery: { stableOrigin: 'https://efs.example' } });
  await page.goto('./#/files');
  await booted(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('a shared gateway never links the manifest, even if config names its origin', async ({
  page,
}) => {
  await serveConfig(page, { ...TEST_CONFIG, delivery: { stableOrigin: new URL(AT).origin } });
  await page.goto(`${AT}#/files`);
  await booted(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

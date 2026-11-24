import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { booted, openSettings, serveConfig } from './support.ts';

const indicator = (page: Page) => page.locator('efs-network-indicator');
const rpcList = (page: Page) => page.locator('efs-endpoint-list').first();

async function addEndpoint(page: Page, url: string, label = ''): Promise<void> {
  const list = rpcList(page);
  const urlInput = list.locator('wa-input[name="url"] input');
  await urlInput.fill(url);
  await expect(urlInput).toHaveValue(url);
  await list.locator('wa-input[name="label"] input').fill(label);
  await list.getByRole('button', { name: 'Add' }).click();
}

test('appearance is saved, applied before first paint on reload, and follows the system', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await booted(page);
  await expect(page.locator('html')).toHaveClass(/\bwa-dark\b/);
  await expect(page.locator('html')).toHaveClass(/\befs-theme-cypher\b/);

  await openSettings(page);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveClass(/\bwa-light\b/);
  await page.locator('wa-select[label="Theme"]').click();
  await page.locator('wa-option[value="paper"]').click();
  await expect(page.locator('html')).toHaveClass(/\befs-theme-paper\b/);
  await expect(page.locator('html')).toHaveClass(/\bwa-brand-indigo\b/);

  // Captured when parsing ends, before any module script has run: the classic probe's work.
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        (window as unknown as { __efsFirstClass: string }).__efsFirstClass =
          document.documentElement.className;
      }
    });
  });
  await page.reload();
  await booted(page);
  const first = await page.evaluate(
    () => (window as unknown as { __efsFirstClass: string }).__efsFirstClass,
  );
  expect(first).toMatch(/\bwa-light\b/);
  expect(first).toMatch(/\befs-theme-paper\b/);

  await openSettings(page);
  await page.getByRole('radio', { name: 'System' }).click();
  await expect(page.locator('html')).toHaveClass(/\bwa-dark\b/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/\bwa-light\b/);
});

test('RPC endpoints: add, validate, reorder, disable; the SDK-facing choice follows', async ({
  page,
}) => {
  await serveConfig(page);
  await page.goto('./');
  await booted(page);
  await expect(indicator(page)).toContainText('Testnet');
  await expect(indicator(page)).toContainText('Example RPC');

  await openSettings(page);
  await addEndpoint(page, 'http://rpc.example.org/');
  await expect(rpcList(page).getByRole('alert')).toContainText(
    'Plain http:// is only allowed for a node on this computer',
  );
  await addEndpoint(page, 'https://user:pw@rpc.example.org/');
  await expect(rpcList(page).getByRole('alert')).toContainText('Remove the user name and password');

  await addEndpoint(page, 'http://127.0.0.1:8545', 'My node');
  await expect(rpcList(page).locator('li')).toHaveCount(2);
  await rpcList(page)
    .getByRole('button', { name: /Move\W+My node\W+up/ })
    .click();
  await expect(indicator(page)).toContainText('My node');

  // The choice survives a reload.
  await page.reload();
  await booted(page);
  await expect(indicator(page)).toContainText('My node');

  // With every endpoint off, the File Browser says so and links to the fix.
  await openSettings(page);
  for (const name of ['My node', 'Example RPC']) {
    await rpcList(page).locator('wa-switch', { hasText: name }).click();
  }
  await expect(indicator(page)).toContainText('no endpoint');
  await page.keyboard.press('Escape');
  const main = page.getByRole('main');
  await expect(
    main.getByText('Every RPC endpoint for this network is turned off').first(),
  ).toBeVisible();
  await main.getByRole('button', { name: 'Open network settings' }).first().click();
  await expect(page.locator('[data-section="network"] h3')).toBeFocused();
});

test('a change in one tab reaches the other; a stale save is refused, not merged', async ({
  context,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  // The second tab never hears the first, so it saves from a stale revision.
  await second.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  const third = await context.newPage();
  for (const page of [first, second, third]) {
    await page.goto('./');
    await booted(page);
  }

  await openSettings(first);
  await first.getByRole('radio', { name: 'Light' }).click();
  await expect(first.locator('html')).toHaveClass(/\bwa-light\b/);
  // A listening tab updates by itself.
  await expect(third.locator('html')).toHaveClass(/\bwa-light\b/);

  await openSettings(second);
  await second.getByRole('radio', { name: 'Dark' }).click();
  await expect(second.locator('[data-section="appearance"]').locator('..')).toContainText(
    'changed in another tab',
  );
  // The refused tab now shows the stored (first tab's) settings.
  await expect(second.locator('html')).toHaveClass(/\bwa-light\b/);
});

test('settings export, reset and import round-trip', async ({ page }) => {
  await serveConfig(page);
  await page.goto('./');
  await booted(page);
  await openSettings(page);
  await addEndpoint(page, 'wss://node.example.org/ws', 'Socket');
  await expect(rpcList(page).locator('li')).toHaveCount(2);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('efs-settings.json');
  const exported = readFileSync(await download.path(), 'utf8');
  expect(JSON.parse(exported)).toMatchObject({ schema: 'efs-settings/1' });
  expect(exported).toContain('wss://node.example.org/ws');

  await page.getByRole('button', { name: 'Reset all settings' }).click();
  await page.getByRole('button', { name: 'Reset everything' }).click();
  await expect(rpcList(page).locator('li')).toHaveCount(1);

  await page.locator('efs-settings-panel input[type="file"]').setInputFiles({
    name: 'efs-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  });
  await page.getByRole('button', { name: 'Replace settings' }).click();
  await expect(rpcList(page).locator('li')).toHaveCount(2);
  await expect(rpcList(page)).toContainText('Socket');
});

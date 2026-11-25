import { expect, test } from '@playwright/test';
import {
  booted,
  distFiles,
  recordRequests,
  startupFiles,
  trapWallet,
  walletTouches,
} from './support.ts';

test('guest boot is wallet-free and requests only its own static files', async ({ page }) => {
  await trapWallet(page);
  const requests = recordRequests(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('./');
  await booted(page);
  await expect(page.getByRole('banner')).toContainText('File Browser');

  expect(await walletTouches(page)).toEqual([]);
  const origin = new URL(page.url()).origin;
  const shipped = new Set(['/', ...distFiles().map((f) => `/${f}`)]);
  for (const url of requests) {
    expect(url.origin, url.href).toBe(origin);
    expect(shipped.has(url.pathname), `${url.pathname} is not a shipped file`).toBe(true);
  }
  // The whole startup set is used, plus the operator config and the default app's lazy chunk.
  const paths = new Set(requests.map((u) => u.pathname));
  for (const file of startupFiles()) {
    const path = file === 'index.html' ? '/' : `/${file}`;
    expect(paths.has(path), file).toBe(true);
  }
  expect(paths.has('/efs.config.json')).toBe(true);
  expect([...paths].filter((p) => /^\/assets\/entry-[^/]+\.js$/.test(p))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('the route names the app; unknown apps get an honest message', async ({ page }) => {
  await page.goto('./#/files/some/folder');
  await booted(page);
  await expect(page.getByRole('banner')).toContainText('File Browser');

  await page.evaluate(() => {
    location.hash = '#/no-such-app';
  });
  const main = page.getByRole('main');
  await expect(main).toContainText("This link names an app this client doesn't have");
  await expect(main.locator('code')).toHaveText('no-such-app');
  await main.getByRole('link', { name: 'Open the File Browser' }).click();
  await expect(page.locator('efs-pane-host')).toBeVisible();
  // Home: the default realm's root, or (as here, with no networks) the bare root.
  expect(new URL(page.url()).hash).toBe('#/');
});

test('the skip link moves focus to main without changing the route', async ({
  page,
  browserName,
}) => {
  await page.goto('./#/files/a/b');
  await booted(page);
  // macOS WebKit's Option+Tab path includes links regardless of the system Tab preference.
  const tabKey = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tabKey);
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#efs-main')).toBeFocused();
  expect(new URL(page.url()).hash).toBe('#/files/a/b');
});

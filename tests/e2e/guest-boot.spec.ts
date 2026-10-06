import { expect, test } from '@playwright/test';
import { booted, recordRequests, startupFiles, trapWallet, walletTouches } from './support.ts';

test('guest boot is wallet-free and requests only the static startup set', async ({ page }) => {
  await trapWallet(page);
  const requests = recordRequests(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('./');
  await booted(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('EFS web client');

  expect(await walletTouches(page)).toEqual([]);
  const origin = new URL(page.url()).origin;
  const allowed = new Set(['/', ...startupFiles().map((f) => `/${f}`)]);
  for (const url of requests) {
    expect(url.origin, url.href).toBe(origin);
    expect(allowed.has(url.pathname), `${url.pathname} is outside the startup set`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('an EFS-style link is echoed as unsupported, not interpreted', async ({ page }) => {
  await page.goto('./#/files/some/folder');
  await booted(page);
  await expect(page.locator('main code')).toHaveText('/files/some/folder');
  await page.evaluate(() => {
    location.hash = '#/other';
  });
  await expect(page.locator('main code')).toHaveText('/other');
});

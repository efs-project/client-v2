import { expect, test } from '@playwright/test';
import { PREFIX } from '../../playwright.config.ts';
import { booted, distText } from './support.ts';

const PREFIX_ORIGIN = `http://127.0.0.1:${process.env.EFS_E2E_PREFIX_PORT ?? 41731}`;

test('the same bytes work at the root and under a deep IPFS-like prefix', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  const rootText = await page.locator('efs-shell').innerText();

  const failures: string[] = [];
  const requests: URL[] = [];
  page.on('response', (r) => r.status() >= 400 && failures.push(`${r.status()} ${r.url()}`));
  page.on('request', (r) => requests.push(new URL(r.url())));
  await page.goto(`${PREFIX_ORIGIN}${PREFIX}#/files`);
  await booted(page);
  expect(await page.locator('efs-shell').innerText()).toBe(rootText);
  expect(failures).toEqual([]);
  // Operator config, icon sprite and the lazy app chunk all resolve under the prefix.
  for (const url of requests) expect(url.pathname.startsWith(PREFIX), url.pathname).toBe(true);
  expect(requests.some((u) => u.pathname === `${PREFIX}efs.config.json`)).toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-efs-icons');
});

test('built HTML and CSS contain no root-absolute URLs', () => {
  const html = distText('index.html');
  expect(html).not.toMatch(/\b(?:src|href)="\/(?!\/)/);
  for (const css of html.match(/assets\/[^"]+\.css/g) ?? []) {
    expect(distText(css)).not.toMatch(/url\(\s*['"]?\/(?!\/)/);
  }
});

test('the build ships a default operator config that defines no networks', () => {
  expect(JSON.parse(distText('efs.config.json'))).toEqual({ schema: 'efs-config/1', networks: [] });
});

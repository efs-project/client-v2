import { expect, test } from '@playwright/test';
import { PREFIX } from '../../playwright.config.ts';
import { booted, distText } from './support.ts';

const PREFIX_ORIGIN = `http://127.0.0.1:${process.env.EFS_E2E_PREFIX_PORT ?? 41731}`;

test('the same bytes work at the root and under a deep IPFS-like prefix', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  const rootText = await page.locator('main').innerText();

  const failures: string[] = [];
  page.on('response', (r) => r.status() >= 400 && failures.push(`${r.status()} ${r.url()}`));
  await page.goto(`${PREFIX_ORIGIN}${PREFIX}`);
  await booted(page);
  expect(await page.locator('main').innerText()).toBe(rootText);
  expect(failures).toEqual([]);
});

test('built HTML and CSS contain no root-absolute URLs', () => {
  const html = distText('index.html');
  expect(html).not.toMatch(/\b(?:src|href)="\/(?!\/)/);
  for (const css of html.match(/assets\/[^"]+\.css/g) ?? []) {
    expect(distText(css)).not.toMatch(/url\(\s*['"]?\/(?!\/)/);
  }
});

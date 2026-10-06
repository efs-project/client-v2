import { expect, test } from '@playwright/test';
import { booted, distText } from './support.ts';

const VIEWPORTS = [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1280, 720],
  [2560, 1440],
] as const;

for (const [width, height] of VIEWPORTS) {
  test(`${width}×${height}: no horizontal overflow; container layout adapts`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await booted(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    const main = await page.locator('main').boundingBox();
    const aside = await page.locator('aside').boundingBox();
    if (!main || !aside) throw new Error('layout boxes missing');
    if (width >= 1280) expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
    else expect(aside.y).toBeGreaterThanOrEqual(main.y + main.height - 1);
    await page.screenshot({ path: info.outputPath(`layout-${width}.png`) });
  });
}

test.describe('touch device', () => {
  test.use({ hasTouch: true, isMobile: false, viewport: { width: 390, height: 844 } });
  test('interactive targets are at least 24×24 CSS px (WCAG 2.5.8)', async ({ page }) => {
    await page.goto('./');
    await booted(page);
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    for (const target of await page.locator('a, summary, button').all()) {
      const box = await target.boundingBox();
      if (!box) continue;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
  });
});

test('styles use dynamic viewport units and safe-area insets', () => {
  const css = distText(distText('index.html').match(/assets\/[^"]+\.css/)?.[0] ?? '');
  expect(css).toMatch(/100dvh/);
  expect(css).toMatch(/safe-area-inset/);
});

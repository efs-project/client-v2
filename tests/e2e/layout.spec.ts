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
  test(`${width}×${height}: no horizontal overflow; panes and navigation adapt`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto('./#/files');
    await booted(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    const host = page.locator('efs-pane-host');
    const toggle = page.locator('[data-toggle-nav]');
    if (width >= 1280) {
      // Wide: navigation beside the panes, all three panes side by side.
      await expect(host.locator('wa-split-panel').first()).toBeVisible();
      await expect(host.locator('wa-tab-group')).toHaveCount(0);
      await expect(toggle).toBeHidden();
      const main = await page.getByRole('main').boundingBox();
      const nav = await page.getByRole('navigation', { name: 'App navigation' }).boundingBox();
      if (!main || !nav) throw new Error('layout boxes missing');
      expect(nav.x + nav.width).toBeLessThanOrEqual(main.x + 1);
    } else {
      // Narrow: panes become tabs; navigation moves behind a toggle.
      await expect(host.locator('wa-tab-group')).toBeVisible();
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByRole('navigation', { name: 'App navigation' })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`layout-${width}.png`) });
  });
}

test('narrow panes switch by tab and keep each view mounted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/files');
  await booted(page);
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  const preview = page.getByRole('tabpanel', { name: 'Preview' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Preview' })).toBeAttached();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test.describe('touch device', () => {
  test.use({ hasTouch: true, isMobile: false, viewport: { width: 390, height: 844 } });
  test('interactive targets are at least 24×24 CSS px (WCAG 2.5.8)', async ({ page }) => {
    await page.goto('./#/files');
    await booted(page);
    const targets = page.locator('efs-shell').locator('a, button, wa-button, wa-tab, [role="tab"]');
    for (const target of await targets.all()) {
      if (!(await target.isVisible())) continue;
      // Web Awesome's skip link is visually hidden until focused (then it is full size).
      if (await target.evaluate((e) => e.classList.contains('wa-visually-hidden'))) continue;
      const box = await target.boundingBox();
      if (!box) continue;
      expect(
        box.width,
        await target.evaluate((e) => e.outerHTML.slice(0, 80)),
      ).toBeGreaterThanOrEqual(24);
      expect(
        box.height,
        await target.evaluate((e) => e.outerHTML.slice(0, 80)),
      ).toBeGreaterThanOrEqual(24);
    }
  });
});

test('styles use dynamic viewport units and safe-area insets', () => {
  const css = distText(distText('index.html').match(/assets\/[^"]+\.css/)?.[0] ?? '');
  expect(css).toMatch(/100dvh/);
  expect(css).toMatch(/safe-area-inset/);
});

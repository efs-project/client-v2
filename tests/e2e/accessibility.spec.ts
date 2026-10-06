import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { booted, openDiagnostics } from './support.ts';

test('axe smoke finds no WCAG 2.2 A/AA violations (smoke, not conformance)', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  await openDiagnostics(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('landmarks and a single h1 are present', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('complementary')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('keyboard: skip link, then diagnostics, with visible focus', async ({ page, browserName }) => {
  await page.goto('./');
  await booted(page);
  // macOS WebKit's Option+Tab path includes links regardless of the system Tab preference.
  const tabKey = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tabKey);
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#efs-main')).toBeFocused();
  await page.keyboard.press(tabKey);
  const summary = page.locator('summary');
  await expect(summary).toBeFocused();
  expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('details')).toHaveAttribute('open', '');
});

test('the diagnostics disclosure keeps its native open/closed marker', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  expect(await page.locator('summary').evaluate((el) => getComputedStyle(el).display)).toBe(
    'list-item',
  );
});

test('reflow at 320 CSS px and forced colors / reduced motion render', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./#/a/very/long/route/segment/that/should/wrap/instead/of/scrolling/sideways');
  await booted(page);
  await openDiagnostics(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('forced-colors-320.png'), fullPage: true });
});

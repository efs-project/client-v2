import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { booted, openAbout, serveConfig, settingsButton } from './support.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );

for (const scheme of ['light', 'dark'] as const) {
  test(`axe smoke (${scheme}): shell and settings have no WCAG 2.2 A/AA violations`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await serveConfig(page);
    await page.goto('./#/files');
    await booted(page);
    expect(await axe(page)).toEqual([]);
    await openAbout(page);
    expect(await axe(page)).toEqual([]);
  });
}

test('landmarks and a single h1 are present', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'App navigation' })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('File Browser');
});

test('keyboard: settings open from the header and return focus on Escape', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  const button = page.getByRole('button', { name: 'Settings', exact: true });
  await button.focus();
  const outline = await settingsButton(page).evaluate((el) => {
    const inner = el.shadowRoot?.querySelector('button') ?? el;
    return getComputedStyle(inner).outlineStyle;
  });
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-section="appearance"] h3')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('wa-drawer.efs-settings')).not.toHaveAttribute('open');
  await expect(button).toBeFocused();
});

test('reflow at 320 CSS px, forced colors and reduced motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./#/files/a/very/long/route/segment/that/should/never/scroll/sideways');
  await booted(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await openAbout(page);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('forced-colors-320.png'), fullPage: true });
});

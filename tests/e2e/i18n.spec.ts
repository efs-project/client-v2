import { expect, type Page, test } from '@playwright/test';
import { booted, openAbout } from './support.ts';

/**
 * WebKit maps pseudo-locale tags to real ones (en-XA -> en-US, ar-XB -> ar), so there the
 * test advertises the tag through navigator.languages, as a browser configured for it would.
 */
async function requestLocale(page: Page, browserName: string, tag: string): Promise<void> {
  if (browserName !== 'webkit') return;
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, 'languages', { get: () => [value] });
    Object.defineProperty(navigator, 'language', { get: () => value });
  }, tag);
}

/** Visible light-DOM text in the shell, outside data values (translate="no"). */
function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shell = document.querySelector('efs-shell');
    if (!shell) return out;
    const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[translate="no"]')) continue;
      if (!node.textContent?.trim()) continue;
      if (!parent.checkVisibility()) continue;
      out.push(node.textContent);
    }
    return out;
  });
}

test('source locale sets lang and direction', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test.describe('en-XA pseudo-locale', () => {
  test.use({ locale: 'en-XA' });
  test('every visible UI string comes from the catalog', async ({ page, browserName }) => {
    await requestLocale(page, browserName, 'en-XA');
    await page.goto('./');
    await booted(page);
    await openAbout(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
    const texts = await visibleTexts(page);
    expect(texts.length).toBeGreaterThan(15);
    expect(texts.filter((t) => !t.includes('⟦'))).toEqual([]);
  });
});

test.describe('ar-XB pseudo-locale', () => {
  test.use({ locale: 'ar-XB' });
  test('right-to-left direction and mirrored layout', async ({ page, browserName }) => {
    await requestLocale(page, browserName, 'ar-XB');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('./');
    await booted(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const main = await page.getByRole('main').boundingBox();
    const nav = await page.getByRole('navigation', { name: /./ }).first().boundingBox();
    if (!main || !nav) throw new Error('layout boxes missing');
    // Navigation sits on the inline-start side, which is the right in RTL.
    expect(nav.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
    await openAbout(page);
    const texts = await visibleTexts(page);
    expect(texts.filter((t) => !t.includes('‮'))).toEqual([]);
  });
});

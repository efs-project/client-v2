// Accessibility of the write flow (slice F): keyboard only from Edit to Send, focus never
// dropped, save outcomes announced through the shell's one live region, and axe clean on every
// state (Preview, editor, review dialog, banner) in light and dark. Replays this client's own
// one-approval recording, so the chain and wallet answers are the real ones.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect, preview, reviewDialog, save, start } from './edit-support.ts';

test.skip(CHAIN_MODE !== 'replay', 'replay only: it drives the recorded one-approval save');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );

/** Presses Enter on an element reached by keyboard focus (never a mouse click). */
async function activate(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

for (const scheme of ['light', 'dark'] as const) {
  test(`edit → review → send by keyboard alone; focus kept; outcome announced; axe clean (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const chain = await testChain('client-edit-one-approval', 'replayed for accessibility');
    try {
      await start(page, chain);
      expect(await axe(page), 'Preview').toEqual([]);

      await activate(page, 'wa-button.efs-edit-start');
      const text = page.locator('textarea.efs-edit-text');
      await expect(text).toBeFocused();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Meeting moved to 11:00.\n');
      expect(await axe(page), 'editor').toEqual([]);

      await activate(page, 'wa-button.efs-edit-connect');
      const wallet = page.locator('wa-dialog.efs-wallet-dialog');
      await expect(wallet).toContainText(/Your wallet is on .*Testnet/);
      expect(await axe(page), 'wallet dialog').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(wallet).not.toHaveAttribute('open');

      await activate(page, 'wa-button.efs-edit-review-button');
      const review = reviewDialog(page);
      await expect(review).toHaveAttribute('open', '');
      expect(await axe(page), 'review dialog').toEqual([]);

      await activate(page, 'wa-dialog.efs-edit-review wa-button.efs-review-send');
      await expect(save(page, 'confirming')).toContainText('Saved · confirming');
      // Said once, politely, by the live region that's always in the page.
      await expect(page.locator('.efs-announcer')).toHaveText(/Saved · confirming/);
      // The editor closed: focus is back on Edit, not dropped on the page.
      await expect(preview(page).locator('wa-button.efs-edit-start')).toBeFocused();
      expect(await axe(page), 'banner').toEqual([]);
    } finally {
      await chain.finish();
    }
  });
}

test('more contrast and less transparency are honored @chromium-only', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-contrast', value: 'more' },
      { name: 'prefers-reduced-transparency', value: 'reduce' },
    ],
  });
  await page.goto('./#/files');
  await page.locator('html[data-efs-booted]').waitFor({ state: 'attached' });
  // Resolved colors, read through elements styled by the tokens (CSSOM, allowed by the CSP).
  const resolved = await page.evaluate(() => {
    const read = (property: string, token: string) => {
      const probe = document.createElement('span');
      probe.style.setProperty(property, `var(${token})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      return value;
    };
    return {
      quiet: read('color', '--wa-color-text-quiet'),
      normal: read('color', '--wa-color-text-normal'),
      overlay: read('background-color', '--wa-color-overlay-modal'),
    };
  });
  // More contrast: quiet text is the normal text color.
  expect(resolved.quiet).toBe(resolved.normal);
  // Less transparency: the dialog overlay is solid (no alpha).
  expect(resolved.overlay).not.toMatch(/rgba\(.*,\s*0?\.\d+\)|\/\s*0?\.\d+/);
});

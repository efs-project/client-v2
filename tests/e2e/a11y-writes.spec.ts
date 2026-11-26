// Accessibility of the write flow (slice F): keyboard only from Edit to Send, focus never
// dropped, save outcomes announced through the shell's one live region, and axe clean on every
// state (Preview, editor, review dialog, banner) in light and dark. Replays this client's own
// one-approval recording, so the chain and wallet answers are the real ones.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { appearanceClasses } from '../../apps/web/src/platform/appearance.ts';
import { THEMES } from '../../apps/web/src/platform/settings/model.ts';
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
      // The recorded flow opens the file with the sharer's Lens (edit.spec.ts).
      await start(page, chain, undefined, true);
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

test("the hidden-character pill's outline keeps 3:1 on every surface it sits on @chromium-only", async ({
  page,
}) => {
  // The outline is what tells a pill (ui/visible-text.ts) apart: a non-text indicator, 3:1 under
  // WCAG 1.4.11. Measured on the pill as rendered, on the page, a raised surface (dialogs) and
  // each callout variant, in every theme, both schemes, with and without more contrast.
  const cdp = await page.context().newCDPSession(page);
  const appearances = THEMES.flatMap((theme) =>
    (['light', 'dark'] as const).map((scheme) => ({
      name: `${theme} ${scheme}`,
      classes: appearanceClasses(theme, scheme),
      scheme,
    })),
  );
  const found: string[] = [];
  for (const contrast of ['no-preference', 'more'] as const) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-contrast', value: contrast }],
    });
    await page.goto('./#/files');
    await page.locator('html[data-efs-booted]').waitFor({ state: 'attached' });
    const ratios = await page.evaluate(async (appearances) => {
      // Any CSS color, resolved to opaque sRGB through a canvas.
      const rgb = (css: string): [number, number, number] => {
        const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
        if (!css || a !== 255) throw new Error(`not an opaque color: "${css}"`);
        return [r, g, b];
      };
      const luminance = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a: [number, number, number], b: [number, number, number]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
        return (hi + 0.05) / (lo + 0.05);
      };
      const root = document.documentElement;
      const out: Record<string, number> = {};
      for (const { name, classes, scheme } of appearances) {
        for (const c of [...root.classList]) {
          if (/^(wa-theme-|wa-palette-|wa-brand-|efs-theme-|wa-light$|wa-dark$)/.test(c)) {
            root.classList.remove(c);
          }
        }
        root.classList.add(...classes);
        root.style.colorScheme = scheme;
        const raised = document.createElement('div');
        raised.style.setProperty('background-color', 'var(--wa-color-surface-raised)');
        const surfaces: [string, HTMLElement][] = [
          ['page', document.body],
          ['raised', raised],
          ...['success', 'warning', 'neutral', 'danger', 'brand'].map((variant) => {
            const callout = document.createElement('wa-callout');
            callout.setAttribute('variant', variant);
            return [`${variant} callout`, callout] as [string, HTMLElement];
          }),
        ];
        const added = surfaces.filter(([, el]) => el !== document.body).map(([, el]) => el);
        document.body.append(...added);
        // A callout's light-DOM child has no computed style until its shadow root renders.
        for (const el of added) await (el as { updateComplete?: Promise<unknown> }).updateComplete;
        for (const [where, surface] of surfaces) {
          const pill = document.createElement('span');
          pill.className = 'efs-hidden-char';
          surface.append(pill);
          out[`${name}, ${where}`] = ratio(
            rgb(getComputedStyle(pill).borderTopColor),
            rgb(getComputedStyle(surface).backgroundColor),
          );
          pill.remove();
        }
        for (const el of added) el.remove();
      }
      return out;
    }, appearances);
    for (const [where, value] of Object.entries(ratios)) {
      found.push(where);
      expect(value, `${where}, contrast ${contrast}`).toBeGreaterThanOrEqual(3);
    }
  }
  // Every theme × scheme × surface was measured, twice.
  expect(found).toHaveLength(THEMES.length * 2 * 7 * 2);
});

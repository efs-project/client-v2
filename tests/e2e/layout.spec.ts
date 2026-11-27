import { link } from '@efs/sdk';
import { expect, test } from '@playwright/test';
import { press } from './press.ts';
import {
  booted,
  distText,
  replayRpc,
  serveConfig,
  serveDeployment,
  transcript,
} from './support.ts';

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
      await press(toggle);
      await expect(page.getByRole('navigation', { name: 'App navigation' })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`layout-${width}.png`) });
  });
}

test('375 px: a file link opens on its Preview tab; the person can still switch tabs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await serveConfig(page);
  await serveDeployment(page);
  const replay = await replayRpc(page, ['pin-verified', 'open-inline']);
  const { ids } = transcript('open-inline');
  await page.goto(`./#/r/testnet/${link({ kind: 'object', subject: ids.file as `0x${string}` })}`);
  await booted(page);
  const tab = (name: string) => page.getByRole('tab', { name });
  // Lands on the file, not on Overview: how a shared link first looks on a phone.
  await expect(tab('Preview')).toHaveAttribute('aria-selected', 'true');
  const text = page.locator('efs-files-preview .efs-preview-text');
  await expect(text).toHaveText('Meeting at 10:00.\n');
  await expect(text).toBeVisible();
  // The person's choice stands while the link stays the same.
  await press(tab('Overview'));
  await expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  await expect(text).toBeHidden();
  // Arriving by the link again (back from another route) shows the file again.
  await page.evaluate(() => {
    location.hash = '#/files';
  });
  await expect(text).toHaveCount(0);
  await page.goBack();
  await expect(tab('Preview')).toHaveAttribute('aria-selected', 'true');
  await expect(text).toBeVisible();
  expect(replay.misses).toEqual([]);
});

/**
 * Every pane tab's box, against the tab group's (PM, 2026-11-27: at 320 px "Overview" was cut to
 * "erview" under a scroll button). Fitting, the strip has no scroll buttons, and each tab lies
 * wholly inside the group.
 */
const paneTabs = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const group = document.querySelector('efs-pane-host wa-tab-group') as HTMLElement | null;
    if (!group) return null;
    const box = group.getBoundingClientRect();
    const scrollButtons = [...(group.shadowRoot?.querySelectorAll('.scroll-button') ?? [])].filter(
      (b) => (b as HTMLElement).getBoundingClientRect().width > 0,
    ).length;
    const tabs = [...group.querySelectorAll('wa-tab')].map((tab) => {
      const r = tab.getBoundingClientRect();
      return {
        label: tab.textContent?.trim() ?? '',
        active: tab.hasAttribute('active'),
        inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5,
        width: r.width,
        height: r.height,
      };
    });
    return { scrollButtons, tabs };
  });

for (const width of [320, 1280] as const) {
  test(`${width} px: ${
    width === 320
      ? 'every pane tab fits in view; a file shows its badge, then its contents, then its facts in a closed Details'
      : 'the facts stay beside the verified badge, never folded away'
  }`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await serveConfig(page);
    await serveDeployment(page);
    const replay = await replayRpc(page, ['pin-verified', 'open-inline']);
    const { ids } = transcript('open-inline');
    await page.goto(
      `./#/r/testnet/${link({ kind: 'object', subject: ids.file as `0x${string}` })}`,
    );
    await booted(page);
    const preview = page.locator('efs-files-preview');
    await expect(preview.locator('.efs-preview-text')).toHaveText('Meeting at 10:00.\n');
    const badge = preview.locator('efs-outcome').first();
    const facts = preview.locator('dl.efs-preview-facts');
    const details = preview.locator('details.efs-preview-details');
    if (width === 320) {
      const tabs = await paneTabs(page);
      expect(tabs?.scrollButtons, 'the three tabs fit: no scroll buttons').toBe(0);
      expect(tabs?.tabs.map((t) => t.label)).toEqual(['Overview', 'Entries', 'Preview']);
      for (const tab of tabs?.tabs ?? []) {
        expect(tab.inside, `${tab.label}${tab.active ? ' (active)' : ''}: wholly inside`).toBe(
          true,
        );
        // The narrower padding keeps each tab's hit area at least 24×24 px (WCAG 2.5.8, rule 7).
        expect(Math.min(tab.width, tab.height), `${tab.label}: hit area`).toBeGreaterThanOrEqual(
          24,
        );
      }
      // The badge, then the contents, then the facts, in a closed Details.
      await expect(details).toHaveCount(1);
      await expect(details).not.toHaveAttribute('open');
      await expect(details.locator('summary')).toHaveText('Details');
      await expect(facts).toBeHidden();
      const top = async (l: import('@playwright/test').Locator) =>
        (await l.boundingBox())?.y ?? Number.NaN;
      const text = preview.locator('.efs-preview-text');
      expect(await top(badge)).toBeLessThan(await top(text));
      expect(await top(text)).toBeLessThan(await top(details));
      await press(details.locator('summary'));
      await expect(facts).toBeVisible();
      await expect(facts).toContainText('SHA-256');
    } else {
      // Wide: unchanged, the facts beside the badge and nothing folded away.
      await expect(details).toHaveCount(0);
      await expect(facts).toBeVisible();
    }
    expect(replay.misses).toEqual([]);
  });
}

test('narrow panes switch by tab and keep each view mounted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/files');
  await booted(page);
  await press(page.getByRole('tab', { name: 'Preview' }));
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  const preview = page.getByRole('tabpanel', { name: 'Preview' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Preview' })).toBeAttached();
  await press(page.getByRole('tab', { name: 'Overview' }));
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

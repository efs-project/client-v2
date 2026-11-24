import { expect, type Page, test } from '@playwright/test';
import { booted, recordRegistrations, registrations, settingsButton } from './support.ts';

async function expectFallback(page: Page, message: 'browser' | 'load') {
  const fallback = page.locator('#efs-unsupported');
  await expect(fallback).toBeVisible();
  await expect(page.locator('efs-shell')).toHaveCount(0);
  await expect(page.locator('#efs-boot')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-efs-booted');
  await expect(fallback.locator('.efs-unsupported-browser')).toBeVisible({
    visible: message === 'browser',
  });
  await expect(fallback.locator('.efs-unsupported-load')).toBeVisible({
    visible: message === 'load',
  });
  // Reload goes to this document without its fragment (a fragment-only link would not reload).
  const reload = fallback.getByRole('link', { name: 'Reload' });
  await expect(reload).toBeVisible();
  const href = await reload.evaluate((a) => (a as HTMLAnchorElement).href);
  expect(href).toBe(page.url().split('#')[0]);
}

test('missing a required browser feature shows the static message, not a half-working app', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await recordRegistrations(page);
  await page.addInitScript(() => {
    delete (AbortSignal as { any?: unknown }).any;
  });
  await page.goto('./#/files');
  await expectFallback(page, 'browser');
  await expect(page.locator('html')).toHaveAttribute('data-efs-unsupported', /abortsignal-any/);
  expect(errors).toEqual([]);
  // None of our code runs. Web Awesome defines its own wa-* elements when its modules evaluate
  // (it is startup code since slice A); with no efs-* element nothing renders them.
  expect((await registrations(page)).filter((n) => !n.startsWith('wa-'))).toEqual([]);
  await expect(page.locator('efs-shell, wa-page')).toHaveCount(0);
});

test('no custom elements support shows the static message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'customElements', { value: undefined, configurable: true });
  });
  await page.goto('./');
  await expectFallback(page, 'browser');
  // Web Awesome's module evaluation calls customElements.define and throws; the probe has
  // already shown the message, and nothing else runs.
  expect(errors.filter((e) => !/define/.test(e))).toEqual([]);
});

test('a startup module that fails to parse shows the static message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'export const = ;' }),
  );
  await page.goto('./');
  await expectFallback(page, 'load');
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/syntax|unexpected|parse|missing variable name/i);
});

test('a startup module that fails to load shows the static message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort());
  await page.goto('./');
  await expectFallback(page, 'load');
  expect(errors).toEqual([]);
});

test('a blocked stylesheet (Web Awesome and app styles) shows the static message', async ({
  page,
}) => {
  await page.route(/\/assets\/index-[^/]+\.css$/, (route) => route.abort());
  await page.goto('./#/files');
  await expectFallback(page, 'load');
});

test('a blocked icon sprite turns icon-only controls into labelled text', async ({ page }) => {
  await page.route(/\/icons\/efs-icons\.svg$/, (route) => route.abort());
  await page.goto('./');
  await booted(page);
  await expect(page.locator('html')).toHaveAttribute('data-efs-icons', 'missing');
  const settings = settingsButton(page);
  await expect(settings).toBeVisible();
  await expect(settings.locator('.efs-icon-text')).toBeVisible();
  await expect(settings.locator('.efs-icon-text')).toHaveText('Settings');
  await expect(settings.locator('wa-icon')).toBeHidden();
  // Still one accessible name, from the visible text.
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(1);
});

test('icons render from the sprite when it loads', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-efs-icons');
  await expect(settingsButton(page).locator('.efs-icon-text')).toBeHidden();
  const box = await settingsButton(page).locator('wa-icon').boundingBox();
  expect(box?.width).toBeGreaterThan(8);
  expect(box?.width).toBeLessThanOrEqual(32);
});

test('an app chunk that fails to load shows a retry inside the shell', async ({ page }) => {
  let block = true;
  await page.route(/\/assets\/entry-[^/]+\.js$/, (route) =>
    block ? route.abort() : route.continue(),
  );
  await page.goto('./#/files');
  await page.locator('html[data-efs-booted]').waitFor({ state: 'attached' });
  const main = page.getByRole('main');
  await expect(main).toContainText("This app didn't load");
  // The shell itself (header, settings) stays usable.
  await expect(settingsButton(page)).toBeVisible();
  // Browsers cache a failed module fetch, so "Try again" reloads the page.
  block = false;
  await main.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('efs-pane-host')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/files');
});

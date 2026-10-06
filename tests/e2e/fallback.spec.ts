import { expect, test } from '@playwright/test';

async function expectFallback(page: import('@playwright/test').Page) {
  await expect(page.locator('#efs-unsupported')).toBeVisible();
  await expect(page.locator('efs-viewer-frame')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-efs-booted');
}

test('missing a Guest Reader feature shows the static message, not a half-working app', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    delete (AbortSignal as { any?: unknown }).any;
    const define = customElements.define.bind(customElements);
    (window as unknown as { efsRegistrations: string[] }).efsRegistrations = [];
    customElements.define = (name, ctor, options) => {
      (window as unknown as { efsRegistrations: string[] }).efsRegistrations.push(name);
      return define(name, ctor, options);
    };
  });
  await page.goto('./');
  await expectFallback(page);
  await expect(page.locator('html')).toHaveAttribute('data-efs-unsupported', /abortsignal-any/);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { efsRegistrations: string[] }).efsRegistrations,
    ),
  ).toEqual([]);
});

test('no custom elements support shows the static message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'customElements', { value: undefined, configurable: true });
  });
  await page.goto('./');
  await expectFallback(page);
  expect(errors).toEqual([]);
});

test('an app module that fails to parse shows the static message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'export const = ;' }),
  );
  await page.goto('./');
  await expectFallback(page);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/syntax|unexpected|parse|missing variable name/i);
});

test('an app module that fails to load shows the static message', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort());
  await page.goto('./');
  await expectFallback(page);
  expect(errors).toEqual([]);
});

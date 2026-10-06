import { expect, test } from '@playwright/test';
import { booted, openDiagnostics, recordRequests, releaseIdentity } from './support.ts';

test('no storage, cookies, service worker or third-party requests', async ({ page, context }) => {
  const requests = recordRequests(page);
  await page.goto('./');
  await booted(page);
  await openDiagnostics(page);
  const state = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).length,
    workers: (await navigator.serviceWorker.getRegistrations()).length,
  }));
  expect(state).toEqual({ local: 0, session: 0, databases: 0, workers: 0 });
  expect(await context.cookies()).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => u.origin !== origin).map(String)).toEqual([]);
});

test('CSP meta precedes scripts and blocks injected inline script', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("require-trusted-types-for 'script'");
  expect(
    await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const firstScript = document.querySelector('script');
      return (
        !!meta &&
        !!firstScript &&
        !!(meta.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  const ran = await page.evaluate(async () => {
    try {
      const script = document.createElement('script');
      script.textContent = 'window.__efsInjected = true';
      document.head.append(script);
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __efsInjected?: boolean }).__efsInjected === true;
  });
  expect(ran).toBe(false);
});

test('Trusted Types rejects string HTML sinks @chromium-only', async ({ page }) => {
  await page.goto('./');
  await booted(page);
  const outcome = await page.evaluate(() => {
    try {
      document.body.innerHTML = '<b>x</b>';
      return 'allowed';
    } catch (error) {
      return (error as Error).name;
    }
  });
  expect(outcome).toBe('TypeError');
});

test('diagnostics show the served release.json digest, labelled as self-reported', async ({
  page,
}) => {
  await page.goto('./');
  await booted(page);
  await openDiagnostics(page);
  await expect(page.locator('.efs-digest')).toHaveText(releaseIdentity());
  await expect(page.locator('aside')).toContainText('does not prove it is genuine');
});

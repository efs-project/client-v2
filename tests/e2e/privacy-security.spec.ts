import { expect, test } from '@playwright/test';
import {
  booted,
  openAbout,
  recordRegistrations,
  recordRequests,
  recordViolations,
  registrations,
  releaseIdentity,
  unexpectedViolations,
  violations,
} from './support.ts';

test('a guest visit stores nothing: no storage, database, cookie or service worker', async ({
  page,
  context,
}) => {
  const requests = recordRequests(page);
  await page.goto('./');
  await booted(page);
  // Reading settings (opening the panel) must not create the settings database either.
  await openAbout(page);
  const state = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).map((d) => d.name),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
  }));
  expect(state).toEqual({ local: 0, session: 0, databases: [], workers: 0 });
  expect(await context.cookies()).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => u.origin !== origin).map(String)).toEqual([]);
});

test('CSP: exact policy, meta precedes scripts, injected inline script is blocked', async ({
  page,
}) => {
  await page.goto('./');
  await booted(page);
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  const directives = new Map(
    (policy ?? '').split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values.join(' ')] as const;
    }),
  );
  expect(directives.get('script-src')).toBe("'self'");
  expect(directives.get('object-src')).toBe("'none'");
  expect(directives.get('base-uri')).toBe("'self'");
  expect(directives.get('require-trusted-types-for')).toBe("'script'");
  expect(directives.get('trusted-types')).toBe('lit-html');
  expect(directives.get('img-src')).toBe("'self' data: blob:");
  expect(directives.get('media-src')).toBe('blob:');
  expect(directives.get('worker-src')).toBe("'self'");
  expect(directives.get('connect-src')).toBe(
    "'self' https: wss: http://localhost:* http://127.0.0.1:* http://*.localhost:* ws://localhost:* ws://127.0.0.1:* ws://*.localhost:*",
  );
  expect(directives.get('style-src')).toMatch(/^'self' 'sha256-[A-Za-z0-9+/]+=' 'report-sample'$/);
  expect(directives.get('style-src-attr')).toMatch(
    /^'unsafe-hashes' 'sha256-[A-Za-z0-9+/]+=' 'report-sample'$/,
  );
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

test("the style hash matches <wa-page>'s inline style (fails on a Web Awesome or breakpoint change)", async ({
  page,
}) => {
  await recordViolations(page);
  await page.goto('./');
  await booted(page);
  const [element, attribute] = await page.evaluate(async () => {
    const hash = async (text: string) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    };
    const root = document.querySelector('wa-page')?.shadowRoot;
    const style = root?.querySelector('#mobile-styles')?.textContent;
    const attr = root?.querySelector('.width-measurer')?.getAttribute('style');
    return [style ? await hash(style) : 'missing', attr ? await hash(attr) : 'missing'];
  });
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy, `set WA_PAGE_STYLE_HASH in apps/web/vite.config.ts to '${element}'`).toContain(
    `'${element}'`,
  );
  expect(policy, `set WA_PAGE_ATTR_HASH in apps/web/vite.config.ts to '${attribute}'`).toContain(
    `'${attribute}'`,
  );
  // The mobile rules really apply: no style element violation.
  expect((await violations(page)).filter((v) => v.directive === 'style-src-elem')).toEqual([]);
});

test('booting and opening settings raise no unexpected CSP violations', async ({ page }) => {
  await recordViolations(page);
  await page.goto('./#/files');
  await booted(page);
  await openAbout(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);
  expect(unexpectedViolations(await violations(page))).toEqual([]);
});

test('no CSP violations at all where unsafe-hashes covers style attributes @chromium-only', async ({
  page,
}) => {
  await recordViolations(page);
  await page.goto('./#/files');
  await booted(page);
  await openAbout(page);
  expect(await violations(page)).toEqual([]);
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

test('only the expected custom elements are registered', async ({ page }) => {
  await recordRegistrations(page);
  await page.goto('./#/files');
  await booted(page);
  await openAbout(page);
  const names = await registrations(page);
  expect(new Set(names).size, 'no element is registered twice').toBe(names.length);
  expect(names.filter((n) => n.startsWith('efs-')).sort()).toEqual([
    'efs-endpoint-list',
    'efs-file-editor',
    'efs-files-file-tags',
    'efs-files-folder-picker',
    'efs-files-folder-save',
    'efs-files-listing',
    'efs-files-overview',
    'efs-files-preview',
    'efs-files-removed',
    'efs-files-tag-picker',
    'efs-files-topic',
    'efs-files-tree',
    'efs-files-view',
    'efs-files-word',
    'efs-network-indicator',
    'efs-outcome',
    'efs-pane-host',
    'efs-saves-banner',
    'efs-settings-panel',
    'efs-shell',
    'efs-wallet',
  ]);
  // Web Awesome elements come only from src/ui/wa/define.ts; nothing else defines elements.
  expect(names.filter((n) => !n.startsWith('efs-') && !n.startsWith('wa-'))).toEqual([]);
});

test('settings show the served release.json digest, labelled as self-reported', async ({
  page,
}) => {
  await page.goto('./');
  await booted(page);
  await openAbout(page);
  await expect(page.locator('.efs-digest')).toHaveText(releaseIdentity());
  await expect(page.locator('[data-section="about"]')).toContainText(
    'does not prove it is genuine',
  );
});

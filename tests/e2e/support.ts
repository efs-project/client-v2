import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const DIST = process.env.EFS_DIST ?? 'apps/web/dist';
const EVIDENCE = process.env.EFS_EVIDENCE ?? 'apps/web/dist-evidence';

export const startupFiles = (): string[] =>
  (JSON.parse(readFileSync(`${EVIDENCE}/startup.json`, 'utf8')) as { startupFiles: string[] })
    .startupFiles;
export const releaseIdentity = (): string =>
  readFileSync(`${EVIDENCE}/release-id.txt`, 'utf8').trim();
export const distText = (path: string): string => readFileSync(`${DIST}/${path}`, 'utf8');

/** Any wallet access (injected provider or EIP-6963 discovery) is recorded. */
export async function trapWallet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const touches: string[] = [];
    Object.defineProperty(window, '__efsWalletTouches', { value: touches });
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get() {
        touches.push('window.ethereum');
        throw new Error('wallet touched during guest boot');
      },
    });
    window.addEventListener('eip6963:requestProvider', () =>
      touches.push('eip6963:requestProvider'),
    );
  });
}

export const walletTouches = (page: Page) =>
  page.evaluate(() => (window as unknown as { __efsWalletTouches: string[] }).__efsWalletTouches);

export function recordRequests(page: Page): URL[] {
  const urls: URL[] = [];
  page.on('request', (request) => urls.push(new URL(request.url())));
  return urls;
}

export async function booted(page: Page): Promise<void> {
  await page.locator('html[data-efs-booted]').waitFor({ state: 'attached' });
}

export async function openDiagnostics(page: Page): Promise<void> {
  await page.locator('summary').click();
  await page.locator('.efs-digest').waitFor();
}

import { readdirSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

const DIST = process.env.EFS_DIST ?? 'apps/web/dist';
const EVIDENCE = process.env.EFS_EVIDENCE ?? 'apps/web/dist-evidence';

/** The gated startup set (tools/build/check-graph.ts): file name → brotli bytes. */
export const startupFiles = (): string[] =>
  Object.keys(
    (
      JSON.parse(readFileSync(`${EVIDENCE}/startup.json`, 'utf8')) as {
        startupFiles: Record<string, number>;
      }
    ).startupFiles,
  );
export const releaseIdentity = (): string =>
  readFileSync(`${EVIDENCE}/release-id.txt`, 'utf8').trim();
export const distText = (path: string): string => readFileSync(`${DIST}/${path}`, 'utf8');

/** Every file the build ships, as paths relative to the site root. */
export function distFiles(dir = `${DIST}/`, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? distFiles(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

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

export interface Violation {
  readonly directive: string;
  readonly blocked: string;
  readonly sample: string;
}

/** Records CSP violations from the first script on. Read with `violations(page)`. */
export async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Array<{ directive: string; blocked: string; sample: string }> = [];
    Object.defineProperty(window, '__efsViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) =>
      seen.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      }),
    );
  });
}

export const violations = (page: Page): Promise<Violation[]> =>
  page.evaluate(() => (window as unknown as { __efsViolations: Violation[] }).__efsViolations);

/**
 * The one violation we tolerate: <wa-page> renders `style="display: block; height: 0;"` on an
 * empty measuring div. The policy allows exactly that value ('unsafe-hashes'); a browser that
 * doesn't apply 'unsafe-hashes' to style attributes blocks it instead, harmlessly (a div is
 * already block, and empty). Browsers that don't report samples report it with an empty one.
 */
export function unexpectedViolations(list: readonly Violation[]): Violation[] {
  let waPageAttr = 0;
  return list.filter((v) => {
    if (
      v.directive === 'style-src-attr' &&
      (v.sample === 'display: block; height: 0;' || v.sample === '') &&
      waPageAttr === 0
    ) {
      waPageAttr++;
      return false;
    }
    return true;
  });
}

/** Records every custom element definition, in order. Read with `registrations(page)`. */
export async function recordRegistrations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const names: string[] = [];
    Object.defineProperty(window, '__efsRegistrations', { value: names });
    if (!window.customElements) return;
    const define = customElements.define.bind(customElements);
    customElements.define = (name, ctor, options) => {
      names.push(name);
      return define(name, ctor, options);
    };
  });
}

export const registrations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __efsRegistrations: string[] }).__efsRegistrations);

/** Boot completed and the active app's panes are on screen. */
export async function booted(page: Page): Promise<void> {
  await page.locator('html[data-efs-booted]').waitFor({ state: 'attached' });
  await page.locator('efs-pane-host').waitFor();
}

/** A one-network operator config (efs.config.json), served in place of the shipped empty one. */
export const TEST_CONFIG = {
  schema: 'efs-config/1',
  defaultNetwork: 'testnet',
  networks: [
    {
      id: 'testnet',
      label: 'Testnet',
      chainId: 11155111,
      deployment: 'deployments/testnet.json',
      release: 'deployments/testnet-release.json',
      rpcs: [{ url: 'https://rpc.example.net/', label: 'Example RPC' }],
      ipfsGateways: [{ url: 'https://ipfs.example.net/' }],
      arweaveGateways: [],
    },
  ],
};

export async function serveConfig(page: Page, config: unknown = TEST_CONFIG): Promise<void> {
  await page.route(/\/efs\.config\.json$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }),
  );
}

/** The header's settings control (the <wa-button> host, so slotted content is reachable). */
export const settingsButton = (page: Page) => page.locator('wa-button.efs-settings-button');

export async function openSettings(page: Page): Promise<void> {
  await settingsButton(page).click();
  await expect(page.locator('wa-drawer.efs-settings')).toHaveAttribute('open', '');
  // The drawer moves focus to its first section once it has finished opening. Acting (or
  // measuring contrast) earlier races its show animation.
  await expect(page.locator('[data-section="appearance"] h3')).toBeFocused();
}

export async function openAbout(page: Page): Promise<void> {
  await openSettings(page);
  await page.locator('.efs-digest').waitFor();
}

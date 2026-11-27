import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createRpcReplay, type RpcReplay, type RpcTranscript } from '@efs/sdk/testing';
import { expect, type Page } from '@playwright/test';
import { press } from './press.ts';

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
      chainId: 31337,
      core: '0xbfe0d63fe8bee7e225ed521756f9aa15f68e03c5',
      deployment: 'deployments/testnet.json',
      release: 'deployments/testnet-release.json',
      rpcs: [{ url: 'https://rpc.example.net/', label: 'Example RPC' }],
      ipfsGateways: [{ url: 'https://ipfs.example.net/' }],
      arweaveGateways: [],
    },
  ],
};

/** The SDK's recorded fixtures: a real chain's deployment document and JSON-RPC transcripts. */
const SDK_FIXTURES = `${dirname(createRequire(import.meta.url).resolve('@efs/sdk/package.json'))}/fixtures/rpc/`;

/** The deployment the SDK's transcripts were recorded against (chain 31337). */
export const DEPLOYMENT = readFileSync(`${SDK_FIXTURES}deployment.json`, 'utf8');

export type RpcCase =
  | 'pin-verified'
  | 'open-inline'
  | 'open-absent'
  | 'open-span'
  | 'open-external-https';

export function transcript(name: RpcCase): RpcTranscript {
  return JSON.parse(readFileSync(`${SDK_FIXTURES}${name}.json`, 'utf8')) as RpcTranscript;
}

/**
 * Answers the test RPC origin from recorded chain traffic, so the real SDK runs in the page with
 * no chain. Assert `replay.misses` is empty at the end: a miss means the SDK asked something the
 * recording doesn't cover.
 */
export async function replayRpc(page: Page, cases: readonly RpcCase[]): Promise<RpcReplay> {
  const replay = createRpcReplay(cases.map(transcript));
  await page.route(/^https:\/\/rpc\.example\.net\//, (route) =>
    route.fulfill({ json: replay.answer(JSON.parse(route.request().postData() ?? 'null')) }),
  );
  return replay;
}

/** Serves the deployment document TEST_CONFIG names (or `body` in its place). */
export async function serveDeployment(page: Page, body: string = DEPLOYMENT): Promise<void> {
  await page.route(/\/deployments\/testnet\.json$/, (route) =>
    route.fulfill({ contentType: 'application/json', body }),
  );
}

/** Answers nothing on the test RPC origins: every request fails, as if the node were down. */
export async function rpcDown(page: Page): Promise<URL[]> {
  const seen: URL[] = [];
  await page.route(
    /^(https:\/\/rpc\.example\.net|http:\/\/127\.0\.0\.1:8545|https:\/\/node\.example\.org)\//,
    (route) => {
      seen.push(new URL(route.request().url()));
      return route.abort();
    },
  );
  return seen;
}

export async function serveConfig(page: Page, config: unknown = TEST_CONFIG): Promise<void> {
  await page.route(/\/efs\.config\.json$/, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }),
  );
}

/** The header's settings control (the <wa-button> host, so slotted content is reachable). */
export const settingsButton = (page: Page) => page.locator('wa-button.efs-settings-button');

export async function openSettings(page: Page): Promise<void> {
  await press(settingsButton(page));
  await expect(page.locator('wa-drawer.efs-settings')).toHaveAttribute('open', '');
  // The drawer moves focus to its first section once it has finished opening.
  await expect(page.locator('[data-section="appearance"] h3')).toBeFocused();
}

export async function openAbout(page: Page): Promise<void> {
  await openSettings(page);
  await page.locator('.efs-digest').waitFor();
}

export interface FakeWallet {
  readonly name: string;
  readonly rdns: string;
  readonly account: string;
  readonly chainId: number;
  /** Refuse eth_requestAccounts (EIP-1193 4001). */
  readonly refuse?: boolean;
}

/**
 * Installs fake EIP-6963 wallets that answer like a real one and record every call
 * (`walletCalls(page)`), so tests can prove nothing touches a wallet before Connect.
 */
export async function installWallets(page: Page, wallets: readonly FakeWallet[]): Promise<void> {
  await page.addInitScript((list) => {
    const calls: string[] = [];
    Object.defineProperty(window, '__efsWalletCalls', { value: calls });
    const providers = list.map((w) => {
      let chainId = w.chainId;
      const listeners = new Map<string, Set<(v: unknown) => void>>();
      const emit = (event: string, value: unknown) => {
        for (const fn of listeners.get(event) ?? []) fn(value);
      };
      const provider = {
        async request({ method, params }: { method: string; params?: unknown }) {
          calls.push(`${w.rdns}:${method}`);
          if (method === 'eth_requestAccounts') {
            if (w.refuse) throw Object.assign(new Error('User rejected'), { code: 4001 });
            return [w.account];
          }
          if (method === 'eth_accounts') return [w.account];
          if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
          if (method === 'wallet_switchEthereumChain') {
            const wanted = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
            chainId = wanted;
            setTimeout(() => emit('chainChanged', `0x${wanted.toString(16)}`), 0);
            return null;
          }
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
        },
        on(event: string, fn: (v: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)?.add(fn);
        },
        removeListener(event: string, fn: (v: unknown) => void) {
          listeners.get(event)?.delete(fn);
        },
      };
      return {
        info: { uuid: crypto.randomUUID(), name: w.name, icon: '', rdns: w.rdns },
        provider,
      };
    });
    window.addEventListener('eip6963:requestProvider', () => {
      calls.push('eip6963:requestProvider');
      for (const detail of providers) {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      }
    });
  }, wallets);
}

export const walletCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __efsWalletCalls: string[] }).__efsWalletCalls);

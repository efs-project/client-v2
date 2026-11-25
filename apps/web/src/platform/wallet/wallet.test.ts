import { describe, expect, it, vi } from 'vitest';
import { connect, firstAccount, parseChainId, switchChain, watchWallet } from './connect.ts';
import { discoverWallets, type Eip1193Provider, readAnnouncement } from './discovery.ts';

const provider = (answers: Record<string, unknown> = {}): Eip1193Provider => ({
  request: vi.fn(async ({ method }: { method: string }) => {
    const answer = answers[method];
    if (answer instanceof Error || (typeof answer === 'object' && answer && 'code' in answer)) {
      throw answer;
    }
    return answer;
  }),
});

const announce = (target: EventTarget, info: Record<string, unknown>, p = provider()) =>
  target.addEventListener('eip6963:requestProvider', () =>
    target.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', { detail: { info, provider: p } }),
    ),
  );

const INFO = {
  uuid: 'u-1',
  name: 'Test Wallet',
  icon: 'data:image/svg+xml;base64,PHN2Zy8+',
  rdns: 'test.wallet',
};

describe('discoverWallets (EIP-6963)', () => {
  it('collects announced wallets, deduplicated by uuid', async () => {
    const target = new EventTarget();
    announce(target, INFO);
    announce(target, INFO);
    announce(target, { ...INFO, uuid: 'u-2', name: 'Other' });
    const found = await discoverWallets(
      target as unknown as Window,
      new AbortController().signal,
      10,
    );
    expect(found.map((w) => w.name)).toEqual(['Test Wallet', 'Other']);
  });

  it('falls back to an injected window.ethereum when no wallet announces', async () => {
    const target = Object.assign(new EventTarget(), { ethereum: provider() });
    const found = await discoverWallets(
      target as unknown as Window,
      new AbortController().signal,
      10,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.rdns).toBe('legacy');
  });

  it('finds nothing when there is no wallet', async () => {
    const found = await discoverWallets(
      new EventTarget() as unknown as Window,
      new AbortController().signal,
      10,
    );
    expect(found).toEqual([]);
  });

  it('treats announcements as untrusted: bad shapes are dropped, non-image icons blanked', () => {
    expect(readAnnouncement({ info: INFO, provider: {} })).toBeUndefined();
    expect(
      readAnnouncement({ info: { ...INFO, name: ' ' }, provider: provider() }),
    ).toBeUndefined();
    expect(readAnnouncement(null)).toBeUndefined();
    const option = readAnnouncement({
      info: { ...INFO, icon: 'javascript:alert(1)', name: 'x'.repeat(200) },
      provider: provider(),
    });
    expect(option?.icon).toBe('');
    expect(option?.name).toHaveLength(64);
  });
});

describe('connect / switchChain', () => {
  it('returns the first account (lowercase) and the chain', async () => {
    const result = await connect(
      provider({ eth_requestAccounts: [`0x${'AB'.repeat(20)}`], eth_chainId: '0x7a69' }),
    );
    expect(result).toEqual({
      status: 'CONNECTED',
      account: `0x${'ab'.repeat(20)}`,
      chainId: 31337,
    });
  });

  it('distinguishes a refusal and a request already waiting in the wallet', async () => {
    expect(await connect(provider({ eth_requestAccounts: { code: 4001 } }))).toEqual({
      status: 'REFUSED',
    });
    expect(await connect(provider({ eth_requestAccounts: { code: -32002 } }))).toEqual({
      status: 'PENDING',
    });
    expect((await connect(provider({ eth_requestAccounts: [] }))).status).toBe('ERROR');
  });

  it('switches chains and reports an unknown chain distinctly', async () => {
    const p = provider({ wallet_switchEthereumChain: null });
    expect(await switchChain(p, 31337)).toEqual({ status: 'SWITCHED' });
    expect(p.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x7a69' }],
    });
    expect(await switchChain(provider({ wallet_switchEthereumChain: { code: 4902 } }), 1)).toEqual({
      status: 'UNKNOWN_CHAIN',
    });
  });

  it('parses only well-formed chain ids and accounts', () => {
    expect(parseChainId('0x1')).toBe(1);
    expect(parseChainId('1')).toBeUndefined();
    expect(parseChainId('0x0')).toBeUndefined();
    expect(firstAccount(['0x123'])).toBeUndefined();
    expect(firstAccount(`0x${'a'.repeat(40)}`)).toBeUndefined();
  });

  it('follows account and chain changes until the scope ends', () => {
    const listeners = new Map<string, (...a: unknown[]) => void>();
    const p: Eip1193Provider = {
      request: vi.fn(),
      on: (event, fn) => listeners.set(event, fn),
      removeListener: (event) => listeners.delete(event),
    };
    const controller = new AbortController();
    const accounts: (string | undefined)[] = [];
    const chains: (number | undefined)[] = [];
    watchWallet(
      p,
      controller.signal,
      (a) => accounts.push(a),
      (c) => chains.push(c),
    );
    listeners.get('accountsChanged')?.([`0x${'cd'.repeat(20)}`]);
    listeners.get('accountsChanged')?.([]);
    listeners.get('chainChanged')?.('0xaa36a7');
    expect(accounts).toEqual([`0x${'cd'.repeat(20)}`, undefined]);
    expect(chains).toEqual([11155111]);
    controller.abort();
    expect(listeners.size).toBe(0);
  });
});

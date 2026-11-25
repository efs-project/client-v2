import { describe, expect, it, vi } from 'vitest';
import { createScope } from '../platform/scope.ts';
import * as connectModule from '../platform/wallet/connect.ts';
import type { Eip1193Provider, WalletOption } from '../platform/wallet/discovery.ts';
import { createWalletSession, shortAccount } from './wallet-state.ts';

const ACCOUNT = `0x${'ab'.repeat(20)}`;

function fakeProvider(accounts: unknown = [ACCOUNT], chainId = '0x7a69') {
  const listeners = new Map<string, (...a: unknown[]) => void>();
  const provider: Eip1193Provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') {
        if (
          accounts instanceof Error ||
          (typeof accounts === 'object' && accounts && 'code' in accounts)
        ) {
          throw accounts;
        }
        return accounts;
      }
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') return null;
      throw new Error(`unexpected ${method}`);
    }),
    on: (event, fn) => listeners.set(event, fn),
    removeListener: (event) => listeners.delete(event),
  };
  return { provider, listeners };
}

const option = (provider: Eip1193Provider, uuid = 'u-1'): WalletOption => ({
  uuid,
  name: `Wallet ${uuid}`,
  icon: '',
  rdns: `test.${uuid}`,
  provider,
});

function session(options: WalletOption[]) {
  const discoverWallets = vi.fn(async () => options);
  const s = createWalletSession(createScope(), {
    target: {} as Window,
    load: async () => [{ discoverWallets, readAnnouncement: vi.fn() }, connectModule],
  });
  return { s, discoverWallets };
}

describe('createWalletSession', () => {
  it('does nothing until connect(); one wallet connects directly', async () => {
    const { provider } = fakeProvider();
    const { s, discoverWallets } = session([option(provider)]);
    expect(s.state.get()).toEqual({ status: 'DISCONNECTED' });
    expect(discoverWallets).not.toHaveBeenCalled();
    await s.connect();
    expect(s.state.get()).toMatchObject({ status: 'CONNECTED', account: ACCOUNT, chainId: 31337 });
  });

  it('asks the person to choose when several wallets answer', async () => {
    const a = option(fakeProvider().provider, 'a');
    const b = option(fakeProvider().provider, 'b');
    const { s } = session([a, b]);
    await s.connect();
    expect(s.state.get()).toMatchObject({ status: 'CHOOSING' });
    await s.choose(b);
    expect(s.state.get()).toMatchObject({ status: 'CONNECTED', option: { uuid: 'b' } });
  });

  it('reports no wallet, and a refusal, as themselves', async () => {
    const none = session([]);
    await none.s.connect();
    expect(none.s.state.get()).toEqual({ status: 'NO_WALLET' });
    const refused = session([option(fakeProvider({ code: 4001 }).provider)]);
    await refused.s.connect();
    expect(refused.s.state.get()).toMatchObject({ status: 'REFUSED' });
  });

  it('follows account changes; a withdrawn account disconnects rather than swapping silently', async () => {
    const { provider, listeners } = fakeProvider();
    const { s } = session([option(provider)]);
    await s.connect();
    const other = `0x${'cd'.repeat(20)}`;
    listeners.get('accountsChanged')?.([other]);
    expect(s.state.get()).toMatchObject({ status: 'CONNECTED', account: other });
    listeners.get('chainChanged')?.('0xaa36a7');
    expect(s.state.get()).toMatchObject({ chainId: 11155111 });
    listeners.get('accountsChanged')?.([]);
    expect(s.state.get()).toEqual({ status: 'DISCONNECTED' });
    expect(listeners.size).toBe(0);
  });

  it('a chain switch is reported but never assumed: the chain changes only via chainChanged', async () => {
    const { provider } = fakeProvider();
    const { s } = session([option(provider)]);
    await s.connect();
    expect(await s.switchChain(11155111)).toBe('SWITCHED');
    expect(s.state.get()).toMatchObject({ chainId: 31337 });
  });

  it('a wallet chunk that fails to load is reported', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = createWalletSession(createScope(), {
      target: {} as Window,
      load: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    });
    await s.connect();
    expect(s.state.get()).toEqual({ status: 'LOAD_FAILED' });
    error.mockRestore();
  });

  it('shortens an account for display', () => {
    expect(shortAccount(ACCOUNT)).toBe('0xabab…abab');
  });
});

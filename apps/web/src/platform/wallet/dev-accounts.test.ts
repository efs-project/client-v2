import { describe, expect, it, vi } from 'vitest';
import type { DevAccount } from '../settings/model.ts';
import { devWallet } from './dev-accounts.ts';

const SATOSHI: DevAccount = {
  name: 'Satoshi Nakamoto',
  address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
};
const HAL: DevAccount = {
  name: 'Hal Finney',
  address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
};

function wallet(choices: (DevAccount | undefined)[], kept?: { value: string | undefined }) {
  const sent: { method: string; params: unknown }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body) as { method: string; params: unknown };
    sent.push({ method, params });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: method === 'eth_sendTransaction' ? '0xhash' : '0x1',
      }),
    );
  });
  const choose = vi.fn(async () => choices.shift());
  const w = devWallet({
    rdns: 'dev.efs.accounts',
    accounts: [SATOSHI, HAL],
    rpcUrl: 'http://127.0.0.1:8588/',
    chainId: 3133779,
    choose,
    fetch: fetchImpl as unknown as typeof fetch,
    ...(kept
      ? {
          remember: {
            get: () => kept.value,
            set: (address: string) => {
              kept.value = address;
            },
          },
        }
      : {}),
  });
  return { w, sent, choose };
}

describe('the dev wallet: personas on the local test chain, signed by the chain', () => {
  it('asks which persona on connect, then answers with it; the chain id is the dev chain', async () => {
    const { w, choose } = wallet([SATOSHI]);
    expect(await w.provider.request({ method: 'eth_accounts' })).toEqual([]);
    expect(await w.provider.request({ method: 'eth_requestAccounts' })).toEqual([SATOSHI.address]);
    expect(await w.provider.request({ method: 'eth_requestAccounts' })).toEqual([SATOSHI.address]);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(await w.provider.request({ method: 'eth_chainId' })).toBe(`0x${(3133779).toString(16)}`);
  });

  it('closing the chooser is a refusal (4001)', async () => {
    const { w } = wallet([undefined]);
    await expect(w.provider.request({ method: 'eth_requestAccounts' })).rejects.toMatchObject({
      code: 4001,
    });
  });

  it('sends only as the persona in use, forwarded to the dev chain to sign', async () => {
    const { w, sent } = wallet([SATOSHI]);
    await w.provider.request({ method: 'eth_requestAccounts' });
    await expect(
      w.provider.request({ method: 'eth_sendTransaction', params: [{ from: HAL.address }] }),
    ).rejects.toMatchObject({ code: 4100 });
    expect(
      await w.provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: SATOSHI.address.toUpperCase().replace('0X', '0x') }],
      }),
    ).toBe('0xhash');
    expect(sent.map((s) => s.method)).toEqual(['eth_sendTransaction']);
  });

  it('switching persona says so with accountsChanged; batches are refused so sends go part by part', async () => {
    const { w } = wallet([SATOSHI, HAL]);
    const changed = vi.fn();
    w.provider.on?.('accountsChanged', changed);
    await w.provider.request({ method: 'eth_requestAccounts' });
    await w.provider.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });
    expect(changed).toHaveBeenCalledWith([HAL.address]);
    expect(w.current()).toBe(HAL.address);
    await expect(
      w.provider.request({ method: 'wallet_sendCalls', params: [] }),
    ).rejects.toMatchObject({ code: 4200 });
    await expect(
      w.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }),
    ).rejects.toMatchObject({ code: 4902 });
  });

  it("this tab's last persona connects without asking; any choice is kept; a stale one asks again", async () => {
    const kept = { value: undefined as string | undefined };
    const first = wallet([HAL], kept);
    await first.w.provider.request({ method: 'eth_requestAccounts' });
    expect(kept.value).toBe(HAL.address);
    // A reload in the same tab: a new wallet, the same persona, no prompt.
    const again = wallet([], kept);
    expect(await again.w.provider.request({ method: 'eth_requestAccounts' })).toEqual([
      HAL.address,
    ]);
    expect(again.choose).not.toHaveBeenCalled();
    // An address no longer offered is never used: it asks.
    const stale = wallet([SATOSHI], { value: '0x0000000000000000000000000000000000000001' });
    expect(await stale.w.provider.request({ method: 'eth_requestAccounts' })).toEqual([
      SATOSHI.address,
    ]);
    expect(stale.choose).toHaveBeenCalledTimes(1);
  });
});

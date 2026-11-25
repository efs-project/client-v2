import type { Efs } from '@efs/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { WalletOption } from '../platform/wallet/discovery.ts';
import { state } from '../state/signals.ts';
import type { NetworkState } from './network-state.ts';
import type { ReaderState } from './reader-state.ts';
import type { WalletState } from './wallet-state.ts';
import { createWriterSession } from './writer-state.ts';

const efs = {} as Efs;
const verified: ReaderState = { status: 'PINNED', efs, pin: { status: 'VERIFIED' } as never };
const ACCOUNT = `0x${'ab'.repeat(20)}`;
const option = (): WalletOption => ({
  uuid: 'u',
  name: 'W',
  icon: '',
  rdns: 'w',
  provider: { request: vi.fn() },
});
const connected = (chainId = 31337, o = option(), account = ACCOUNT): WalletState => ({
  status: 'CONNECTED',
  option: o,
  account,
  chainId,
});
const network = (chainId = 31337): NetworkState =>
  ({ status: 'CONFIGURED', network: { definition: { chainId } }, endpointLabel: 'x' }) as never;

function setup() {
  const reader = state<ReaderState>({ status: 'OFF' });
  const wallet = state<WalletState>({ status: 'DISCONNECTED' });
  const net = state<NetworkState>(network());
  const createWriter = vi.fn(async (_efs: unknown, config: { authorizer: unknown }) => ({
    account: ACCOUNT,
    config,
  }));
  const session = createWriterSession(reader, wallet, net, {
    loadActions: async () => ({ createWriter }) as never,
    loadJournal: async () => ({ indexedDbJournal: () => ({ name: 'journal' }) }) as never,
  });
  return { reader, wallet, net, session, createWriter };
}

describe('createWriterSession', () => {
  it('is available only with a verified session, a connected wallet and the same chain', async () => {
    const { reader, wallet, net, session, createWriter } = setup();
    expect(session.availability.get()).toEqual({ status: 'NO_SESSION' });
    reader.set(verified);
    expect(session.availability.get()).toEqual({ status: 'NO_WALLET' });
    wallet.set(connected(1));
    expect(session.availability.get()).toEqual({ status: 'WRONG_CHAIN', wanted: 31337, actual: 1 });
    expect(await session.writer()).toBeUndefined();
    expect(createWriter).not.toHaveBeenCalled();
    wallet.set(connected(31337));
    expect(session.availability.get()).toEqual({ status: 'READY', account: ACCOUNT });
    net.set(network(11155111));
    expect(session.availability.get().status).toBe('WRONG_CHAIN');
  });

  it('creates one writer per session, wallet and account, with the eip1193 direct profile', async () => {
    const { reader, wallet, session, createWriter } = setup();
    const o = option();
    reader.set(verified);
    wallet.set(connected(31337, o));
    const first = await session.writer();
    expect(await session.writer()).toBe(first);
    expect(createWriter).toHaveBeenCalledTimes(1);
    expect(createWriter.mock.calls[0]?.[1]).toMatchObject({
      authorizer: { kind: 'eip1193', profile: 'direct', provider: o.provider, account: ACCOUNT },
    });
    wallet.set(connected(31337, o, `0x${'cd'.repeat(20)}`));
    await session.writer();
    expect(createWriter).toHaveBeenCalledTimes(2);
    wallet.set(connected(31337, option(), `0x${'cd'.repeat(20)}`));
    await session.writer();
    expect(createWriter).toHaveBeenCalledTimes(3);
  });
});

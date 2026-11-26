import type { Efs, PinResult } from '@efs/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createScope } from '../platform/scope.ts';
import type { EffectiveNetwork, NetworkDefinition } from '../platform/settings/model.ts';
import type { ReaderOpen } from '../session/reader.ts';
import { state } from '../state/signals.ts';
import type { NetworkState } from './network-state.ts';
import { createReaderSession, type ReaderState, verifiedEfs } from './reader-state.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const DEFINITION: NetworkDefinition = {
  id: 'testnet',
  label: 'Testnet',
  chainId: 31337,
  core: '0x83ce0b9e2ddd9c5cebbfe6b2b9bc275fda9a20fb',
  deployment: 'deployments/testnet.json',
  release: 'deployments/testnet-release.json',
  rpcs: [],
  ipfsGateways: [],
  arweaveGateways: [],
};

function configured(rpcUrl = 'https://rpc.example.net/'): NetworkState {
  const network: EffectiveNetwork = {
    definition: DEFINITION,
    rpcs: [{ url: rpcUrl, enabled: true }],
    ipfsGateways: [],
    arweaveGateways: [],
    customized: { rpcs: false, gateways: false },
  };
  return { status: 'CONFIGURED', network, endpointLabel: new URL(rpcUrl).origin };
}

const pinResult = (status: 'VERIFIED' | 'UNKNOWN'): PinResult =>
  status === 'VERIFIED'
    ? ({ kind: 'efs.pin', status, evidence: { attempts: [], requests: 1 } } as unknown as PinResult)
    : {
        kind: 'efs.pin',
        status,
        reason: { code: 'RPC_UNAVAILABLE', retry: 'transient' },
        evidence: { attempts: [], requests: 1 },
      };

/** A fake SDK instance whose pin answers come from a queue. */
function fakeEfs(answers: Array<'VERIFIED' | 'UNKNOWN'>) {
  const pin = vi.fn(async () => pinResult(answers.shift() ?? 'VERIFIED'));
  return { efs: { pin } as unknown as Efs, pin };
}

function setup(open: (network: EffectiveNetwork) => Promise<ReaderOpen>) {
  const network = state<NetworkState>({ status: 'NONE' });
  const publisherLocations = state(false);
  const scope = createScope();
  const openReader = vi.fn(
    async (n: EffectiveNetwork, _b?: string, _s?: AbortSignal, _f?: unknown, _o?: unknown) =>
      open(n),
  );
  const session = createReaderSession(network, 'https://site.example/', scope, {
    load: async () => ({
      openReader,
      ALLOWED_LOCATION_SCHEMES: ['ipfs', 'ar', 'data', 'web3'] as const,
    }),
    publisherLocations,
  });
  const seen: string[] = [];
  const record = () => seen.push(session.state.get().status);
  return { network, publisherLocations, scope, session, openReader, seen, record };
}

describe('createReaderSession', () => {
  it('stays off without a usable network, then opens and pins', async () => {
    const { efs, pin } = fakeEfs(['VERIFIED']);
    const { network, session, scope } = setup(async () => ({ status: 'READY', efs }));
    await tick();
    expect(session.state.get()).toEqual({ status: 'OFF' });
    network.set(configured());
    await tick();
    await tick();
    const now = session.state.get();
    expect(now.status).toBe('PINNED');
    expect(verifiedEfs(now)).toBe(efs);
    expect(pin).toHaveBeenCalledTimes(1);
    scope.dispose();
  });

  it('rebuilds only when the SDK configuration changes', async () => {
    const { efs } = fakeEfs(['VERIFIED', 'VERIFIED']);
    const { network, openReader, scope } = setup(async () => ({ status: 'READY', efs }));
    network.set(configured());
    await tick();
    network.set(configured()); // equal configuration, new object
    await tick();
    expect(openReader).toHaveBeenCalledTimes(1);
    network.set(configured('http://127.0.0.1:8545/'));
    await tick();
    expect(openReader).toHaveBeenCalledTimes(2);
    expect(openReader.mock.calls[1]?.[0].rpcs[0]?.url).toBe('http://127.0.0.1:8545/');
    network.set({ status: 'NONE' });
    await tick();
    expect(openReader).toHaveBeenCalledTimes(2);
    scope.dispose();
  });

  it('rebuilds with publisher locations when the person turns them on', async () => {
    const { efs } = fakeEfs(['VERIFIED', 'VERIFIED']);
    const { network, publisherLocations, openReader, scope } = setup(async () => ({
      status: 'READY',
      efs,
    }));
    network.set(configured());
    await tick();
    publisherLocations.set(true);
    await tick();
    expect(openReader).toHaveBeenCalledTimes(2);
    expect(openReader.mock.calls[1]?.[4]).toEqual({ publisherLocations: true });
    scope.dispose();
  });

  it('never offers an SDK instance for reads unless the pin is VERIFIED; retry re-pins', async () => {
    const { efs, pin } = fakeEfs(['UNKNOWN', 'VERIFIED']);
    const { network, session, scope } = setup(async () => ({ status: 'READY', efs }));
    network.set(configured());
    await tick();
    await tick();
    let now: ReaderState = session.state.get();
    expect(now).toMatchObject({ status: 'PINNED', pin: { status: 'UNKNOWN' } });
    expect(verifiedEfs(now)).toBeUndefined();
    session.retry();
    await tick();
    now = session.state.get();
    expect(verifiedEfs(now)).toBe(efs);
    expect(pin).toHaveBeenCalledTimes(2);
    scope.dispose();
  });

  it('reports a bad deployment document as such, and retry opens again', async () => {
    let answer: ReaderOpen = { status: 'DEPLOYMENT_INVALID' };
    const { efs } = fakeEfs(['VERIFIED']);
    const { network, session, openReader, scope } = setup(async () => answer);
    network.set(configured());
    await tick();
    expect(session.state.get()).toEqual({ status: 'DEPLOYMENT_INVALID' });
    answer = { status: 'READY', efs };
    session.retry();
    await tick();
    await tick();
    expect(openReader).toHaveBeenCalledTimes(2);
    expect(session.state.get().status).toBe('PINNED');
    scope.dispose();
  });

  it('shows LOAD_FAILED when the SDK chunk does not load; retry reloads the page', async () => {
    const network = state<NetworkState>(configured());
    const scope = createScope();
    const reload = vi.fn();
    const load = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    );
    const session = createReaderSession(network, 'https://site.example/', scope, { load, reload });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await tick();
    await tick();
    expect(session.state.get()).toEqual({ status: 'LOAD_FAILED' });
    session.retry();
    // A failed import is cached by the browser: only a reload can retry it.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    error.mockRestore();
    scope.dispose();
  });

  it('a superseded open never overwrites the newer one', async () => {
    const slow = fakeEfs(['VERIFIED']);
    const fast = fakeEfs(['VERIFIED']);
    let release: (value: ReaderOpen) => void = () => {};
    const { network, session, scope } = setup((n) =>
      n.rpcs[0]?.url === 'https://slow.example/'
        ? new Promise<ReaderOpen>((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ status: 'READY', efs: fast.efs }),
    );
    network.set(configured('https://slow.example/'));
    await tick();
    network.set(configured('https://fast.example/'));
    await tick();
    await tick();
    release({ status: 'READY', efs: slow.efs });
    await tick();
    expect(verifiedEfs(session.state.get())).toBe(fast.efs);
    expect(slow.pin).not.toHaveBeenCalled();
    scope.dispose();
  });
});

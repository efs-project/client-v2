import type { Efs, PinResult } from '@efs/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { EffectiveNetwork, NetworkDefinition } from '../platform/settings/model.ts';
import type { NetworkState } from './network-state.ts';
import { readFloorReset } from './read-floor.ts';
import type { ReaderState } from './reader-state.ts';

const DEFINITION: NetworkDefinition = {
  id: 'local',
  label: 'Local',
  chainId: 31337,
  core: '0xbfe0d63fe8bee7e225ed521756f9aa15f68e03c5',
  deployment: 'deployments/local.json',
  release: 'deployments/local-release.json',
  rpcs: [],
  ipfsGateways: [],
  arweaveGateways: [],
};

function configured(...rpcs: { url: string; enabled: boolean }[]): NetworkState {
  const network: EffectiveNetwork = {
    definition: DEFINITION,
    rpcs,
    ipfsGateways: [],
    arweaveGateways: [],
    customized: { rpcs: false, gateways: false },
  };
  return { status: 'CONFIGURED', network, endpointLabel: 'rpc' };
}

function pinned(status: 'VERIFIED' | 'UNKNOWN', resetReadFloor = vi.fn()) {
  const efs = { resetReadFloor } as unknown as Efs;
  const pin = { kind: 'efs.pin', status } as unknown as PinResult;
  return { state: { status: 'PINNED', efs, pin } as ReaderState, resetReadFloor };
}

const LOCAL = { url: 'http://127.0.0.1:8545/', enabled: true };
const LIVE = { url: 'https://rpc.example.net/', enabled: true };

describe('readFloorReset ("The test chain was reset? Start over")', () => {
  it('forgets the floor of the verified session on a local test chain', () => {
    const { state, resetReadFloor } = pinned('VERIFIED');
    const reset = readFloorReset(configured(LOCAL), state);
    expect(reset).toBeTypeOf('function');
    reset?.();
    expect(resetReadFloor).toHaveBeenCalledTimes(1);
  });

  it('is never offered on a live chain, or where any enabled endpoint is off this computer', () => {
    expect(readFloorReset(configured(LIVE), pinned('VERIFIED').state)).toBeUndefined();
    expect(readFloorReset(configured(LOCAL, LIVE), pinned('VERIFIED').state)).toBeUndefined();
  });

  it('counts only the enabled endpoints', () => {
    const off = { ...LIVE, enabled: false };
    expect(readFloorReset(configured(LOCAL, off), pinned('VERIFIED').state)).toBeTypeOf('function');
  });

  it('needs a verified session and a selected network', () => {
    expect(readFloorReset(configured(LOCAL), pinned('UNKNOWN').state)).toBeUndefined();
    expect(readFloorReset(configured(LOCAL), { status: 'OPENING' })).toBeUndefined();
    const pinning = { status: 'PINNING', efs: {} as Efs } as const;
    expect(readFloorReset(configured(LOCAL), pinning)).toBeUndefined();
    expect(readFloorReset({ status: 'NONE' }, pinned('VERIFIED').state)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { NetworkDefinition, UserSettings } from './model.ts';
import { hasGateway, publicGatewayHosts, withPublicGateways } from './public-gateways.ts';

const network = { id: 'testnet' } as NetworkDefinition;
const settings = {
  network: { overrides: { other: { rpcs: [] } } },
} as unknown as UserSettings;

describe("public gateways: offered, then saved into the network's own list", () => {
  it('adds them after the gateways in effect, each on; other networks are untouched', () => {
    const next = withPublicGateways(
      settings,
      network,
      [{ url: 'https://mine.example/', enabled: false }],
      'arweave',
    );
    expect(next.network.overrides.testnet?.arweaveGateways).toEqual([
      { url: 'https://mine.example/', enabled: false },
      { url: 'https://arweave.net/', enabled: true },
      { url: 'https://ar-io.net/', enabled: true },
    ]);
    expect(next.network.overrides.other).toEqual({ rpcs: [] });
  });

  it('one already listed is turned on, not added twice', () => {
    const next = withPublicGateways(
      settings,
      network,
      [{ url: 'https://ipfs.io', label: 'mine', enabled: false }],
      'ipfs',
    );
    expect(next.network.overrides.testnet?.ipfsGateways).toEqual([
      { url: 'https://ipfs.io', label: 'mine', enabled: true },
      { url: 'https://dweb.link/', enabled: true },
      { url: 'https://trustless-gateway.link/', enabled: true },
    ]);
  });

  it('names them by host for the offer, and says whether a list has one on', () => {
    expect(publicGatewayHosts('ipfs')).toEqual(['ipfs.io', 'dweb.link', 'trustless-gateway.link']);
    expect(hasGateway([{ url: 'https://a.example/', enabled: false }])).toBe(false);
    expect(hasGateway([{ url: 'https://a.example/', enabled: true }])).toBe(true);
  });
});

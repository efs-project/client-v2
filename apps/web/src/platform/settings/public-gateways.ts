// Public gateways, offered (never turned on silently) when a file stored on IPFS or Arweave is
// opened and the person has no gateway for it: the client ships no default list (PM working
// default D14). Choosing them saves them into the selected network's own list, the same setting
// Settings shows and edits, so it is visible and reversible there.
//
// They are third parties: each sees the reader's IP address and which file is read. The offer
// names them and says so.

import type { Endpoint, NetworkDefinition, UserSettings } from './model.ts';

export type GatewayKind = 'ipfs' | 'arweave';

export const PUBLIC_GATEWAYS: Readonly<Record<GatewayKind, readonly string[]>> = {
  ipfs: ['https://ipfs.io/', 'https://dweb.link/', 'https://trustless-gateway.link/'],
  arweave: ['https://arweave.net/', 'https://ar-io.net/'],
};

const LIST_KEY = { ipfs: 'ipfsGateways', arweave: 'arweaveGateways' } as const;

/** The public gateways' hosts, for the offer's words ("ipfs.io, dweb.link and …"). */
export const publicGatewayHosts = (kind: GatewayKind): readonly string[] =>
  PUBLIC_GATEWAYS[kind].map((url) => new URL(url).host);

/**
 * `settings` with the public gateways of `kind` added to `network`'s list, after the ones it has
 * (`current`, the list in effect), each enabled. One already there (by origin) is turned on, not
 * added again.
 */
export function withPublicGateways(
  settings: UserSettings,
  network: NetworkDefinition,
  current: readonly Endpoint[],
  kind: GatewayKind,
): UserSettings {
  const origin = (url: string) => new URL(url).origin;
  const wanted = new Set(PUBLIC_GATEWAYS[kind].map(origin));
  const kept = current.map((e) => (wanted.has(origin(e.url)) ? { ...e, enabled: true } : e));
  const have = new Set(kept.map((e) => origin(e.url)));
  const added = PUBLIC_GATEWAYS[kind]
    .filter((url) => !have.has(origin(url)))
    .map((url) => ({ url, enabled: true }));
  const overrides = settings.network.overrides[network.id] ?? {};
  return {
    ...settings,
    network: {
      ...settings.network,
      overrides: {
        ...settings.network.overrides,
        [network.id]: { ...overrides, [LIST_KEY[kind]]: [...kept, ...added] },
      },
    },
  };
}

/** Whether `list` has a gateway that is on. */
export const hasGateway = (list: readonly Endpoint[]): boolean => list.some((e) => e.enabled);

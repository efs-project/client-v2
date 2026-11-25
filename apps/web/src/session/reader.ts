// The reader session: the one place the client creates an SDK instance. Loaded lazily (never in
// the startup set: the SDK carries viem/ox internals), only when a usable network is configured.
//
// The client's job here is configuration, not protocol: it fetches the operator's deployment
// document and hands the SDK the user's ordered endpoints. Everything about what is on chain
// (pinning, reads, verification) is the SDK's.

import { createEfs, type Efs, EfsFault } from '@efs/sdk';
import type { EffectiveNetwork, Endpoint } from '../platform/settings/model.ts';

/** Deployment documents are small JSON; anything larger is refused unread. */
const MAX_DEPLOYMENT_BYTES = 512 * 1024;

/**
 * Byte locations the SDK may fetch: through the user's own gateways (ipfs, ar), through the
 * user's own RPC endpoints (web3: contract storage read over the same RPCs as every other read,
 * so no new party sees the reader), and inline data. A publisher-chosen https:// location would
 * reveal the reader's IP to that host, so it is fetched only after the person allows it (once,
 * per origin, or always in Settings).
 */
export const ALLOWED_LOCATION_SCHEMES = ['ipfs', 'ar', 'data', 'web3'] as const;

export type ReaderOpen =
  | { readonly status: 'READY'; readonly efs: Efs }
  /** The deployment document could not be fetched (offline, 404, too large, not JSON). */
  | { readonly status: 'DEPLOYMENT_UNAVAILABLE' }
  /** The SDK rejected the document (not efs-deployment/1, or inconsistent). */
  | { readonly status: 'DEPLOYMENT_INVALID' }
  /** The document is for a different chain or ledger than the network it is configured as. */
  | {
      readonly status: 'DEPLOYMENT_MISMATCH';
      readonly field: 'chainId' | 'core';
      readonly expected: string;
      readonly actual: string;
    };

const origins = (list: readonly Endpoint[]): string[] => list.map((e) => new URL(e.url).origin);

async function loadDeployment(
  url: URL,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-cache',
      signal,
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length > MAX_DEPLOYMENT_BYTES) return undefined;
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

/**
 * Creates the SDK instance for one effective network. No chain I/O happens here; `efs.pin()`
 * is the caller's next step. Gateway lists are always passed explicitly, so the SDK never falls
 * back to defaults the user can't see.
 */
export interface ReaderOptions {
  /** Also fetch from publishers' own https:// locations (the person opted in, in Settings). */
  readonly publisherLocations?: boolean;
}

export async function openReader(
  network: EffectiveNetwork,
  base: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  { publisherLocations = false }: ReaderOptions = {},
): Promise<ReaderOpen> {
  // The deployment document ships with the site, like efs.config.json. A cross-origin URL would
  // be a request to a host the user can't see in Settings, so it is refused unread.
  const url = new URL(network.definition.deployment, base);
  if (url.origin !== new URL(base).origin) return { status: 'DEPLOYMENT_UNAVAILABLE' };
  const deployment = await loadDeployment(url, signal, fetchImpl);
  if (deployment === undefined) return { status: 'DEPLOYMENT_UNAVAILABLE' };
  let efs: Efs;
  try {
    efs = createEfs({
      rpcs: network.rpcs.map((e) => (e.label ? { url: e.url, label: e.label } : { url: e.url })),
      deployment,
      gateways: {
        ipfs: origins(network.ipfsGateways),
        arweave: origins(network.arweaveGateways),
        allowSchemes: publisherLocations
          ? [...ALLOWED_LOCATION_SCHEMES, 'https']
          : [...ALLOWED_LOCATION_SCHEMES],
      },
    });
  } catch (error) {
    if (error instanceof EfsFault && error.code === 'MISUSE')
      return { status: 'DEPLOYMENT_INVALID' };
    throw error;
  }
  const { chainId, core } = network.definition;
  if (efs.deployment.chainId !== chainId) {
    return {
      status: 'DEPLOYMENT_MISMATCH',
      field: 'chainId',
      expected: String(chainId),
      actual: String(efs.deployment.chainId),
    };
  }
  if (efs.deployment.ledger.toLowerCase() !== core) {
    return {
      status: 'DEPLOYMENT_MISMATCH',
      field: 'core',
      expected: core,
      actual: efs.deployment.ledger.toLowerCase(),
    };
  }
  return { status: 'READY', efs };
}

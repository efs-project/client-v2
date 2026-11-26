import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EffectiveNetwork } from '../platform/settings/model.ts';
import { openReader } from './reader.ts';

const BASE = 'https://site.example/app/';

function network(deployment = 'deployments/testnet.json'): EffectiveNetwork {
  return {
    definition: {
      id: 'testnet',
      label: 'Testnet',
      chainId: 31337,
      core: '0x83ce0b9e2ddd9c5cebbfe6b2b9bc275fda9a20fb',
      deployment,
      release: 'deployments/testnet-release.json',
      rpcs: [],
      ipfsGateways: [],
      arweaveGateways: [],
    },
    rpcs: [{ url: 'https://rpc.example.net/', enabled: true }],
    ipfsGateways: [],
    arweaveGateways: [],
    customized: { rpcs: false, gateways: false },
  };
}

const respond = (body: string, status = 200) =>
  vi.fn(
    async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }),
  );

describe('openReader', () => {
  it('fetches the deployment document relative to the site, without credentials', async () => {
    const fetchImpl = respond('{}');
    await openReader(network(), BASE, new AbortController().signal, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://site.example/app/deployments/testnet.json');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('refuses a cross-origin deployment document without requesting it', async () => {
    const fetchImpl = respond('{}');
    const result = await openReader(
      network('https://elsewhere.example/deployment.json'),
      BASE,
      new AbortController().signal,
      fetchImpl,
    );
    expect(result).toEqual({ status: 'DEPLOYMENT_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an unreachable, missing or non-JSON document as unavailable', async () => {
    const signal = new AbortController().signal;
    for (const fetchImpl of [
      respond('not found', 404),
      respond('<html>fallback page</html>'),
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    ]) {
      expect(await openReader(network(), BASE, signal, fetchImpl)).toEqual({
        status: 'DEPLOYMENT_UNAVAILABLE',
      });
    }
  });

  it('lets the SDK fetch publisher https:// locations only when the person opted in', async () => {
    const deployment = readFileSync(
      `${dirname(createRequire(import.meta.url).resolve('@efs/sdk/package.json'))}/fixtures/rpc/deployment.json`,
      'utf8',
    );
    const signal = new AbortController().signal;
    const net = network();
    const off = await openReader(net, BASE, signal, respond(deployment));
    const on = await openReader(net, BASE, signal, respond(deployment), {
      publisherLocations: true,
    });
    if (off.status !== 'READY' || on.status !== 'READY') throw new Error('expected READY');
    expect(off.efs.gateways.allowSchemes).not.toContain('https');
    expect(off.efs.gateways.allowSchemes).toContain('web3');
    expect(on.efs.gateways.allowSchemes).toContain('https');
    expect(off.efs.gateways.ipfs).toEqual([]);
  });

  it('reports a document the SDK rejects as invalid', async () => {
    const result = await openReader(
      network(),
      BASE,
      new AbortController().signal,
      respond(JSON.stringify({ schema: 'not-a-deployment' })),
    );
    expect(result).toEqual({ status: 'DEPLOYMENT_INVALID' });
  });
});

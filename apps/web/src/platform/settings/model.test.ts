import { describe, expect, it } from 'vitest';
import {
  checkEndpoint,
  DEFAULT_SETTINGS,
  effectiveNetwork,
  endpointLabel,
  findNetwork,
  type NetworkDefinition,
  type OperatorConfig,
  readConfig,
  readSettings,
} from './model.ts';

const config: OperatorConfig = {
  schema: 'efs-config/1',
  defaultNetwork: 'local',
  networks: [
    {
      id: 'local',
      label: 'Local chain',
      chainId: 31337,
      core: '0x870aa1d6873256e38f82e348c23f707b7e890c1c',
      deployment: './deployments/local.json',
      release: './deployments/release.json',
      rpcs: [{ url: 'http://127.0.0.1:8545/', enabled: true }],
      ipfsGateways: [],
      arweaveGateways: [],
    },
    {
      id: 'other',
      label: 'Other',
      chainId: 11155111,
      core: '0x00000000000000000000000000000000000000aa',
      deployment: 'd.json',
      release: 'r.json',
      rpcs: [{ url: 'https://rpc.example/', enabled: true }],
      ipfsGateways: [],
      arweaveGateways: [],
    },
  ],
};

describe('checkEndpoint', () => {
  it('accepts https/wss anywhere and http/ws only on loopback', () => {
    expect(checkEndpoint('https://rpc.example/v2/KEY', 'rpc').status).toBe('VALID');
    expect(checkEndpoint('wss://rpc.example', 'rpc').status).toBe('VALID');
    expect(checkEndpoint('http://127.0.0.1:8545', 'rpc').status).toBe('VALID');
    expect(checkEndpoint('http://node.localhost:8545', 'rpc').status).toBe('VALID');
    // CSP can't allow IPv6 literals, so they are refused rather than silently blocked later.
    expect(checkEndpoint('http://[::1]:8545', 'rpc').status).toBe('INVALID');
    expect(checkEndpoint('http://rpc.example', 'rpc')).toEqual({
      status: 'INVALID',
      rule: 'insecure-remote',
    });
    expect(checkEndpoint('wss://gw.example', 'gateway')).toEqual({
      status: 'INVALID',
      rule: 'scheme',
    });
  });

  it('refuses credentials, non-URLs, other schemes and oversize input', () => {
    expect(checkEndpoint('https://user:pass@rpc.example', 'rpc')).toEqual({
      status: 'INVALID',
      rule: 'credentials',
    });
    expect(checkEndpoint('not a url', 'rpc')).toEqual({ status: 'INVALID', rule: 'url' });
    expect(checkEndpoint('javascript:alert(1)', 'rpc')).toEqual({
      status: 'INVALID',
      rule: 'scheme',
    });
    expect(checkEndpoint(`https://x.example/${'a'.repeat(3000)}`, 'rpc').status).toBe('INVALID');
  });
});

describe('endpointLabel', () => {
  it('never exposes the full URL: label or origin only', () => {
    expect(endpointLabel({ url: 'https://rpc.example/v2/SECRET', enabled: true })).toBe(
      'https://rpc.example',
    );
    expect(
      endpointLabel({ url: 'https://rpc.example/v2/SECRET', label: 'Mine', enabled: true }),
    ).toBe('Mine');
  });
});

describe('readSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readSettings(undefined)).toEqual({
      status: 'OK',
      settings: DEFAULT_SETTINGS,
      issues: [],
    });
  });

  it('preserves unknown fields and drops invalid endpoints with an issue', () => {
    const read = readSettings({
      schema: 'efs-settings/1',
      revision: 3,
      futureFeature: { keep: true },
      appearance: { mode: 'dark', theme: 'paper', density: 'compact' },
      network: {
        selected: 'local',
        overrides: {
          local: { rpcs: [{ url: 'http://evil.example' }, { url: 'https://ok.example' }] },
        },
      },
    });
    expect(read.status).toBe('OK');
    if (read.status !== 'OK') return;
    expect(read.settings.futureFeature).toEqual({ keep: true });
    expect(read.settings.appearance).toMatchObject({
      mode: 'dark',
      theme: 'paper',
      density: 'compact',
    });
    expect(read.settings.network.overrides.local?.rpcs).toEqual([
      { url: 'https://ok.example/', enabled: true },
    ]);
    expect(read.issues).toHaveLength(1);
  });

  it('marks settings from a newer client read-only instead of rewriting them', () => {
    expect(readSettings({ schema: 'efs-settings/2', revision: 9 }).status).toBe('NEWER');
    expect(readSettings({ schema: 'something-else' }).status).toBe('INVALID');
  });
});

describe('readConfig', () => {
  it('skips malformed and duplicate networks and ignores an unknown default', () => {
    const read = readConfig({
      schema: 'efs-config/1',
      defaultNetwork: 'missing',
      networks: [config.networks[0], config.networks[0], { id: 'BAD ID' }],
    });
    expect(read.status).toBe('OK');
    if (read.status !== 'OK') return;
    expect(read.config.networks.map((n) => n.id)).toEqual(['local']);
    expect(read.config.defaultNetwork).toBeUndefined();
    expect(read.issues).toHaveLength(2);
  });

  it('reads delivery: a stable origin (an origin exactly) and an isolated copy (https)', () => {
    const ok = readConfig({
      schema: 'efs-config/1',
      networks: [],
      delivery: { stableOrigin: 'https://efs.example', isolatedCopy: 'https://efs.example/app/' },
    });
    expect(ok.status === 'OK' && ok.config.delivery).toEqual({
      stableOrigin: 'https://efs.example',
      isolatedCopy: 'https://efs.example/app/',
    });
    const bad = readConfig({
      schema: 'efs-config/1',
      networks: [],
      delivery: { stableOrigin: 'https://efs.example/app/', isolatedCopy: 'http://efs.example/' },
    });
    expect(bad.status === 'OK' && bad.config.delivery).toBeUndefined();
    expect(bad.status === 'OK' && bad.issues).toHaveLength(2);
    const local = readConfig({
      schema: 'efs-config/1',
      networks: [],
      delivery: { stableOrigin: 'http://127.0.0.1:5173' },
    });
    expect(local.status === 'OK' && local.config.delivery).toEqual({
      stableOrigin: 'http://127.0.0.1:5173',
    });
  });

  it('rejects documents that are not efs-config/1', () => {
    expect(readConfig({ networks: [] }).status).toBe('INVALID');
  });

  it('requires each network to name its ledger (core), stored lowercase', () => {
    const { core: _omitted, ...noCore } = config.networks[0] as NetworkDefinition;
    const read = readConfig({
      schema: 'efs-config/1',
      networks: [noCore, { ...config.networks[1], core: `0x${'AB'.repeat(20)}` }],
    });
    if (read.status !== 'OK') throw new Error('expected OK');
    expect(read.config.networks.map((n) => n.id)).toEqual(['other']);
    expect(read.config.networks[0]?.core).toBe(`0x${'ab'.repeat(20)}`);
    expect(read.issues).toHaveLength(1);
  });
});

describe('readSettings content', () => {
  it('fetching from publisher addresses is off unless explicitly true', () => {
    for (const value of [undefined, 'yes', 1, false]) {
      const read = readSettings({
        schema: 'efs-settings/1',
        content: { publisherLocations: value },
      });
      expect(read.status === 'OK' && read.settings.content.publisherLocations).toBe(false);
    }
    const on = readSettings({ schema: 'efs-settings/1', content: { publisherLocations: true } });
    expect(on.status === 'OK' && on.settings.content.publisherLocations).toBe(true);
  });
});

describe('findNetwork', () => {
  it('resolves an alias by id and the full form by chain id and ledger', () => {
    expect(findNetwork(config, { kind: 'alias', id: 'other' })?.id).toBe('other');
    expect(
      findNetwork(config, {
        kind: 'full',
        chainId: 31337,
        ledger: '0x870aa1d6873256e38f82e348c23f707b7e890c1c',
      })?.id,
    ).toBe('local');
    expect(findNetwork(config, { kind: 'alias', id: 'mainnet' })).toBeUndefined();
    expect(
      findNetwork(config, {
        kind: 'full',
        chainId: 1,
        ledger: '0x870aa1d6873256e38f82e348c23f707b7e890c1c',
      }),
    ).toBeUndefined();
  });
});

describe('effectiveNetwork', () => {
  it('uses the operator default, then the user selection and endpoint overrides', () => {
    expect(effectiveNetwork(config, DEFAULT_SETTINGS)?.definition.id).toBe('local');
    const chosen = effectiveNetwork(config, {
      ...DEFAULT_SETTINGS,
      network: {
        selected: 'other',
        overrides: {
          other: {
            rpcs: [
              { url: 'http://127.0.0.1:8545/', enabled: true },
              { url: 'https://off.example/', enabled: false },
            ],
          },
        },
      },
    });
    expect(chosen?.definition.id).toBe('other');
    expect(chosen?.rpcs.map((e) => e.url)).toEqual(['http://127.0.0.1:8545/']);
    expect(chosen?.customized).toEqual({ rpcs: true, gateways: false });
  });

  it('reports no network when the operator configured none', () => {
    expect(
      effectiveNetwork({ schema: 'efs-config/1', networks: [] }, DEFAULT_SETTINGS),
    ).toBeUndefined();
  });
});

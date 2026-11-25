import { describe, expect, it } from 'vitest';
import { CHAIN_IDS, devIdentity, RPC_PORTS, UI_PORTS } from './identity.ts';

describe('devIdentity', () => {
  it('is sticky: the same path always gets the same ports and chain id', () => {
    expect(devIdentity('/Users/me/Code/EFS/client-v2')).toEqual(
      devIdentity('/Users/me/Code/EFS/client-v2'),
    );
  });

  it('stays inside the planned ranges, and differs between worktrees', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const id = devIdentity(`/work/tree-${i}`);
      expect(id.uiPort).toBeGreaterThanOrEqual(UI_PORTS.first);
      expect(id.uiPort).toBeLessThan(UI_PORTS.first + UI_PORTS.count);
      expect(id.rpcPort).toBeGreaterThanOrEqual(RPC_PORTS.first);
      expect(id.rpcPort).toBeLessThan(RPC_PORTS.first + RPC_PORTS.count);
      expect(id.chainId).toBeGreaterThanOrEqual(CHAIN_IDS.first);
      expect(id.chainId).toBeLessThan(CHAIN_IDS.first + CHAIN_IDS.count);
      seen.add(id.chainId);
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('takes port overrides from the environment, and refuses nonsense', () => {
    const id = devIdentity('/w', { uiPort: '6001', rpcPort: '9001' });
    expect([id.uiPort, id.rpcPort]).toEqual([6001, 9001]);
    expect(() => devIdentity('/w', { uiPort: 'eighty' })).toThrow(/EFS_DEV_UI_PORT/);
    expect(() => devIdentity('/w', { rpcPort: '80' })).toThrow(/EFS_DEV_RPC_PORT/);
  });
});

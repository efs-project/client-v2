// A worktree's sticky local-dev identity: its UI port, RPC port and chain id, derived from the
// worktree's real path, so the same checkout always gets the same URLs (and a wallet sees the
// same network) across restarts, and two worktrees almost never collide. Pure, so it's tested.

import { createHash } from 'node:crypto';

/** The ranges from the initialization plan (§5.3), checked against chainlist for the chain ids. */
export const UI_PORTS = { first: 5174, count: 26 } as const;
export const RPC_PORTS = { first: 8546, count: 54 } as const;
export const CHAIN_IDS = { first: 3_133_701, count: 99 } as const;

export interface DevIdentity {
  readonly uiPort: number;
  readonly rpcPort: number;
  readonly chainId: number;
  /** A short stable tag for names and messages ("efs-dev-1a2b3c"). */
  readonly tag: string;
}

export interface IdentityOverrides {
  readonly uiPort?: string | undefined;
  readonly rpcPort?: string | undefined;
}

const port = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65_535) {
    throw new Error(`${name} must be a port number from 1024 to 65535 (got ${value})`);
  }
  return n;
};

/** The identity for the worktree at `realPath` (resolve symlinks first), with env overrides. */
export function devIdentity(realPath: string, overrides: IdentityOverrides = {}): DevIdentity {
  const digest = createHash('sha256').update(realPath).digest();
  const n = digest.readUInt32BE(0);
  return {
    uiPort: port(overrides.uiPort, UI_PORTS.first + (n % UI_PORTS.count), 'EFS_DEV_UI_PORT'),
    rpcPort: port(overrides.rpcPort, RPC_PORTS.first + (n % RPC_PORTS.count), 'EFS_DEV_RPC_PORT'),
    chainId: CHAIN_IDS.first + (n % CHAIN_IDS.count),
    tag: `efs-dev-${digest.subarray(0, 3).toString('hex')}`,
  };
}

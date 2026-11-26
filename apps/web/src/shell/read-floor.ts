// "The test chain was reset? Start over" (sdk-v2 7db4417, the read floor). A read is never served
// from a block older than one this client already read; a local test chain that was reset or
// restarted is shorter than that floor, so every read stays UNKNOWN BEHIND. On a local test chain
// only (every enabled endpoint on this computer), the person can forget the floor and read again.
// Never on a live chain: there a stuck endpoint would then serve old reads again, which is the
// exact failure the floor exists to prevent.

import type { EffectiveNetwork } from '../platform/settings/model.ts';
import { onLocalChain } from '../platform/settings/model.ts';
import type { NetworkState } from './network-state.ts';
import { type ReaderState, verifiedEfs } from './reader-state.ts';

/** Forgets the read floor of the verified session, on a local test chain only; else none. */
export function readFloorReset(
  network: NetworkState,
  reader: ReaderState,
): (() => void) | undefined {
  const selected: EffectiveNetwork | undefined = 'network' in network ? network.network : undefined;
  if (!selected || !onLocalChain(selected)) return undefined;
  const efs = verifiedEfs(reader);
  return efs ? () => efs.resetReadFloor() : undefined;
}

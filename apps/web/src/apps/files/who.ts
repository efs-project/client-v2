// How an author is named in the File Browser: through the SDK's displayOf, which knows a key
// principal is a padded address (and a contract's isn't). An address shows as its EIP-55 short
// form ("0xf39F…2266"); anything else as its principal's short id. Pure, no reads.

import type { Address, Efs } from '@efs/sdk';
import { shortAccount } from '../../shell/wallet-state.ts';

/** "0x0000…2266": enough to tell ids apart, in full in the title. */
export const shortId = (id: string): string =>
  id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;

/**
 * `principal` as the app shows it. `contracts`: addresses that may act here as contracts (an
 * address view passes its own), so a contract's principal reads as its address too. `names`:
 * names by lowercase address, shown beside it (the local test chain's dev accounts only:
 * "Satoshi Nakamoto · 0xf39F…2266").
 */
export function authorLabel(
  efs: Efs | undefined,
  principal: string,
  contracts?: readonly string[],
  names?: ReadonlyMap<string, string>,
): string {
  if (!efs) return shortId(principal);
  const d = efs.lens.displayOf(
    principal as never,
    contracts ? { contracts: contracts as readonly Address[] } : undefined,
  );
  if (d.kind === 'principal') return shortId(d.id);
  const name = names?.get(d.address.toLowerCase());
  return name ? `${name} · ${shortAccount(d.address)}` : shortAccount(d.address);
}

// The tab's writer: the SDK's write lifecycle for the connected account, created only when the
// person saves. It needs a verified reader session (reads and writes share one pinned SDK
// instance), a connected wallet, and the wallet on the network in view. The journal is the SDK's
// IndexedDB one, which creates storage only at the first real submission.

import type { Address } from '@efs/sdk';
import type { EfsWriter } from '@efs/sdk/actions';
import { computed, type ReadonlySignal } from '../state/signals.ts';
import type { NetworkState } from './network-state.ts';
import { type ReaderState, verifiedEfs } from './reader-state.ts';
import type { WalletState } from './wallet-state.ts';

export type WriterAvailability =
  /** Served from a shared IPFS path gateway: saving is off (docs/design/offline-brief.md §2). */
  | { readonly status: 'SHARED_GATEWAY' }
  /** No verified reader session: nothing can be saved. */
  | { readonly status: 'NO_SESSION' }
  | { readonly status: 'NO_WALLET' }
  | { readonly status: 'WRONG_CHAIN'; readonly wanted: number; readonly actual: number }
  | { readonly status: 'READY'; readonly account: string };

export interface WriterSession {
  readonly availability: ReadonlySignal<WriterAvailability>;
  /** The writer for the connected account, created on first use; undefined unless READY. */
  writer(): Promise<EfsWriter | undefined>;
}

type ActionsModule = typeof import('@efs/sdk/actions');
type JournalModule = typeof import('@efs/sdk/web/journal');

export interface WriterSessionOptions {
  readonly loadActions?: () => Promise<ActionsModule>;
  readonly loadJournal?: () => Promise<JournalModule>;
  /** True on a shared IPFS path gateway: never a writer. */
  readonly sharedGateway?: boolean;
}

export function createWriterSession(
  reader: ReadonlySignal<ReaderState>,
  wallet: ReadonlySignal<WalletState>,
  network: ReadonlySignal<NetworkState>,
  {
    loadActions = () => import('@efs/sdk/actions'),
    loadJournal = () => import('@efs/sdk/web/journal'),
    sharedGateway = false,
  }: WriterSessionOptions = {},
): WriterSession {
  const availability = computed<WriterAvailability>(() => {
    if (sharedGateway) return { status: 'SHARED_GATEWAY' };
    if (!verifiedEfs(reader.get())) return { status: 'NO_SESSION' };
    const w = wallet.get();
    if (w.status !== 'CONNECTED') return { status: 'NO_WALLET' };
    const n = network.get();
    const wanted = 'network' in n ? n.network.definition.chainId : undefined;
    if (wanted !== undefined && wanted !== w.chainId) {
      return { status: 'WRONG_CHAIN', wanted, actual: w.chainId };
    }
    return { status: 'READY', account: w.account };
  });

  let cached:
    | { efs: object; provider: object; account: string; writer: Promise<EfsWriter> }
    | undefined;

  return {
    availability,
    async writer() {
      const efs = verifiedEfs(reader.get());
      const w = wallet.get();
      if (!efs || w.status !== 'CONNECTED' || availability.get().status !== 'READY')
        return undefined;
      // One writer per (SDK instance, wallet provider, account): any change makes a new one.
      if (
        cached &&
        cached.efs === efs &&
        cached.provider === w.option.provider &&
        cached.account === w.account
      ) {
        return cached.writer;
      }
      const writer = (async () => {
        const [{ createWriter }, { indexedDbJournal }] = await Promise.all([
          loadActions(),
          loadJournal(),
        ]);
        // The account named explicitly: the writer signs as exactly the account shown and cached
        // on, never whatever the wallet lists first later.
        return createWriter(efs, {
          authorizer: {
            kind: 'eip1193',
            profile: 'direct',
            provider: w.option.provider,
            account: w.account as Address,
          },
          journal: indexedDbJournal(),
        });
      })();
      cached = { efs, provider: w.option.provider, account: w.account, writer };
      try {
        return await writer;
      } catch (error) {
        cached = undefined;
        throw error;
      }
    },
  };
}

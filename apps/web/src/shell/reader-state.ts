// The tab's reader session: one SDK instance for the effective network, opened lazily and
// pinned before anything is read through it. It is rebuilt whenever the network or the user's
// endpoint lists change (creation does no I/O; the SDK caches nothing across instances yet).
// Created by boot and passed explicitly; there is no module-level instance.
//
// Only `import type` from the SDK appears here: the SDK itself loads with session/reader.ts,
// a lazy chunk, so it never enters the startup set.

import type { Efs, PinResult } from '@efs/sdk';
import type { OwnerScope } from '../platform/scope.ts';
import type { EffectiveNetwork } from '../platform/settings/model.ts';
import type { ReaderOpen } from '../session/reader.ts';
import { effect } from '../state/effect.ts';
import { type ReadonlySignal, state } from '../state/signals.ts';
import type { NetworkState } from './network-state.ts';

export type ReaderState =
  /** No usable network (none configured, config invalid, or every RPC turned off). */
  | { readonly status: 'OFF' }
  /** Loading the SDK and the deployment document. */
  | { readonly status: 'OPENING' }
  /** Verifying the deployment against the chain. Nothing is read before this settles. */
  | { readonly status: 'PINNING'; readonly efs: Efs }
  /** Pinned: `pin.status` says whether reads may be trusted (only VERIFIED). */
  | { readonly status: 'PINNED'; readonly efs: Efs; readonly pin: PinResult }
  | Exclude<ReaderOpen, { readonly status: 'READY' }>
  /** The SDK's chunk didn't load (blocked or offline). */
  | { readonly status: 'LOAD_FAILED' };

export interface ReaderSession {
  readonly state: ReadonlySignal<ReaderState>;
  /**
   * Tries again after an UNKNOWN pin or a failed open, with the same configuration. After
   * LOAD_FAILED it reloads the page: browsers keep a failed module fetch, so re-importing in the
   * same page can never succeed.
   */
  retry(): void;
}

type Loader = () => Promise<typeof import('../session/reader.ts')>;

export interface ReaderSessionOptions {
  readonly load?: Loader;
  readonly reload?: () => void;
  /** The person's "also fetch from publishers' own addresses" setting. */
  readonly publisherLocations?: ReadonlySignal<boolean>;
}

/** Everything the SDK is configured from, so an unrelated settings change doesn't rebuild it. */
function configKey(network: EffectiveNetwork): string {
  const { definition, rpcs, ipfsGateways, arweaveGateways } = network;
  const urls = (list: readonly { url: string; label?: string }[]) =>
    list.map((e) => [e.url, e.label ?? '']);
  return JSON.stringify([
    definition.id,
    definition.chainId,
    definition.deployment,
    urls(rpcs),
    urls(ipfsGateways),
    urls(arweaveGateways),
  ]);
}

export function createReaderSession(
  network: ReadonlySignal<NetworkState>,
  base: string,
  scope: OwnerScope,
  {
    load = () => import('../session/reader.ts'),
    reload = () => location.reload(),
    publisherLocations = { get: () => false },
  }: ReaderSessionOptions = {},
): ReaderSession {
  const current = state<ReaderState>({ status: 'OFF' });
  let key: string | undefined;
  let active: { network: EffectiveNetwork; publisher: boolean; run: OwnerScope } | undefined;

  const pin = async (efs: Efs, run: OwnerScope): Promise<void> => {
    current.set({ status: 'PINNING', efs });
    const result = await efs.pin({ signal: run.signal });
    if (!run.signal.aborted) current.set({ status: 'PINNED', efs, pin: result });
  };

  const open = (next: EffectiveNetwork, publisher: boolean): void => {
    active?.run.dispose();
    const run = scope.child();
    active = { network: next, publisher, run };
    current.set({ status: 'OPENING' });
    void (async () => {
      try {
        const module = await load();
        const opened = await module.openReader(next, base, run.signal, fetch, {
          publisherLocations: publisher,
        });
        if (run.signal.aborted) return;
        if (opened.status !== 'READY') {
          current.set(opened);
          return;
        }
        await pin(opened.efs, run);
      } catch (error) {
        if (run.signal.aborted) return;
        console.error(error);
        current.set({ status: 'LOAD_FAILED' });
      }
    })();
  };

  const close = (): void => {
    active?.run.dispose();
    active = undefined;
    current.set({ status: 'OFF' });
  };

  effect(scope, () => {
    const now = network.get();
    const next = now.status === 'CONFIGURED' ? now.network : undefined;
    const publisher = publisherLocations.get();
    const nextKey = next ? `${configKey(next)}|${publisher}` : undefined;
    if (nextKey === key) return;
    key = nextKey;
    // Signal writes happen outside the effect's own evaluation.
    queueMicrotask(() => {
      if (scope.signal.aborted) return;
      if (next) open(next, publisher);
      else close();
    });
  });

  return {
    state: current,
    retry() {
      const now = current.get();
      if (now.status === 'LOAD_FAILED') {
        reload();
        return;
      }
      if (!active) return;
      if (now.status === 'PINNED' && now.pin.status === 'UNKNOWN') {
        const { run } = active;
        pin(now.efs, run).catch((error: unknown) => {
          if (run.signal.aborted) return;
          console.error(error);
          current.set({ status: 'LOAD_FAILED' });
        });
      } else if (now.status !== 'OPENING' && now.status !== 'PINNING' && now.status !== 'OFF') {
        open(active.network, active.publisher);
      }
    },
  };
}

/** The SDK instance only when its deployment is verified; reads must not run otherwise. */
export function verifiedEfs(state: ReaderState): Efs | undefined {
  return state.status === 'PINNED' && state.pin.status === 'VERIFIED' ? state.efs : undefined;
}

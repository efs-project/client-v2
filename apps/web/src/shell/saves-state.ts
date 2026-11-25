// Saves that outlive a page: on a verified session the tab settles interrupted saves silently,
// with no wallet, and lists what is still open ("Partially saved (2 of 5) — Continue") or still
// confirming ("Saved · confirming"). Only Continue (a writer, after Connect) can prompt.
//
// Readers who never saved pay nothing: the small journal module answers "is anything open?"
// without creating storage, and the SDK's write code loads only when the answer is yes.

import type { Efs } from '@efs/sdk';
import type { SequenceProgress } from '@efs/sdk/actions';
import type { OwnerScope } from '../platform/scope.ts';
import { effect } from '../state/effect.ts';
import { type ReadonlySignal, state } from '../state/signals.ts';
import { type ReaderState, verifiedEfs } from './reader-state.ts';

export type SavesState =
  /** No verified session yet, or nothing has ever been saved from this browser. */
  | { readonly status: 'IDLE' }
  | { readonly status: 'CHECKING' }
  /** Open saves for this deployment, newest first: incomplete ones and ones still confirming. */
  | { readonly status: 'READY'; readonly saves: readonly SequenceProgress[] }
  | { readonly status: 'LOAD_FAILED' };

export interface SavesSession {
  readonly state: ReadonlySignal<SavesState>;
  /** Re-reads and settles open saves (after a save, a reconnect, or "Check again"). */
  refresh(): void;
}

type JournalModule = typeof import('@efs/sdk/web/journal');
type ActionsModule = typeof import('@efs/sdk/actions');

export interface SavesSessionOptions {
  readonly loadJournal?: () => Promise<JournalModule>;
  readonly loadActions?: () => Promise<ActionsModule>;
  /** How often a "Saved · confirming" save is re-checked until final (ms). */
  readonly confirmEveryMs?: number;
}

/**
 * A save the person must act on or wait for. COMPLETE + final is done and drops off; ABANDONED
 * was their choice. NOT_STARTED stays (shown as "not sent"), so an edit is never silently lost.
 */
export const needsAttention = (p: SequenceProgress): boolean =>
  !(p.state === 'COMPLETE' && p.final) && p.state !== 'ABANDONED';

export function createSavesSession(
  reader: ReadonlySignal<ReaderState>,
  scope: OwnerScope,
  {
    loadJournal = () => import('@efs/sdk/web/journal'),
    loadActions = () => import('@efs/sdk/actions'),
    confirmEveryMs = 12_000,
  }: SavesSessionOptions = {},
): SavesSession {
  const current = state<SavesState>({ status: 'IDLE' });
  let run: OwnerScope | undefined;
  let active: Efs | undefined;

  const check = (efs: Efs): void => {
    run?.dispose();
    const mine = scope.child();
    run = mine;
    void (async () => {
      try {
        const { indexedDbJournal } = await loadJournal();
        const journal = indexedDbJournal();
        mine.defer(() => journal.close());
        // Cheap and non-creating: most visitors have never saved anything.
        if ((await journal.openSequences()).length === 0) {
          if (!mine.signal.aborted) current.set({ status: 'IDLE' });
          return;
        }
        if (mine.signal.aborted) return;
        current.set({ status: 'CHECKING' });
        const { openJournal } = await loadActions();
        const view = openJournal(efs, { journal });
        const listed = await view.pendingSequences();
        // Settle what can be settled without anyone: in-flight parts and confirming saves.
        const settled = await Promise.all(
          listed.map((p) =>
            p.state === 'IN_FLIGHT' || (p.state === 'COMPLETE' && !p.final)
              ? // Aborted with this run: a superseded session (new endpoints, another network)
                // stops reading the chain at once, rather than finishing against the old one.
                view.reconcileSequence(p.sequenceId, { signal: mine.signal })
              : Promise.resolve(p),
          ),
        );
        if (mine.signal.aborted) return;
        const saves = settled.filter(needsAttention);
        current.set(saves.length > 0 ? { status: 'READY', saves } : { status: 'IDLE' });
        if (saves.some((p) => p.state === 'COMPLETE' || p.state === 'IN_FLIGHT')) {
          const timer = setTimeout(() => {
            if (!mine.signal.aborted) check(efs);
          }, confirmEveryMs);
          mine.defer(() => clearTimeout(timer));
        }
      } catch (error) {
        if (mine.signal.aborted) return;
        console.error(error);
        current.set({ status: 'LOAD_FAILED' });
      }
    })();
  };

  effect(scope, () => {
    const efs = verifiedEfs(reader.get());
    if (efs === active) return;
    active = efs;
    queueMicrotask(() => {
      if (scope.signal.aborted) return;
      if (efs) check(efs);
      else {
        run?.dispose();
        current.set({ status: 'IDLE' });
      }
    });
  });

  return {
    state: current,
    refresh() {
      if (active) check(active);
    },
  };
}

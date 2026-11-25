// Saves that outlive a page: on a verified session the tab settles interrupted saves silently,
// with no wallet, and lists what is still open ("Partially saved (2 of 5) — Continue") or still
// confirming ("Saved · confirming"). Only Continue (a writer, after Connect) can prompt.
//
// Readers who never saved pay nothing: the small journal module answers "is anything open?"
// without creating storage, and the SDK's write code loads only when the answer is yes.
//
// After the wallet answers, the save belongs here: the editor hands its progress over (`track`)
// and this session carries it to "Saved", across reloads, in one place. A save that turns final
// in this tab stays listed as "Saved" until the person dismisses it; one only seen as final
// (settled in another tab, or before this tab watched it) simply drops off.

import type { Efs, Hex } from '@efs/sdk';
import type { SequenceProgress } from '@efs/sdk/actions';
import type { OwnerScope } from '../platform/scope.ts';
import { effect } from '../state/effect.ts';
import { type ReadonlySignal, state } from '../state/signals.ts';
import { type ReaderState, verifiedEfs } from './reader-state.ts';

export type SavesState =
  /** No verified session yet, or nothing to show. */
  | { readonly status: 'IDLE' }
  | { readonly status: 'CHECKING' }
  /** Saves for this deployment, newest first: open, confirming, or just saved in this tab. */
  | { readonly status: 'READY'; readonly saves: readonly SequenceProgress[] }
  | { readonly status: 'LOAD_FAILED' };

export interface SavesSession {
  readonly state: ReadonlySignal<SavesState>;
  /** Re-reads and settles open saves (after a reconnect, or "Check again"). */
  refresh(): void;
  /** A save's latest progress, straight from the writer: shown now, settled from here on. */
  track(progress: SequenceProgress): void;
  /** Hides a finished ("Saved") save. */
  dismiss(sequenceId: Hex): void;
}

type JournalModule = typeof import('@efs/sdk/web/journal');
type ActionsModule = typeof import('@efs/sdk/actions');

export interface SavesSessionOptions {
  readonly loadJournal?: () => Promise<JournalModule>;
  readonly loadActions?: () => Promise<ActionsModule>;
  /** How often a "Saved · confirming" save is re-checked until final (ms). */
  readonly confirmEveryMs?: number;
  /** How often a sent save the network hasn't decided yet is re-checked (ms). */
  readonly settleEveryMs?: number;
}

/**
 * A save the person must act on or wait for. COMPLETE + final is done; ABANDONED was their
 * choice. NOT_STARTED stays (shown as "not sent"), so an edit is never silently lost.
 */
export const needsAttention = (p: SequenceProgress): boolean =>
  !(p.state === 'COMPLETE' && p.final) && p.state !== 'ABANDONED';

/** Settled by the ledger alone, no wallet: a part in flight, or a save waiting to be final. */
const settlesByItself = (p: SequenceProgress): boolean =>
  p.state === 'IN_FLIGHT' || (p.state === 'COMPLETE' && !p.final);

export function createSavesSession(
  reader: ReadonlySignal<ReaderState>,
  scope: OwnerScope,
  {
    loadJournal = () => import('@efs/sdk/web/journal'),
    loadActions = () => import('@efs/sdk/actions'),
    confirmEveryMs = 12_000,
    settleEveryMs = 4_000,
  }: SavesSessionOptions = {},
): SavesSession {
  const current = state<SavesState>({ status: 'IDLE' });
  let run: OwnerScope | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Efs | undefined;
  /** Saves this tab has shown, so their becoming final is shown as "Saved". */
  const watched = new Set<Hex>();
  /** Saves that became final while watched: listed as "Saved" until dismissed. */
  const finals = new Map<Hex, SequenceProgress>();
  /** The open saves last read, in display order. */
  let open: SequenceProgress[] = [];

  const publish = (): void => {
    for (const p of open) watched.add(p.sequenceId);
    const done = [...finals.values()].filter(
      (f) => !open.some((o) => o.sequenceId === f.sequenceId),
    );
    const saves = [...open, ...done];
    current.set(saves.length > 0 ? { status: 'READY', saves } : { status: 'IDLE' });
  };

  const schedule = (efs: Efs, saves: readonly SequenceProgress[]): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const every = saves.some((p) => p.state === 'IN_FLIGHT')
      ? settleEveryMs
      : saves.some((p) => p.state === 'COMPLETE' && !p.final)
        ? confirmEveryMs
        : undefined;
    if (every === undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!scope.signal.aborted && active === efs) check(efs);
    }, every);
  };
  scope.defer(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  const check = (efs: Efs): void => {
    run?.dispose();
    const mine = scope.child();
    run = mine;
    void (async () => {
      try {
        const { indexedDbJournal } = await loadJournal();
        const journal = indexedDbJournal();
        mine.defer(() => journal.close());
        const unresolved = [...watched].filter((id) => !finals.has(id));
        // Cheap and non-creating: most visitors have never saved anything.
        if ((await journal.openSequences()).length === 0 && unresolved.length === 0) {
          if (mine.signal.aborted) return;
          open = [];
          publish();
          return;
        }
        if (mine.signal.aborted) return;
        if (current.get().status !== 'READY') current.set({ status: 'CHECKING' });
        const { openJournal } = await loadActions();
        const view = openJournal(efs, { journal });
        const listed = await view.pendingSequences();
        // Aborted with this run: a superseded session (new endpoints, another network) stops
        // reading the chain at once, rather than finishing against the old one. One save that
        // can't be read right now keeps its last known progress; it never hides the others.
        const settle = (p: SequenceProgress) =>
          settlesByItself(p)
            ? view.reconcileSequence(p.sequenceId, { signal: mine.signal }).catch(() => p)
            : Promise.resolve(p);
        const settled = await Promise.all(listed.map(settle));
        // A watched save no longer listed finished (or was abandoned) since the last look.
        const gone = await Promise.all(
          unresolved
            .filter((id) => !listed.some((p) => p.sequenceId === id))
            .map((id) =>
              view.reconcileSequence(id, { signal: mine.signal }).catch(() => undefined),
            ),
        );
        if (mine.signal.aborted) return;
        for (const p of [...settled, ...gone]) {
          if (!p || needsAttention(p)) continue;
          if (p.state === 'COMPLETE' && watched.has(p.sequenceId)) finals.set(p.sequenceId, p);
          else watched.delete(p.sequenceId);
        }
        open = settled.filter(needsAttention);
        publish();
        schedule(efs, open);
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
      // Another deployment's saves are not this one's.
      watched.clear();
      finals.clear();
      open = [];
      if (efs) check(efs);
      else {
        run?.dispose();
        if (timer !== undefined) clearTimeout(timer);
        current.set({ status: 'IDLE' });
      }
    });
  });

  return {
    state: current,
    refresh() {
      if (active) check(active);
    },
    track(progress) {
      const efs = active;
      if (!efs) return;
      watched.add(progress.sequenceId);
      open = open.filter((p) => p.sequenceId !== progress.sequenceId);
      if (needsAttention(progress)) open = [progress, ...open];
      else if (progress.state === 'COMPLETE') finals.set(progress.sequenceId, progress);
      else watched.delete(progress.sequenceId);
      publish();
      schedule(efs, open);
    },
    dismiss(sequenceId) {
      finals.delete(sequenceId);
      if (!open.some((p) => p.sequenceId === sequenceId)) watched.delete(sequenceId);
      publish();
    },
  };
}

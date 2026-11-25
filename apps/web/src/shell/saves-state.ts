// Saves that outlive a page: on a verified session the tab settles interrupted saves silently,
// with no wallet, and lists what is still open ("Partially saved (2 of 5) — Continue") or still
// confirming ("Saved · confirming"). Only Continue (a writer, after Connect) can prompt.
//
// Readers who never saved pay nothing: the small journal module answers "is anything open?"
// without creating storage, and the SDK's write code loads only when the answer is yes. Reads
// never need the journal: where this browser refuses it, there is simply nothing to show (saving
// says it's off when someone tries).
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
import { isFault } from './save-outcome.ts';

export type SavesState =
  /** No verified session yet, or nothing to show. */
  | { readonly status: 'IDLE' }
  | { readonly status: 'CHECKING' }
  /** Saves for this deployment, newest first: open, confirming, or just saved in this tab. */
  | { readonly status: 'READY'; readonly saves: readonly SequenceProgress[] }
  | { readonly status: 'LOAD_FAILED' };

/** The edit a save was made from, kept in this tab's memory only (never stored). */
export interface Draft {
  /** The route to come back to (`#/r/<realm>/<link>`). */
  readonly route: string;
  /** The file's canonical link, to recognize it when it's open again. */
  readonly link: string;
  readonly text: string;
}

export interface SavesSession {
  readonly state: ReadonlySignal<SavesState>;
  /**
   * Re-reads and settles open saves (after a reconnect, an unconfirmed send, "Check again").
   * Resolves once a check started by this call (or a later one) has finished reading.
   */
  refresh(): Promise<void>;
  /** A save's latest progress, straight from the writer: shown now, settled from here on. */
  track(progress: SequenceProgress, draft?: Draft): void;
  /** Hides a finished ("Saved") save. */
  dismiss(sequenceId: Hex): void;
  /** The edit a save was made from, while this tab still holds it. */
  draftOf(sequenceId: Hex): Draft | undefined;
  /** "Review changes": the draft to put back in the editor once its file is on screen. */
  readonly reopening: ReadonlySignal<Draft | undefined>;
  reopen(draft: Draft): void;
  /** Takes the pending reopen if it is for `link`. */
  takeReopen(link: string): Draft | undefined;
  /** When an in-flight save's current part expires (unix seconds), as its plan says. */
  deadlineOf(sequenceId: Hex): number | undefined;
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

/** Not yet saved: blocks starting another save for the same account (it could double-write). */
export const unsettled = (p: SequenceProgress): boolean =>
  p.state === 'IN_FLIGHT' || p.state === 'PARTIAL' || p.state === 'NOT_STARTED';

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
  const reopening = state<Draft | undefined>(undefined);
  let run: OwnerScope | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Efs | undefined;
  /** Saves this tab has shown, so their becoming final is shown as "Saved". */
  const watched = new Set<Hex>();
  /** Saves that became final while watched: listed as "Saved" until dismissed. */
  const finals = new Map<Hex, SequenceProgress>();
  const drafts = new Map<Hex, Draft>();
  /** Progress handed over by `track`, with the generation it arrived in. */
  const tracked = new Map<Hex, { readonly progress: SequenceProgress; readonly at: number }>();
  let generation = 0;
  /** The open saves, in display order. */
  let open: SequenceProgress[] = [];
  /** Each in-flight save's current part deadline (unix seconds), read from its journaled plan. */
  const deadlines = new Map<Hex, number>();
  /** Checks started and finished, so `refresh()` can wait for the one it started. */
  let started = 0;
  let finished = 0;
  let waiters: { readonly at: number; readonly resolve: () => void }[] = [];
  const settleWaiters = (): void => {
    const ready = waiters.filter((w) => w.at <= finished);
    waiters = waiters.filter((w) => w.at > finished);
    for (const w of ready) w.resolve();
  };
  const finish = (id: number): void => {
    finished = Math.max(finished, id);
    settleWaiters();
  };
  scope.defer(() => {
    finished = started;
    settleWaiters();
  });

  const publish = (): void => {
    for (const p of open) watched.add(p.sequenceId);
    const done = [...finals.values()].filter(
      (f) => !open.some((o) => o.sequenceId === f.sequenceId),
    );
    const saves = [...open, ...done];
    current.set(saves.length > 0 ? { status: 'READY', saves } : { status: 'IDLE' });
  };

  const forget = (id: Hex): void => {
    watched.delete(id);
    tracked.delete(id);
    drafts.delete(id);
    deadlines.delete(id);
  };

  const schedule = (efs: Efs): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const every = open.some((p) => p.state === 'IN_FLIGHT')
      ? settleEveryMs
      : open.some((p) => p.state === 'COMPLETE' && !p.final)
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

  /**
   * The open list after a check that started at generation `since`: what the listing found, except
   * that progress handed over since then is newer than the listing and wins (or is added).
   */
  const merge = (listing: readonly SequenceProgress[], since: number): SequenceProgress[] => {
    const newer = [...tracked.values()].filter((t) => t.at > since).map((t) => t.progress);
    const ids = new Set(newer.map((p) => p.sequenceId));
    return [...newer.filter(needsAttention), ...listing.filter((p) => !ids.has(p.sequenceId))];
  };

  const check = (efs: Efs): void => {
    run?.dispose();
    const mine = scope.child();
    run = mine;
    const since = generation;
    const id = ++started;
    void (async () => {
      try {
        const { indexedDbJournal } = await loadJournal();
        const journal = indexedDbJournal();
        mine.defer(() => journal.close());
        const unresolved = [...watched].filter((id) => !finals.has(id));
        // Cheap and non-creating: most visitors have never saved anything.
        if ((await journal.openSequences()).length === 0 && unresolved.length === 0) {
          if (mine.signal.aborted) return;
          open = merge([], since);
          publish();
          schedule(efs);
          finish(id);
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
            ? view.reconcileSequence(p.sequenceId, { signal: mine.signal }).catch((error) => {
                if (!mine.signal.aborted) console.warn('save not settled yet', p.sequenceId, error);
                return p;
              })
            : Promise.resolve(p);
        const settled = await Promise.all(listed.map(settle));
        // A watched save no longer listed finished (or was abandoned) since the last look.
        const gone = await Promise.all(
          unresolved
            .filter((id) => !listed.some((p) => p.sequenceId === id))
            .map((id) =>
              view.reconcileSequence(id, { signal: mine.signal }).catch((error) => {
                if (!mine.signal.aborted) console.warn('save not found again', id, error);
                return undefined;
              }),
            ),
        );
        if (mine.signal.aborted) return;
        for (const p of [...settled, ...gone]) {
          if (!p || needsAttention(p)) continue;
          if (p.state === 'COMPLETE' && watched.has(p.sequenceId)) finals.set(p.sequenceId, p);
          else forget(p.sequenceId);
        }
        open = merge(settled.filter(needsAttention), since);
        // The deadline of each in-flight part, from its journaled plan: how long a hold lasts.
        for (const p of open) {
          const planId = p.state === 'IN_FLIGHT' ? p.current?.planId : undefined;
          if (!planId || deadlines.has(p.sequenceId)) continue;
          const record = await journal.get(planId).catch(() => undefined);
          if (record) deadlines.set(p.sequenceId, Number(record.plan.deadline));
        }
        if (mine.signal.aborted) return;
        publish();
        schedule(efs);
        finish(id);
      } catch (error) {
        if (mine.signal.aborted) return;
        if (isFault(error, 'JOURNAL_UNAVAILABLE')) {
          console.info('save journal unavailable in this browser', error);
          // Nothing shown or handed over yet: reading doesn't need the journal, so no banner
          // (saving says it's off if someone tries). Otherwise keep what's shown, and keep
          // checking: a save already sent is still settled from the ledger next time.
          open = merge(open, since);
          publish();
          if (open.length > 0) schedule(efs);
          finish(id);
          return;
        }
        console.error(error);
        current.set({ status: 'LOAD_FAILED' });
        finish(id);
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
      tracked.clear();
      drafts.clear();
      deadlines.clear();
      open = [];
      if (efs) check(efs);
      else {
        run?.dispose();
        if (timer !== undefined) clearTimeout(timer);
        current.set({ status: 'IDLE' });
        finished = started;
        settleWaiters();
      }
    });
  });

  return {
    state: current,
    reopening,
    refresh() {
      if (!active) return Promise.resolve();
      check(active);
      const at = started;
      return new Promise<void>((resolve) => {
        waiters.push({ at, resolve });
        settleWaiters();
      });
    },
    deadlineOf: (sequenceId) => deadlines.get(sequenceId),
    track(progress, draft) {
      const efs = active;
      if (!efs) return;
      const id = progress.sequenceId;
      tracked.set(id, { progress, at: ++generation });
      watched.add(id);
      if (draft) drafts.set(id, draft);
      open = open.filter((p) => p.sequenceId !== id);
      if (needsAttention(progress)) open = [progress, ...open];
      else if (progress.state === 'COMPLETE') finals.set(id, progress);
      else forget(id);
      publish();
      schedule(efs);
    },
    dismiss(sequenceId) {
      finals.delete(sequenceId);
      if (!open.some((p) => p.sequenceId === sequenceId)) forget(sequenceId);
      publish();
    },
    draftOf: (sequenceId) => drafts.get(sequenceId),
    reopen(draft) {
      reopening.set(draft);
    },
    takeReopen(link) {
      const draft = reopening.get();
      if (!draft || draft.link !== link) return undefined;
      reopening.set(undefined);
      return draft;
    },
  };
}

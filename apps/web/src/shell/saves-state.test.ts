import type { Efs } from '@efs/sdk';
import type { SequenceProgress } from '@efs/sdk/actions';
import { describe, expect, it, vi } from 'vitest';
import { createScope } from '../platform/scope.ts';
import { state } from '../state/signals.ts';
import type { ReaderState } from './reader-state.ts';
import { createSavesSession, needsAttention } from './saves-state.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const efs = {} as Efs;
const verified: ReaderState = {
  status: 'PINNED',
  efs,
  pin: { kind: 'efs.pin', status: 'VERIFIED' } as never,
};

const progress = (over: Partial<SequenceProgress>): SequenceProgress =>
  ({
    kind: 'efs.sequence',
    sequenceId: `0x${'01'.repeat(32)}`,
    account: `0x${'ab'.repeat(20)}`,
    state: 'PARTIAL',
    final: false,
    total: 5,
    committed: 2,
    ...over,
  }) as SequenceProgress;

function setup(
  open: unknown[],
  listed: SequenceProgress[],
  settle = (p: SequenceProgress) => p,
  confirmEveryMs = 60_000,
) {
  const reader = state<ReaderState>({ status: 'OFF' });
  const journal = { openSequences: vi.fn(async () => open), close: vi.fn() };
  const view = {
    pendingSequences: vi.fn(async () => listed),
    reconcileSequence: vi.fn(async (id: string) =>
      settle(listed.find((p) => p.sequenceId === id) as SequenceProgress),
    ),
  };
  const loadActions = vi.fn(async () => ({ openJournal: () => view }) as never);
  const session = createSavesSession(reader, createScope(), {
    loadJournal: async () => ({ indexedDbJournal: () => journal }) as never,
    loadActions,
    confirmEveryMs,
  });
  return { reader, session, journal, view, loadActions };
}

describe('createSavesSession', () => {
  it('a browser that never saved loads no write code and stays idle', async () => {
    const { reader, session, loadActions } = setup([], []);
    reader.set(verified);
    await tick();
    await tick();
    expect(session.state.get()).toEqual({ status: 'IDLE' });
    expect(loadActions).not.toHaveBeenCalled();
  });

  it('waits for a verified session before reading anything', async () => {
    const { session, journal } = setup([{}], []);
    await tick();
    expect(journal.openSequences).not.toHaveBeenCalled();
    expect(session.state.get()).toEqual({ status: 'IDLE' });
  });

  it('settles in-flight and confirming saves silently and lists what needs the person', async () => {
    const partial = progress({ sequenceId: `0x${'01'.repeat(32)}`, state: 'PARTIAL' });
    const inFlight = progress({ sequenceId: `0x${'02'.repeat(32)}`, state: 'IN_FLIGHT' });
    const confirming = progress({
      sequenceId: `0x${'03'.repeat(32)}`,
      state: 'COMPLETE',
      committed: 5,
    });
    const { reader, session, view } = setup([{}], [partial, inFlight, confirming], (p) =>
      p.state === 'IN_FLIGHT' ? { ...p, state: 'PARTIAL', committed: 3 } : p,
    );
    reader.set(verified);
    await vi.waitFor(() => expect(session.state.get().status).toBe('READY'));
    expect(view.reconcileSequence).toHaveBeenCalledTimes(2);
    const saves = (session.state.get() as unknown as { saves: SequenceProgress[] }).saves;
    expect(saves.map((p) => [p.state, p.committed])).toEqual([
      ['PARTIAL', 2],
      ['PARTIAL', 3],
      ['COMPLETE', 5],
    ]);
  });

  it('keeps re-checking a confirming save until it is final, then drops it', async () => {
    const confirming = progress({ state: 'COMPLETE', committed: 5 });
    let rounds = 0;
    const { reader, session } = setup(
      [{}],
      [confirming],
      (p) => {
        rounds++;
        return rounds >= 2 ? { ...p, final: true } : p;
      },
      100,
    );
    reader.set(verified);
    // First "Saved · confirming", then (once final) nothing left to show.
    await vi.waitFor(() => expect(session.state.get().status).toBe('READY'), { interval: 5 });
    await vi.waitFor(() => expect(session.state.get()).toEqual({ status: 'IDLE' }), {
      timeout: 500,
    });
    expect(rounds).toBeGreaterThanOrEqual(2);
  });

  it('a superseded session aborts its reconcile calls and never shows their results', async () => {
    const inFlight = progress({ state: 'IN_FLIGHT' });
    const reader = state<ReaderState>({ status: 'OFF' });
    let seenSignal: AbortSignal | undefined;
    const view = {
      pendingSequences: vi.fn(async () => [inFlight]),
      reconcileSequence: vi.fn(
        (_id: string, o?: { signal?: AbortSignal }) =>
          new Promise<SequenceProgress>((_resolve, reject) => {
            seenSignal = o?.signal;
            o?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    };
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({ openSequences: async () => [{}], close: () => {} }),
        }) as never,
      loadActions: async () => ({ openJournal: () => view }) as never,
    });
    reader.set(verified);
    await vi.waitFor(() => expect(view.reconcileSequence).toHaveBeenCalled());
    expect(seenSignal?.aborted).toBe(false);
    reader.set({ status: 'OFF' });
    await vi.waitFor(() => expect(seenSignal?.aborted).toBe(true));
    await tick();
    expect(session.state.get()).toEqual({ status: 'IDLE' });
  });

  it('a failed load is reported', async () => {
    const reader = state<ReaderState>(verified);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const session = createSavesSession(reader, createScope(), {
      loadJournal: () =>
        Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    });
    await vi.waitFor(() => expect(session.state.get()).toEqual({ status: 'LOAD_FAILED' }));
    error.mockRestore();
  });

  it('only final completed and abandoned saves need no attention', () => {
    expect(needsAttention(progress({ state: 'COMPLETE', final: true }))).toBe(false);
    expect(needsAttention(progress({ state: 'ABANDONED' }))).toBe(false);
    expect(needsAttention(progress({ state: 'NOT_STARTED' }))).toBe(true);
    expect(needsAttention(progress({ state: 'COMPLETE', final: false }))).toBe(true);
  });
});

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
  const journal = {
    openSequences: vi.fn(async () => open),
    close: vi.fn(),
    get: vi.fn(async () => undefined),
  };
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

  it('keeps re-checking a confirming save until it is final, then shows "Saved" until dismissed', async () => {
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
    await vi.waitFor(() => expect(session.state.get().status).toBe('READY'), { interval: 5 });
    await vi.waitFor(
      () =>
        expect(session.state.get()).toEqual({
          status: 'READY',
          saves: [{ ...confirming, final: true }],
        }),
      { timeout: 500 },
    );
    expect(rounds).toBeGreaterThanOrEqual(2);
    session.dismiss(confirming.sequenceId);
    expect(session.state.get()).toEqual({ status: 'IDLE' });
  });

  it('a save first seen already final (settled elsewhere) is not announced', async () => {
    const elsewhere = progress({ state: 'COMPLETE', committed: 5 });
    const { reader, session, view } = setup([{}], [elsewhere], (p) => ({ ...p, final: true }));
    reader.set(verified);
    await vi.waitFor(() => expect(view.reconcileSequence).toHaveBeenCalled());
    await tick();
    expect(session.state.get()).toEqual({ status: 'IDLE' });
  });

  it("track shows the writer's progress at once and settles it from there", async () => {
    const sent = progress({ state: 'COMPLETE', committed: 1, total: 1 });
    // The journal lists it from now on; the next check finds it final.
    const { reader, session, view } = setup([{}], [sent], (p) => ({ ...p, final: true }), 50);
    reader.set(verified);
    await vi.waitFor(() => expect(view.pendingSequences).toHaveBeenCalledTimes(1));
    await tick();
    session.track(sent);
    expect(session.state.get()).toEqual({ status: 'READY', saves: [sent] });
    await vi.waitFor(() =>
      expect(session.state.get()).toEqual({ status: 'READY', saves: [{ ...sent, final: true }] }),
    );
  });

  it("one save that can't be read right now keeps its last state and hides nothing", async () => {
    const a = progress({ sequenceId: `0x${'0a'.repeat(32)}`, state: 'IN_FLIGHT' });
    const b = progress({ sequenceId: `0x${'0b'.repeat(32)}`, state: 'PARTIAL' });
    const { reader, session } = setup([{}], [a, b], () => {
      throw new Error('rpc down');
    });
    reader.set(verified);
    await vi.waitFor(() => expect(session.state.get()).toEqual({ status: 'READY', saves: [a, b] }));
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

  it('a browser that refuses IndexedDB shows no banner (reads never need the journal)', async () => {
    const reader = state<ReaderState>(verified);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fault = Object.assign(new Error('blocked'), {
      name: 'EfsFault',
      code: 'JOURNAL_UNAVAILABLE',
    });
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({
            openSequences: async () => {
              throw fault;
            },
            close: () => {},
          }),
        }) as never,
    });
    await vi.waitFor(() => expect(info).toHaveBeenCalled());
    expect(session.state.get()).toEqual({ status: 'IDLE' });
    info.mockRestore();
  });

  it('a save handed over while a check is reading is kept, not replaced by the older listing', async () => {
    const reader = state<ReaderState>({ status: 'OFF' });
    let release: (list: SequenceProgress[]) => void = () => {};
    const view = {
      pendingSequences: vi.fn(
        () => new Promise<SequenceProgress[]>((resolve) => (release = resolve)),
      ),
      reconcileSequence: vi.fn(async (id: string) => progress({ sequenceId: id as never })),
    };
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({ openSequences: async () => [{}], close: () => {} }),
        }) as never,
      loadActions: async () => ({ openJournal: () => view }) as never,
      confirmEveryMs: 60_000,
    });
    reader.set(verified);
    await vi.waitFor(() => expect(view.pendingSequences).toHaveBeenCalled());
    // The editor hands a save over while the listing (taken before it) is still being read.
    const handed = progress({
      sequenceId: `0x${'0c'.repeat(32)}`,
      state: 'COMPLETE',
      committed: 1,
      total: 1,
    });
    session.track(handed);
    release([]);
    await tick();
    await tick();
    expect(session.state.get()).toEqual({ status: 'READY', saves: [handed] });
  });

  it('keeps the draft a save was made from, in memory, for "Review changes"', async () => {
    const { reader, session } = setup([], []);
    reader.set(verified);
    await tick();
    await tick();
    const p = progress({ state: 'PARTIAL' });
    const draft = { route: '#/r/testnet/x', link: 'x', text: 'my edit' };
    session.track(p, draft);
    expect(session.draftOf(p.sequenceId)).toEqual(draft);
    expect(session.takeReopen('x')).toBeUndefined();
    session.reopen(draft);
    expect(session.takeReopen('other')).toBeUndefined();
    expect(session.takeReopen('x')).toEqual(draft);
    expect(session.reopening.get()).toBeUndefined();
  });

  it('refresh() resolves only once the check it started has finished reading', async () => {
    const reader = state<ReaderState>({ status: 'OFF' });
    let release: (list: SequenceProgress[]) => void = () => {};
    let calls = 0;
    const view = {
      pendingSequences: vi.fn(() => {
        calls++;
        return calls === 1
          ? Promise.resolve([])
          : new Promise<SequenceProgress[]>((resolve) => (release = resolve));
      }),
      reconcileSequence: vi.fn(),
    };
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({
            openSequences: async () => [{}],
            close: () => {},
            get: async () => undefined,
          }),
        }) as never,
      loadActions: async () => ({ openJournal: () => view }) as never,
    });
    reader.set(verified);
    await vi.waitFor(() => expect(view.pendingSequences).toHaveBeenCalledTimes(1));
    let done = false;
    void session.refresh().then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(view.pendingSequences).toHaveBeenCalledTimes(2));
    await tick();
    expect(done).toBe(false);
    release([]);
    await vi.waitFor(() => expect(done).toBe(true));
  });

  it('a journal lost on a later check keeps the saves already shown, and keeps checking', async () => {
    const reader = state<ReaderState>({ status: 'OFF' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fault = Object.assign(new Error('dropped'), {
      name: 'EfsFault',
      code: 'JOURNAL_UNAVAILABLE',
    });
    let lost = false;
    const inFlight = progress({ state: 'IN_FLIGHT', committed: 0, total: 1 });
    const view = {
      pendingSequences: vi.fn(async () => [inFlight]),
      reconcileSequence: vi.fn(async () => inFlight),
    };
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({
            openSequences: async () => {
              if (lost) throw fault;
              return [{}];
            },
            close: () => {},
            get: async () => undefined,
          }),
        }) as never,
      loadActions: async () => ({ openJournal: () => view }) as never,
      settleEveryMs: 20,
    });
    reader.set(verified);
    await vi.waitFor(() =>
      expect(session.state.get()).toEqual({ status: 'READY', saves: [inFlight] }),
    );
    lost = true;
    await session.refresh();
    expect(session.state.get()).toEqual({ status: 'READY', saves: [inFlight] });
    // Still scheduled: once the journal is back, the save is settled from there.
    lost = false;
    const calls = view.pendingSequences.mock.calls.length;
    await vi.waitFor(() => expect(view.pendingSequences.mock.calls.length).toBeGreaterThan(calls));
    info.mockRestore();
  });

  it("reads an in-flight save's deadline from its journaled plan", async () => {
    const reader = state<ReaderState>({ status: 'OFF' });
    const planId = `0x${'0e'.repeat(32)}`;
    const inFlight = progress({ state: 'IN_FLIGHT', current: { index: 0, planId } as never });
    const view = {
      pendingSequences: vi.fn(async () => [inFlight]),
      reconcileSequence: vi.fn(async () => inFlight),
    };
    const get = vi.fn(async (id: string) =>
      id === planId ? { plan: { deadline: 1_900_000_000n } } : undefined,
    );
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({ openSequences: async () => [{}], close: () => {}, get }),
        }) as never,
      loadActions: async () => ({ openJournal: () => view }) as never,
      settleEveryMs: 60_000,
    });
    reader.set(verified);
    await vi.waitFor(() => expect(session.deadlineOf(inFlight)).toBe(1_900_000_000));
    // Keyed by the part's plan: a later part (or one sent again) is measured by its own deadline.
    const later = { ...inFlight, current: { index: 1, planId: `0x${'0f'.repeat(32)}` } } as never;
    expect(session.deadlineOf(later)).toBeUndefined();
    // The SDK's own figure wins when it reports one.
    const reported = {
      ...inFlight,
      current: { index: 0, planId, deadline: 1_950_000_000n },
    } as never;
    expect(session.deadlineOf(reported)).toBe(1_950_000_000);
  });

  it('a refresh that hangs (a lost IndexedDB connection) times out; it never reads as done', async () => {
    const reader = state<ReaderState>({ status: 'OFF' });
    let hang = false;
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({
            openSequences: () => (hang ? new Promise(() => {}) : Promise.resolve([])),
            close: () => {},
            get: async () => undefined,
          }),
        }) as never,
    });
    reader.set(verified);
    await tick();
    await tick();
    hang = true;
    expect(await session.refresh({ timeoutMs: 20 })).toBe('timeout');
  });

  it('an unconfirmed send stays marked until a successful check finds its save', async () => {
    const reader = state<ReaderState>({ status: 'OFF' });
    const id = `0x${'1a'.repeat(32)}` as const;
    let failing = true;
    let listed: SequenceProgress[] = [];
    const view = {
      pendingSequences: vi.fn(async () => listed),
      reconcileSequence: vi.fn(async (sid: string) =>
        progress({ sequenceId: sid as never, state: 'IN_FLIGHT' }),
      ),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const session = createSavesSession(reader, createScope(), {
      loadJournal: async () =>
        ({
          indexedDbJournal: () => ({
            openSequences: async () => {
              if (failing) throw new TypeError('IndexedDB connection lost');
              return [{}];
            },
            close: () => {},
            get: async () => undefined,
          }),
        }) as never,
      loadActions: async () => ({ openJournal: () => view }) as never,
      settleEveryMs: 60_000,
    });
    reader.set(verified);
    await vi.waitFor(() => expect(session.state.get().status).toBe('LOAD_FAILED'));
    session.markUnconfirmed({ file: '0xfile', sequenceId: id });
    expect(await session.refresh()).toBe('failed');
    expect(session.unconfirmed.get()).toEqual([{ file: '0xfile', sequenceId: id }]);
    // The journal answers, but a journal-only read that doesn't list it can't clear it.
    failing = false;
    expect(await session.refresh({ settle: false })).toBe('read');
    expect(session.unconfirmed.get()).toHaveLength(1);
    // Listed: found. The banner holds it as usual from here.
    listed = [progress({ sequenceId: id, state: 'IN_FLIGHT' })];
    expect(await session.refresh()).toBe('read');
    expect(session.unconfirmed.get()).toEqual([]);
    error.mockRestore();
  });

  it('only final completed and abandoned saves need no attention', () => {
    expect(needsAttention(progress({ state: 'COMPLETE', final: true }))).toBe(false);
    expect(needsAttention(progress({ state: 'ABANDONED' }))).toBe(false);
    expect(needsAttention(progress({ state: 'NOT_STARTED' }))).toBe(true);
    expect(needsAttention(progress({ state: 'COMPLETE', final: false }))).toBe(true);
  });
});

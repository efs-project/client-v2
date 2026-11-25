import type { SequenceProgress } from '@efs/sdk/actions';
import { describe, expect, it } from 'vitest';
import { saveHold } from './save-hold.ts';

const ME = `0x${'ab'.repeat(20)}`;
const FILE = `0x${'f1'.repeat(32)}`;
const OTHER_FILE = `0x${'f2'.repeat(32)}`;

const p = (over: Partial<SequenceProgress>): SequenceProgress =>
  ({
    kind: 'efs.sequence',
    sequenceId: `0x${'01'.repeat(32)}`,
    account: ME,
    state: 'IN_FLIGHT',
    final: false,
    total: 1,
    committed: 0,
    effect: { kind: 'files.edit', file: FILE, revision: `0x${'0e'.repeat(32)}` },
    ...over,
  }) as SequenceProgress;

// sdk-v2 #34 shapes: bigint unix seconds, the block the last successful ledger read used.
const inFlight = (deadline: bigint, at: bigint, pastDeadline: boolean, block = 120n) =>
  p({
    current: {
      index: 0,
      planId: `0x${'0d'.repeat(32)}`,
      deadline,
      checkedAt: { blockNumber: block, timestamp: at },
      pastDeadline,
    } as never,
  });

const hold = (saves: SequenceProgress[], except?: string) =>
  saveHold(saves, { account: ME, file: FILE, except });

describe('saveHold', () => {
  it('an in-flight save waits until its deadline, estimated as of the block last read', () => {
    expect(hold([inFlight(1_000_900n, 1_000_000n, false, 77n)])).toEqual({
      hold: { kind: 'waiting', minutes: 15, block: 77n },
      lapsed: false,
    });
  });

  it('releases only on the SDK\'s pastDeadline, with the "didn\'t confirm in time" warning', () => {
    expect(hold([inFlight(1_000_000n, 1_000_100n, true)])).toEqual({ lapsed: true });
    // Never on a clock: the deadline "passed" by the numbers but the SDK hasn't said so.
    expect(hold([inFlight(1_000_000n, 1_000_100n, false)]).hold).toMatchObject({
      kind: 'waiting',
    });
  });

  it('before any ledger read the wait is unknown ("Check again")', () => {
    expect(hold([p({ current: { index: 0 } as never })])).toEqual({
      hold: { kind: 'waiting' },
      lapsed: false,
    });
  });

  it('a save to finish or stop holds, whatever is in flight', () => {
    expect(hold([inFlight(9n, 1n, true), p({ state: 'PARTIAL', committed: 1, total: 2 })])).toEqual(
      { hold: { kind: 'unsettled' }, lapsed: false },
    );
    expect(hold([p({ state: 'NOT_STARTED' })]).hold).toEqual({ kind: 'unsettled' });
  });

  it('holds per file when the save names it; older records hold every file', () => {
    const otherFile = p({
      state: 'PARTIAL',
      effect: { kind: 'files.edit', file: OTHER_FILE as never, revision: `0x${'0e'.repeat(32)}` },
    });
    expect(hold([otherFile])).toEqual({ lapsed: false });
    const noEffect = p({ state: 'PARTIAL' });
    delete (noEffect as { effect?: unknown }).effect;
    expect(hold([noEffect]).hold).toEqual({ kind: 'unsettled' });
    // Case doesn't matter.
    const upper = p({
      state: 'PARTIAL',
      effect: { kind: 'files.edit', file: FILE.toUpperCase() as never, revision: '0x' as never },
    });
    expect(hold([upper]).hold).toEqual({ kind: 'unsettled' });
  });

  it('ignores settled saves, other accounts, and the save a review continues', () => {
    expect(hold([p({ state: 'COMPLETE', committed: 1 })])).toEqual({ lapsed: false });
    expect(hold([p({ state: 'PARTIAL', account: `0x${'cd'.repeat(20)}` as never })])).toEqual({
      lapsed: false,
    });
    const own = p({ state: 'NOT_STARTED', sequenceId: `0x${'09'.repeat(32)}` as never });
    expect(hold([own], own.sequenceId)).toEqual({ lapsed: false });
  });
});

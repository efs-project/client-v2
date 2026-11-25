import type { SequenceProgress } from '@efs/sdk/actions';
import { describe, expect, it } from 'vitest';
import en from '../../ui/messages/en.json' with { type: 'json' };
import { SAVE_MESSAGE, saveAction, saveOutcome } from './save-outcome.ts';

const p = (over: Partial<SequenceProgress>): SequenceProgress =>
  ({
    kind: 'efs.sequence',
    sequenceId: `0x${'01'.repeat(32)}`,
    account: `0x${'ab'.repeat(20)}`,
    state: 'NOT_STARTED',
    final: false,
    total: 1,
    committed: 0,
    ...over,
  }) as SequenceProgress;

const reason = (code: string, detail?: string) => ({ code, retry: 'transient', detail }) as never;

describe('saveOutcome', () => {
  it('says saved only when complete AND final; otherwise confirming', () => {
    expect(saveOutcome(p({ state: 'COMPLETE', final: true, committed: 1 }))).toEqual({
      kind: 'saved',
    });
    expect(saveOutcome(p({ state: 'COMPLETE', final: false, committed: 1 }))).toEqual({
      kind: 'confirming',
    });
    for (const state of ['NOT_STARTED', 'IN_FLIGHT', 'PARTIAL', 'ABANDONED'] as const) {
      expect(saveOutcome(p({ state, final: true })).kind).not.toBe('saved');
    }
  });

  it('a reorg is "undone by the network", whatever state it left behind', () => {
    expect(saveOutcome(p({ state: 'IN_FLIGHT', reason: reason('REORGED') }))).toEqual({
      kind: 'undone',
    });
    expect(saveOutcome(p({ state: 'PARTIAL', reason: reason('REORGED') }))).toEqual({
      kind: 'undone',
    });
  });

  it('tells a same-account race ("changed") from a stale plan and a refusal', () => {
    expect(saveOutcome(p({ reason: reason('STALE', 'revert E_CAS(…)') }))).toEqual({
      kind: 'changed',
    });
    expect(saveOutcome(p({ reason: reason('STALE', 'wrong chain') }))).toEqual({ kind: 'stale' });
    expect(saveOutcome(p({ reason: reason('USER_REJECTED') }))).toEqual({ kind: 'refused' });
  });

  it('names the other refusals and keeps unknown codes as not sent', () => {
    expect(saveOutcome(p({ reason: reason('OVER_TX_GAS_CAP') })).kind).toBe('too-large');
    expect(saveOutcome(p({ reason: reason('BUSY') })).kind).toBe('busy');
    expect(saveOutcome(p({ reason: reason('JOURNAL_UNAVAILABLE') })).kind).toBe('no-journal');
    expect(saveOutcome(p({ reason: reason('SOMETHING_NEW') }))).toEqual({
      kind: 'not-sent',
      code: 'SOMETHING_NEW',
    });
  });

  it('progress and actions', () => {
    expect(saveOutcome(p({ state: 'PARTIAL', committed: 2, total: 5 }))).toEqual({
      kind: 'partial',
      committed: 2,
      total: 5,
    });
    expect(saveAction({ kind: 'partial', committed: 2, total: 5 })).toBe('continue');
    expect(saveAction({ kind: 'undone' })).toBe('send-again');
    expect(saveAction({ kind: 'changed' })).toBe('reopen');
    expect(saveAction({ kind: 'saved' })).toBeUndefined();
    expect(saveAction({ kind: 'confirming' })).toBeUndefined();
  });

  it('every outcome has catalog copy', () => {
    for (const id of Object.values(SAVE_MESSAGE)) expect(en).toHaveProperty(id);
  });
});

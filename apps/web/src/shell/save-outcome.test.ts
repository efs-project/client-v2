import type { SequenceProgress } from '@efs/sdk/actions';
import { describe, expect, it } from 'vitest';
import en from '../ui/messages/en.json' with { type: 'json' };
import { isFault, SAVE_MESSAGE, saveAction, saveMessage, saveOutcome } from './save-outcome.ts';

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

const reason = (code: string, retry = 'transient', detail?: string, extra = {}) =>
  ({ code, retry, detail, ...extra }) as never;

describe('saveOutcome', () => {
  it('says saved only when complete AND final; otherwise confirming', () => {
    expect(saveOutcome(p({ state: 'COMPLETE', final: true, committed: 1 }))).toEqual({
      kind: 'saved',
    });
    expect(saveOutcome(p({ state: 'COMPLETE', final: false, committed: 1 }))).toEqual({
      kind: 'confirming',
    });
    for (const state of ['NOT_STARTED', 'IN_FLIGHT', 'PARTIAL', 'ABANDONED'] as const) {
      expect(saveOutcome(p({ state, final: true })).kind).not.toMatch(/^(saved|confirming)$/);
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

  it('a race lost by the finishing part is "changed", never "Continue" (it would fail again)', () => {
    const lost = p({
      state: 'PARTIAL',
      committed: 2,
      total: 3,
      reason: reason('STALE', 'after-replan', 'revert E_CAS(…)'),
    });
    expect(saveOutcome(lost)).toEqual({ kind: 'changed', committed: 2 });
    expect(saveAction(saveOutcome(lost))).toBe('reopen');
    expect(saveMessage(saveOutcome(lost))).toBe('save.changedPartly');
  });

  it('prefers the structured revert over the detail text', () => {
    const structured = reason('STALE', 'after-replan', 'no marker here', {
      revert: { selector: '0x12345678', error: 'E_CAS' },
    });
    expect(saveOutcome(p({ reason: structured }))).toEqual({ kind: 'changed', committed: 0 });
    const other = reason('STALE', 'after-replan', 'mentions E_CAS but is not', {
      revert: { selector: '0x12345678', error: 'E_DEADLINE' },
    });
    expect(saveOutcome(p({ reason: other }))).toEqual({ kind: 'stale' });
  });

  it('offers Continue only when the same plan can finish', () => {
    for (const retry of ['transient', 'after-reconcile']) {
      const o = saveOutcome(
        p({ state: 'PARTIAL', committed: 2, total: 5, reason: reason('RPC_ERROR', retry) }),
      );
      expect(o).toEqual({ kind: 'partial', committed: 2, total: 5, canContinue: true });
      expect(saveAction(o)).toBe('continue');
    }
    // Listed after a reload: no reason yet.
    expect(saveAction(saveOutcome(p({ state: 'PARTIAL', committed: 1, total: 2 })))).toBe(
      'continue',
    );
    // A refusal in the middle of a sequence leaves it resumable.
    expect(
      saveAction(
        saveOutcome(
          p({ state: 'PARTIAL', committed: 1, total: 2, reason: reason('USER_REJECTED') }),
        ),
      ),
    ).toBe('continue');
    const stuck = saveOutcome(
      p({
        state: 'PARTIAL',
        committed: 1,
        total: 2,
        reason: reason('STALE', 'after-replan', 'deadline'),
      }),
    );
    expect(stuck).toEqual({ kind: 'partial', committed: 1, total: 2, canContinue: false });
    expect(saveAction(stuck)).toBe('abandon');
    expect(saveMessage(stuck)).toBe('save.partialStuck');
  });

  it('a wallet that moved before sending is "switch back, then Continue"', () => {
    const o = saveOutcome(
      p({ state: 'PARTIAL', committed: 1, total: 2, reason: reason('WALLET_MISMATCH') }),
    );
    expect(o).toEqual({ kind: 'wallet-mismatch' });
    expect(saveAction(o)).toBe('continue');
  });

  it('tells a refusal from a stale plan before anything was sent', () => {
    expect(saveOutcome(p({ reason: reason('STALE', 'after-replan', 'wrong chain') }))).toEqual({
      kind: 'stale',
    });
    expect(saveOutcome(p({ reason: reason('USER_REJECTED') }))).toEqual({ kind: 'refused' });
  });

  it('names the other refusals and keeps unknown codes as not sent', () => {
    expect(saveOutcome(p({ reason: reason('OVER_TX_GAS_CAP', 'never') })).kind).toBe('too-large');
    expect(saveOutcome(p({ reason: reason('BUSY') })).kind).toBe('busy');
    expect(saveOutcome(p({ reason: reason('JOURNAL_UNAVAILABLE', 'never') })).kind).toBe(
      'no-journal',
    );
    expect(saveOutcome(p({ reason: reason('SOMETHING_NEW') }))).toEqual({
      kind: 'not-sent',
      code: 'SOMETHING_NEW',
    });
  });

  it('actions', () => {
    expect(saveAction({ kind: 'undone' })).toBe('send-again');
    expect(saveAction({ kind: 'changed', committed: 0 })).toBe('reopen');
    expect(saveAction({ kind: 'refused' })).toBe('retry');
    expect(saveAction({ kind: 'saved' })).toBeUndefined();
    expect(saveAction({ kind: 'confirming' })).toBeUndefined();
    expect(saveAction({ kind: 'checking' })).toBeUndefined();
  });

  it('recognizes a thrown SDK fault by code', () => {
    const fault = Object.assign(new Error('no journal'), {
      name: 'EfsFault',
      code: 'JOURNAL_UNAVAILABLE',
    });
    expect(isFault(fault, 'JOURNAL_UNAVAILABLE')).toBe(true);
    expect(isFault(fault, 'MISUSE')).toBe(false);
    expect(isFault(new Error('x'), 'JOURNAL_UNAVAILABLE')).toBe(false);
  });

  it('every outcome has catalog copy', () => {
    for (const id of [...Object.values(SAVE_MESSAGE), 'save.changedPartly', 'save.partialStuck'])
      expect(en).toHaveProperty(id);
  });
});

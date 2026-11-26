import { describe, expect, it } from 'vitest';
import en from './messages/en.json' with { type: 'json' };
import { describeOutcome, outcomeActions, outcomeMessageIds } from './outcome.ts';

describe('describeOutcome', () => {
  it('maps known statuses', () => {
    expect(describeOutcome('write', 'COMMITTED').tone).toBe('success');
    expect(describeOutcome('write', 'AMBIGUOUS')).toMatchObject({ retry: 'after-reconcile' });
    expect(describeOutcome('coverage', 'PARTIAL').tone).toBe('neutral');
  });

  it('never shows an unrecognized status as success or absence', () => {
    for (const kind of ['read', 'coverage', 'bytes', 'write', 'pin'] as const) {
      const view = describeOutcome(kind, 'SOMETHING_NEW');
      expect(view.tone).toBe('warning');
      expect(view.message).toBe('outcome.unrecognized');
      expect(view.code).toBe('SOMETHING_NEW');
    }
    // Inherited object keys must not be mistaken for statuses.
    expect(describeOutcome('read', 'toString').message).toBe('outcome.unrecognized');
  });

  it('only COMMITTED counts as done for writes', () => {
    for (const code of ['SUBMITTED', 'AMBIGUOUS', 'UNKNOWN', 'STALE', 'BUSY', 'NOT_SENT']) {
      expect(describeOutcome('write', code).tone).not.toBe('success');
    }
  });

  it('has a catalog message for every outcome', () => {
    for (const id of outcomeMessageIds()) expect(Object.hasOwn(en, id), id).toBe(true);
  });
});

describe('UNKNOWN BEHIND (the read floor)', () => {
  it('has its own copy, keeps the code and the reason, and is retried as transient', () => {
    for (const kind of ['read', 'coverage', 'bytes', 'pin'] as const) {
      expect(describeOutcome(kind, 'UNKNOWN', 'BEHIND')).toEqual({
        tone: 'warning',
        message: 'outcome.behind',
        retry: 'transient',
        code: 'UNKNOWN',
        reason: 'BEHIND',
      });
    }
  });

  it('only for UNKNOWN: any other status keeps its own copy, and other reasons the generic one', () => {
    expect(describeOutcome('read', 'INVALID', 'BEHIND').message).toBe('outcome.read.invalid');
    expect(describeOutcome('read', 'UNKNOWN', 'RPC_FAILED')).toMatchObject({
      message: 'outcome.read.unknown',
      reason: 'RPC_FAILED',
    });
    expect(describeOutcome('read', 'UNKNOWN')).not.toHaveProperty('reason');
  });

  it('offers Start over only for BEHIND, only where the host can reset, and only beside Try again', () => {
    const behind = describeOutcome('read', 'UNKNOWN', 'BEHIND');
    const other = describeOutcome('read', 'UNKNOWN', 'RPC_FAILED');
    expect(outcomeActions(behind, { retryable: true, canReset: true })).toEqual([
      'retry',
      'startOver',
    ]);
    expect(outcomeActions(behind, { retryable: true, canReset: false })).toEqual(['retry']);
    expect(outcomeActions(other, { retryable: true, canReset: true })).toEqual(['retry']);
    expect(outcomeActions(behind, { retryable: false, canReset: true })).toEqual([]);
  });

  it('its message is in the catalog check', () => {
    expect(outcomeMessageIds()).toContain('outcome.behind');
  });
});

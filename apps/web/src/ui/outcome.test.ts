import { describe, expect, it } from 'vitest';
import en from './messages/en.json' with { type: 'json' };
import { describeOutcome, outcomeMessageIds } from './outcome.ts';

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

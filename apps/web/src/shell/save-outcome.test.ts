import type { SequenceProgress } from '@efs/sdk/actions';
import { describe, expect, it } from 'vitest';
import en from '../ui/messages/en.json' with { type: 'json' };
import {
  isFault,
  SAVE_MESSAGE,
  saveAction,
  saveMessage,
  saveOutcome,
  saveValues,
} from './save-outcome.ts';

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

// Only (code, retry) pairs the SDK emits (sdk-v2 2ab07d7, src/actions): never invented ones.
const R = {
  userRejected: { code: 'USER_REJECTED', retry: 'never' },
  busy: { code: 'BUSY', retry: 'transient' },
  walletMismatch: {
    code: 'WALLET_MISMATCH',
    retry: 'transient',
    wallet: {
      expected: { chainId: 31337, account: `0x${'ab'.repeat(20)}` },
      actual: { chainId: 1, account: `0x${'ab'.repeat(20)}` },
    },
  },
  cas: {
    code: 'STALE',
    retry: 'after-replan',
    revert: { selector: '0x12345678', error: 'E_CAS', args: [1n, 2n] },
  },
  staleOther: {
    code: 'STALE',
    retry: 'after-replan',
    revert: { selector: '0x87654321', error: 'E_DEADLINE' },
  },
  staleUnknownSelector: {
    code: 'STALE',
    retry: 'after-replan',
    revert: { selector: '0xdeadbeef' },
  },
  staleNoRevert: { code: 'STALE', retry: 'after-replan', detail: 'revert E_CAS (text only)' },
  overCap: { code: 'OVER_TX_GAS_CAP', retry: 'after-replan' },
  limit: { code: 'LIMIT_EXCEEDED', retry: 'after-replan' },
  journalTransient: { code: 'JOURNAL_UNAVAILABLE', retry: 'transient' },
  journalReconcile: { code: 'JOURNAL_UNAVAILABLE', retry: 'after-reconcile' },
  rpcError: { code: 'RPC_ERROR', retry: 'transient' },
  rpcUnavailable: { code: 'RPC_UNAVAILABLE', retry: 'transient' },
  responseLost: { code: 'RESPONSE_LOST', retry: 'after-reconcile' },
  reorged: { code: 'REORGED', retry: 'after-reconcile' },
  notVerified: { code: 'NOT_VERIFIED_DEPLOYMENT', retry: 'never' },
  aborted: { code: 'ABORTED', retry: 'never' },
} as const;
const reason = (r: (typeof R)[keyof typeof R]) => r as never;

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
    for (const state of ['IN_FLIGHT', 'PARTIAL', 'NOT_STARTED'] as const) {
      expect(saveOutcome(p({ state, reason: reason(R.reorged) }))).toEqual({ kind: 'undone' });
    }
    expect(saveAction({ kind: 'undone' })).toBe('send-again');
  });

  it('decides by code before retry: a gas-cap refusal is "too large", not "stale"', () => {
    expect(saveOutcome(p({ reason: reason(R.overCap) }))).toEqual({ kind: 'too-large' });
    expect(
      saveOutcome(p({ state: 'PARTIAL', committed: 1, total: 3, reason: reason(R.overCap) })),
    ).toEqual({ kind: 'too-large' });
  });

  it('a part declined mid-save is "You declined part k", with Continue (retry is "never")', () => {
    const o = saveOutcome(
      p({ state: 'PARTIAL', committed: 2, total: 5, reason: reason(R.userRejected) }),
    );
    expect(o).toEqual({ kind: 'declined', committed: 2, total: 5, part: 3 });
    expect(saveAction(o)).toBe('continue');
    // Before anything was sent it's a plain refusal, sent again from the review.
    expect(saveOutcome(p({ reason: reason(R.userRejected) }))).toEqual({ kind: 'refused' });
    expect(saveAction({ kind: 'refused' })).toBe('retry');
  });

  it('a race lost by the finishing part is "changed", never "Continue" (it would fail again)', () => {
    const lost = saveOutcome(
      p({ state: 'PARTIAL', committed: 2, total: 3, reason: reason(R.cas) }),
    );
    expect(lost).toEqual({ kind: 'changed', committed: 2 });
    expect(saveAction(lost)).toBe('reopen');
    expect(saveMessage(lost)).toBe('save.changedPartly');
    expect(saveOutcome(p({ reason: reason(R.cas) }))).toEqual({ kind: 'changed', committed: 0 });
  });

  it('decides the race on the structured revert only, never on the detail text', () => {
    expect(saveOutcome(p({ reason: reason(R.staleOther) }))).toEqual({
      kind: 'stale',
      error: 'E_DEADLINE',
    });
    expect(saveOutcome(p({ reason: reason(R.staleUnknownSelector) }))).toEqual({ kind: 'stale' });
    expect(saveOutcome(p({ reason: reason(R.staleNoRevert) }))).toEqual({ kind: 'stale' });
    expect(saveMessage({ kind: 'stale', error: 'E_DEADLINE' })).toBe('save.refusedByLedger');
    // A stale plan in the middle of a save can't be continued.
    const stuck = saveOutcome(
      p({ state: 'PARTIAL', committed: 1, total: 2, reason: reason(R.staleOther) }),
    );
    expect(stuck).toEqual({ kind: 'partial', committed: 1, total: 2, canContinue: false });
    expect(saveAction(stuck)).toBe('abandon');
    expect(saveMessage(stuck)).toBe('save.partialStuck');
  });

  it('a wallet switched away names the account and network to switch back to', () => {
    const o = saveOutcome(
      p({ state: 'PARTIAL', committed: 1, total: 2, reason: reason(R.walletMismatch) }),
    );
    expect(o).toEqual({
      kind: 'wallet-mismatch',
      account: `0x${'ab'.repeat(20)}`,
      chainId: 31337,
    });
    expect(saveAction(o)).toBe('continue');
    expect(saveMessage(o)).toBe('save.walletMismatchTo');
    expect(
      saveValues(
        o,
        (a) => `${a.slice(0, 6)}…`,
        (id) => (id === 31337 ? 'Testnet' : `chain ${id}`),
      ),
    ).toEqual({ account: '0xabab…', chain: 'Testnet' });
  });

  it('continues by retry only for codes this version does not name', () => {
    for (const r of [R.rpcError, R.rpcUnavailable, R.responseLost]) {
      const o = saveOutcome(p({ state: 'PARTIAL', committed: 2, total: 5, reason: reason(r) }));
      expect(o).toEqual({ kind: 'partial', committed: 2, total: 5, canContinue: true });
    }
    for (const r of [R.limit, R.notVerified, R.aborted]) {
      const o = saveOutcome(p({ state: 'PARTIAL', committed: 2, total: 5, reason: reason(r) }));
      expect(o).toMatchObject({ kind: 'partial', canContinue: false });
    }
    // Listed after a reload: no reason yet.
    expect(saveAction(saveOutcome(p({ state: 'PARTIAL', committed: 1, total: 2 })))).toBe(
      'continue',
    );
  });

  it('names the other refusals; unknown ones stay "not sent", retried only when the SDK says so', () => {
    expect(saveOutcome(p({ reason: reason(R.busy) })).kind).toBe('busy');
    expect(saveOutcome(p({ reason: reason(R.journalTransient) })).kind).toBe('no-journal');
    expect(saveOutcome(p({ reason: reason(R.journalReconcile) })).kind).toBe('no-journal');
    expect(saveOutcome(p({ reason: reason(R.rpcError) }))).toEqual({
      kind: 'not-sent',
      code: 'RPC_ERROR',
      canRetry: true,
    });
    const never = saveOutcome(p({ reason: reason(R.notVerified) }));
    expect(never).toEqual({ kind: 'not-sent', code: 'NOT_VERIFIED_DEPLOYMENT', canRetry: false });
    expect(saveAction(never)).toBeUndefined();
  });

  it('no action while the network decides, or once saved', () => {
    expect(saveAction({ kind: 'saved' })).toBeUndefined();
    expect(saveAction({ kind: 'confirming' })).toBeUndefined();
    expect(saveAction({ kind: 'checking' })).toBeUndefined();
    expect(saveOutcome(p({ state: 'IN_FLIGHT', reason: reason(R.responseLost) }))).toEqual({
      kind: 'checking',
    });
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
    for (const id of [
      ...Object.values(SAVE_MESSAGE),
      'save.changedPartly',
      'save.partialStuck',
      'save.refusedByLedger',
      'save.walletMismatchTo',
    ])
      expect(en).toHaveProperty(id);
  });
});

import { EfsFault } from '@efs/sdk';
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
  thrownOutcome,
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

// Only (code, retry) pairs the SDK emits (sdk-v2 57f76f0, src/actions): never invented ones.
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
  // The tag release: a HEAD at another file's revision is refused at write time (the Files
  // validator's code 8, wrapped by the index call).
  headLaw: {
    code: 'STALE',
    retry: 'after-replan',
    revert: { selector: '0x94b0e1fa', error: 'E_INDEX_CALL' },
  },
  overCap: { code: 'OVER_TX_GAS_CAP', retry: 'after-replan' },
  limit: { code: 'LIMIT_EXCEEDED', retry: 'after-replan' },
  journalTransient: { code: 'JOURNAL_UNAVAILABLE', retry: 'transient' },
  journalReconcile: { code: 'JOURNAL_UNAVAILABLE', retry: 'after-reconcile' },
  rpcError: { code: 'RPC_ERROR', retry: 'transient' },
  rpcUnavailable: { code: 'RPC_UNAVAILABLE', retry: 'transient' },
  responseLost: { code: 'RESPONSE_LOST', retry: 'after-reconcile' },
  reorged: { code: 'REORGED', retry: 'after-reconcile' },
  // sdk-v2 #32: a reorged part proven dropped, and the decline made transient.
  reorgedDropped: { code: 'REORGED_DROPPED', retry: 'transient' },
  userRejectedTransient: { code: 'USER_REJECTED', retry: 'transient' },
  // sdk-v2 #33 (src/actions/reconcile): a part sent but proven not committed past its deadline.
  expired: { code: 'EXPIRED', retry: 'transient' },
  notVerified: { code: 'NOT_VERIFIED_DEPLOYMENT', retry: 'never' },
  aborted: { code: 'ABORTED', retry: 'never' },
  // sdk-v2 31ee83a: the same publication's earlier attempt is still open (or committed, not final).
  alreadyAttempted: {
    code: 'ALREADY_ATTEMPTED',
    retry: 'after-reconcile',
    detail: 'the same publication is already on its way (attempt 0x0d…)',
    twin: {
      planId: `0x${'0d'.repeat(32)}`,
      stage: 'SUBMITTED',
      sequenceId: `0x${'02'.repeat(32)}`,
    },
  },
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

  it("a reorg is the network's doing: state first, then the code", () => {
    // REORGED while the part is in flight again: it may still land; no action.
    expect(saveOutcome(p({ state: 'IN_FLIGHT', reason: reason(R.reorged) }))).toEqual({
      kind: 'undone-checking',
    });
    expect(saveAction({ kind: 'undone-checking' })).toBeUndefined();
    // Proven dropped: re-sending (resume) is the person's click.
    for (const state of ['PARTIAL', 'NOT_STARTED'] as const) {
      expect(saveOutcome(p({ state, reason: reason(R.reorgedDropped) }))).toEqual({
        kind: 'undone',
      });
    }
    expect(saveAction({ kind: 'undone' })).toBe('send-again');
    // The state decides first: a save already complete again is saved, whatever the reason says.
    expect(
      saveOutcome(p({ state: 'COMPLETE', committed: 1, final: true, reason: reason(R.reorged) })),
    ).toEqual({ kind: 'saved' });
  });

  it('a part proven not committed past its deadline is "didn\'t go through in time", never "not sent"', () => {
    expect(saveOutcome(p({ reason: reason(R.expired) }))).toEqual({
      kind: 'expired',
      committed: 0,
      total: 1,
    });
    expect(saveMessage({ kind: 'expired', committed: 0, total: 1 })).toBe('save.expired');
    const part = saveOutcome(
      p({ state: 'PARTIAL', committed: 2, total: 4, reason: reason(R.expired) }),
    );
    expect(part).toEqual({ kind: 'expired', committed: 2, total: 4 });
    expect(saveMessage(part)).toBe('save.expiredPart');
    expect(saveAction(part)).toBe('send-again');
    // Not started and no reason recorded (listed after a reload): it didn't go through.
    expect(saveOutcome(p({ state: 'NOT_STARTED' }))).toEqual({ kind: 'not-through' });
    expect(saveAction({ kind: 'not-through' })).toBe('send-again');
  });

  it('a save held back for its twin is "held", never "not sent", with nothing to press', () => {
    const twin = R.alreadyAttempted.twin;
    // Its retry is "after-reconcile", which would otherwise offer Try again ("not sent").
    expect(saveOutcome(p({ reason: reason(R.alreadyAttempted) }))).toEqual({
      kind: 'held',
      committed: 0,
      total: 1,
      twin,
    });
    expect(
      saveOutcome(
        p({ state: 'PARTIAL', committed: 1, total: 3, reason: reason(R.alreadyAttempted) }),
      ),
    ).toEqual({ kind: 'held', committed: 1, total: 3, twin });
    const held = { kind: 'held', committed: 0, total: 1, twin } as const;
    expect(saveAction(held)).toBeUndefined();
    expect(saveMessage(held)).toBe('save.held');
    expect(en['save.held']).not.toMatch(/nothing was saved/i);
    // Without a twin named (an older SDK), still held, never "not sent".
    const { twin: _twin, ...bare } = R.alreadyAttempted;
    expect(saveOutcome(p({ reason: bare as never }))).toEqual({
      kind: 'held',
      committed: 0,
      total: 1,
    });
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
    // sdk-v2 #32 makes the decline "transient": the same outcome, decided by code.
    expect(
      saveOutcome(
        p({ state: 'PARTIAL', committed: 2, total: 5, reason: reason(R.userRejectedTransient) }),
      ),
    ).toEqual({ kind: 'declined', committed: 2, total: 5, part: 3 });
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
    // The HEAD law refused at write time: the network refused it, named; never "changed".
    const headLaw = saveOutcome(p({ reason: reason(R.headLaw) }));
    expect(headLaw).toEqual({ kind: 'stale', error: 'E_INDEX_CALL' });
    expect(saveMessage(headLaw)).toBe('save.refusedByLedger');
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

  it('a wallet that lost its connection mid-send is "checking whether it went out", no action', () => {
    // sdk-v2 #33: 4900/4901 stay AMBIGUOUS (a wallet can disconnect after relaying).
    for (const code of ['WALLET_DISCONNECTED', 'WALLET_CHAIN_DISCONNECTED']) {
      const o = saveOutcome(
        p({ state: 'IN_FLIGHT', reason: { code, retry: 'after-reconcile' } as never }),
      );
      expect(o).toEqual({ kind: 'wallet-lost' });
      expect(saveAction(o)).toBeUndefined();
    }
  });

  it('no action while the network decides, or once saved', () => {
    expect(saveAction({ kind: 'saved' })).toBeUndefined();
    expect(saveAction({ kind: 'confirming' })).toBeUndefined();
    expect(saveAction({ kind: 'checking' })).toBeUndefined();
    expect(saveOutcome(p({ state: 'IN_FLIGHT', reason: reason(R.responseLost) }))).toEqual({
      kind: 'checking',
    });
  });

  it('a thrown fault is offered again only when the SDK proves this call sent nothing', () => {
    const id = `0x${'0d'.repeat(32)}` as const;
    // Real faults, as runSequence/resume throw them (sdk-v2 #32).
    const nothingAtAll = new EfsFault('INVARIANT', 'wallet refused before sending', {
      sequence: { sequenceId: id, mayHaveSent: false, sequenceMayHaveSent: false },
    });
    expect(thrownOutcome(nothingAtAll)).toEqual({
      kind: 'again',
      outcome: { kind: 'not-sent', code: 'INVARIANT', canRetry: true },
      sequenceId: id,
    });
    // This call sent nothing, but earlier parts may be on chain: never "nothing was saved".
    const earlierParts = new EfsFault('INVARIANT', 'journal read failed', {
      sequence: { sequenceId: id, mayHaveSent: false, sequenceMayHaveSent: true },
    });
    expect(thrownOutcome(earlierParts)).toEqual({
      kind: 'again',
      outcome: { kind: 'nothing-new' },
      sequenceId: id,
    });
    expect(saveAction({ kind: 'nothing-new' })).toBe('retry');
    // No record yet: a fresh save, nothing sent.
    const noRecord = new EfsFault('JOURNAL_UNAVAILABLE', 'no journal', {
      sequence: { sequenceId: undefined as never, mayHaveSent: false, sequenceMayHaveSent: false },
    });
    expect(thrownOutcome(noRecord)).toEqual({ kind: 'again', outcome: { kind: 'no-journal' } });
    // May have sent: unconfirmed, whatever else it says.
    const mayHave = new EfsFault('JOURNAL_UNAVAILABLE', 'IndexedDB dropped after broadcast', {
      sequence: { sequenceId: id, mayHaveSent: true, sequenceMayHaveSent: true },
    });
    expect(thrownOutcome(mayHave)).toEqual({
      kind: 'unconfirmed',
      noJournal: true,
      sequenceId: id,
    });
    // Older faults and plain errors carry no proof.
    expect(thrownOutcome(new EfsFault('INVARIANT', 'no sequence facts'))).toEqual({
      kind: 'unconfirmed',
      noJournal: false,
    });
    expect(thrownOutcome(new TypeError('x'))).toEqual({ kind: 'unconfirmed', noJournal: false });
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
      'save.nothingNew',
      'save.expiredPart',
      'save.heldSameBytes',
      'save.heldSameBytesLocal',
      'save.heldSettled',
    ])
      expect(en).toHaveProperty(id);
  });
});

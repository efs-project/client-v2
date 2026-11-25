// What a save's result means to the person. Pure, so tested against every state and the SDK's
// real (code, retry) pairs.
//
// Copy rules (PM, 2026-11-24): never say "saved" before COMPLETE; "Saved · confirming" until
// final, then "Saved"; a reorg is "undone by the network" and re-sending is the person's choice;
// abandoning is not undo; a race with another author reads as "someone else changed it", never
// as the person's save failing; "nothing was sent" only when the SDK proves it.
//
// Order, as the PM's ledger says: the state, then reason.code, then reason.retry. Structured
// fields (`revert`, `wallet`) refine a code; `detail` is free text for logs and never decides.
// Continue is offered only when the same plan can go on: by code (a declined part, a wallet
// switched away) or, for codes this version doesn't name, by retry "transient"/"after-reconcile".

import type { SequenceProgress } from '@efs/sdk/actions';
import type { MessageId } from '../ui/i18n.ts';

export type SaveOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'confirming' }
  /** Some parts are on chain. `canContinue`: the same plan can finish ("Continue to finish"). */
  | {
      readonly kind: 'partial';
      readonly committed: number;
      readonly total: number;
      readonly canContinue: boolean;
    }
  /** The person declined part `part` (1-based) of a save already partly on chain. */
  | {
      readonly kind: 'declined';
      readonly committed: number;
      readonly total: number;
      readonly part: number;
    }
  /** Sent; the network hasn't answered yet (or the answer was lost). Settles by itself. */
  | { readonly kind: 'checking' }
  /** A reorg took a committed part back and it was dropped. Sending again is the person's choice. */
  | { readonly kind: 'undone' }
  /** A reorg took a committed part back; it's in flight again and may still land. Settles itself. */
  | { readonly kind: 'undone-checking' }
  /**
   * Sent, but proven not committed before its deadline (EXPIRED). Nothing of it was saved;
   * `committed` > 0 means earlier parts are on chain. Send again (resume) is the person's click.
   */
  | {
      readonly kind: 'expired';
      readonly committed: number;
      readonly total: number;
    }
  /** Not started and no reason recorded (e.g. listed after a reload): it didn't go through. */
  | { readonly kind: 'not-through' }
  /** Declined in the wallet before anything was sent. */
  | { readonly kind: 'refused' }
  /**
   * The file changed after it was opened (an edit by the same account won the race). When some
   * parts were already sent (`committed` > 0) they stay on chain but won't appear as a file.
   */
  | { readonly kind: 'changed'; readonly committed: number }
  /** This plan can't be sent as prepared; `error` names the ledger's refusal when known. */
  | { readonly kind: 'stale'; readonly error?: string }
  /** The wallet moved to another account or network. Nothing was sent; switch back, Continue. */
  | {
      readonly kind: 'wallet-mismatch';
      readonly account?: string;
      readonly chainId?: number;
    }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'busy' }
  /** This browser won't keep the save journal (e.g. some private modes): saving is off here. */
  | { readonly kind: 'no-journal' }
  | { readonly kind: 'abandoned' }
  /** Not sent, for a reason this version doesn't name. Never shown as success. */
  | { readonly kind: 'not-sent'; readonly code: string; readonly canRetry: boolean }
  /**
   * A call threw, and the SDK says that call sent nothing, but earlier parts of the save may be on
   * chain (or it can't tell): "nothing new was sent", never "nothing was saved".
   */
  | { readonly kind: 'nothing-new' };

/** The ledger refused because the editor's own HEAD moved (compare-and-swap). */
const isCasRace = (reason: SequenceProgress['reason']): boolean =>
  reason?.revert?.error === 'E_CAS';

/** The same plan may go again: the SDK says so for codes this version doesn't name. */
const sameAgain = (retry: string | undefined): boolean =>
  retry === undefined || retry === 'transient' || retry === 'after-reconcile';

export function saveOutcome(p: SequenceProgress): SaveOutcome {
  const reason = p.reason;
  const code = reason?.code;
  // The state first, then the code. A reorg is always the network's doing: while its part is in
  // flight again it may still land (REORGED: the banner keeps checking); once it is proven
  // dropped, re-sending is the person's choice (REORGED_DROPPED: Send again, which resumes).
  switch (p.state) {
    case 'COMPLETE':
      return p.final ? { kind: 'saved' } : { kind: 'confirming' };
    case 'IN_FLIGHT':
      return code === 'REORGED' ? { kind: 'undone-checking' } : { kind: 'checking' };
    case 'ABANDONED':
      return { kind: 'abandoned' };
    case 'PARTIAL':
    case 'NOT_STARTED': {
      const partial = p.state === 'PARTIAL';
      switch (code) {
        case 'REORGED':
        case 'REORGED_DROPPED':
          return { kind: 'undone' };
        case 'EXPIRED':
          return { kind: 'expired', committed: p.committed, total: p.total };
        case 'JOURNAL_UNAVAILABLE':
          return { kind: 'no-journal' };
        case 'WALLET_MISMATCH': {
          const expected = reason?.wallet?.expected;
          return expected
            ? { kind: 'wallet-mismatch', account: expected.account, chainId: expected.chainId }
            : { kind: 'wallet-mismatch' };
        }
        case 'USER_REJECTED':
          return partial
            ? { kind: 'declined', committed: p.committed, total: p.total, part: p.committed + 1 }
            : { kind: 'refused' };
        case 'BUSY':
          return { kind: 'busy' };
        case 'OVER_TX_GAS_CAP':
          return { kind: 'too-large' };
        case 'STALE': {
          if (isCasRace(reason)) return { kind: 'changed', committed: p.committed };
          const error = reason?.revert?.error;
          return partial
            ? { kind: 'partial', committed: p.committed, total: p.total, canContinue: false }
            : error
              ? { kind: 'stale', error }
              : { kind: 'stale' };
        }
        case undefined:
          // No reason recorded: a partial save can go on; one not started didn't go through
          // (never sent, or sent and dropped): never "not sent", which it may not be.
          return partial
            ? { kind: 'partial', committed: p.committed, total: p.total, canContinue: true }
            : { kind: 'not-through' };
        default:
          return partial
            ? {
                kind: 'partial',
                committed: p.committed,
                total: p.total,
                canContinue: sameAgain(reason?.retry),
              }
            : { kind: 'not-sent', code, canRetry: sameAgain(reason?.retry) };
      }
    }
    default:
      return { kind: 'not-sent', code: String(p.state), canRetry: false };
  }
}

/**
 * What a fault thrown out of runSequence/resume says about sending (sdk-v2 #32; absent on older
 * SDKs and on other faults, which then count as "may have sent").
 */
export interface ThrownSave {
  /** The save's record, once it exists (always for resume). */
  readonly sequenceId?: `0x${string}`;
  /** This call may have broadcast something. */
  readonly mayHaveSent?: boolean;
  /** Some part of this save may be on chain, from this call or an earlier one. */
  readonly sequenceMayHaveSent?: boolean;
}

/** An SDK fault thrown (not returned) with this code, e.g. JOURNAL_UNAVAILABLE on a first save. */
export function isFault(error: unknown, code: string): boolean {
  // Matched by name, not instanceof: the shell keeps the SDK's runtime out of its startup code.
  return (
    error instanceof Error &&
    error.name === 'EfsFault' &&
    (error as Error & { code?: unknown }).code === code
  );
}

export const SAVE_MESSAGE: Readonly<Record<SaveOutcome['kind'], MessageId>> = {
  saved: 'save.saved',
  confirming: 'save.confirming',
  partial: 'save.partial',
  declined: 'save.declinedPart',
  checking: 'save.checking',
  undone: 'save.undone',
  'undone-checking': 'save.undoneChecking',
  expired: 'save.expired',
  'not-through': 'save.notThrough',
  refused: 'save.refused',
  changed: 'save.changed',
  stale: 'save.stale',
  'wallet-mismatch': 'save.walletMismatch',
  'too-large': 'save.tooLarge',
  busy: 'save.busy',
  'no-journal': 'save.noJournal',
  abandoned: 'save.abandoned',
  'not-sent': 'save.notSent',
  'nothing-new': 'save.nothingNew',
};

/** The message for an outcome, with the detail some outcomes add. */
export function saveMessage(o: SaveOutcome): MessageId {
  if (o.kind === 'changed' && o.committed > 0) return 'save.changedPartly';
  if (o.kind === 'partial' && !o.canContinue) return 'save.partialStuck';
  if (o.kind === 'stale' && o.error) return 'save.refusedByLedger';
  if (o.kind === 'wallet-mismatch' && o.account) return 'save.walletMismatchTo';
  if (o.kind === 'expired' && o.committed > 0) return 'save.expiredPart';
  return SAVE_MESSAGE[o.kind];
}

/** The values the outcome's message names (chain names resolved by the caller). */
export function saveValues(
  o: SaveOutcome,
  shortAccount: (a: string) => string,
  chainName: (id: number) => string,
): Record<string, string | number> {
  switch (o.kind) {
    case 'partial':
      return { committed: o.committed, total: o.total };
    case 'declined':
      return { committed: o.committed, total: o.total, part: o.part };
    case 'expired':
      return { committed: o.committed, total: o.total, part: o.committed + 1 };
    case 'stale':
      return o.error ? { error: o.error } : {};
    case 'wallet-mismatch':
      return o.account
        ? {
            account: shortAccount(o.account),
            chain: o.chainId === undefined ? '' : chainName(o.chainId),
          }
        : {};
    default:
      return {};
  }
}

export type SaveAction = 'continue' | 'send-again' | 'reopen' | 'retry' | 'abandon';

/** What the person can do next: finish, re-send, edit again, or stop offering to continue. */
export function saveAction(o: SaveOutcome): SaveAction | undefined {
  switch (o.kind) {
    case 'partial':
      return o.canContinue ? 'continue' : 'abandon';
    case 'declined':
    case 'wallet-mismatch':
      return 'continue';
    case 'undone':
    case 'expired':
    case 'not-through':
      return 'send-again';
    case 'changed':
    case 'stale':
      return 'reopen';
    case 'refused':
    case 'busy':
    case 'nothing-new':
      return 'retry';
    case 'not-sent':
      return o.canRetry ? 'retry' : undefined;
    default:
      return undefined;
  }
}

/** What the editor does when runSequence/resume throws instead of returning progress. */
export type ThrownOutcome =
  /** It may have been sent: "We couldn't confirm this save yet", re-read, hold new sends. */
  | { readonly kind: 'unconfirmed'; readonly noJournal: boolean }
  /** This call sent nothing: the same save is offered again (continued when its record exists). */
  | { readonly kind: 'again'; readonly outcome: SaveOutcome; readonly sequenceId?: `0x${string}` };

/**
 * Reads a thrown fault (sdk-v2 #32). Only `mayHaveSent === false` proves this call sent nothing;
 * "nothing was saved" additionally needs `sequenceMayHaveSent === false` (a resumed save can have
 * earlier parts on chain). Anything else, including errors that aren't SDK faults, may have sent.
 */
export function thrownOutcome(error: unknown): ThrownOutcome {
  const noJournal = isFault(error, 'JOURNAL_UNAVAILABLE');
  const fault =
    error instanceof Error && error.name === 'EfsFault' ? (error as Error & ThrownSave) : undefined;
  if (fault?.mayHaveSent !== false) return { kind: 'unconfirmed', noJournal };
  const code = (fault as { code?: unknown }).code;
  const outcome: SaveOutcome = noJournal
    ? { kind: 'no-journal' }
    : fault.sequenceMayHaveSent === false
      ? { kind: 'not-sent', code: typeof code === 'string' ? code : 'FAULT', canRetry: true }
      : { kind: 'nothing-new' };
  return fault.sequenceId
    ? { kind: 'again', outcome, sequenceId: fault.sequenceId }
    : { kind: 'again', outcome };
}

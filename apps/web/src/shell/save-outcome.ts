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
  /** A reorg took a committed part back. Sending again is the person's choice. */
  | { readonly kind: 'undone' }
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
  | { readonly kind: 'not-sent'; readonly code: string; readonly canRetry: boolean };

/** The ledger refused because the editor's own HEAD moved (compare-and-swap). */
const isCasRace = (reason: SequenceProgress['reason']): boolean =>
  reason?.revert?.error === 'E_CAS';

/** The same plan may go again: the SDK says so for codes this version doesn't name. */
const sameAgain = (retry: string | undefined): boolean =>
  retry === undefined || retry === 'transient' || retry === 'after-reconcile';

export function saveOutcome(p: SequenceProgress): SaveOutcome {
  const reason = p.reason;
  const code = reason?.code;
  // A reorg can leave any state behind; it is always the network's doing.
  if (code === 'REORGED') return { kind: 'undone' };
  switch (p.state) {
    case 'COMPLETE':
      return p.final ? { kind: 'saved' } : { kind: 'confirming' };
    case 'IN_FLIGHT':
      return { kind: 'checking' };
    case 'ABANDONED':
      return { kind: 'abandoned' };
    case 'PARTIAL':
    case 'NOT_STARTED': {
      const partial = p.state === 'PARTIAL';
      switch (code) {
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
        default:
          return partial
            ? {
                kind: 'partial',
                committed: p.committed,
                total: p.total,
                canContinue: sameAgain(reason?.retry),
              }
            : { kind: 'not-sent', code: code ?? 'NOT_STARTED', canRetry: sameAgain(reason?.retry) };
      }
    }
    default:
      return { kind: 'not-sent', code: String(p.state), canRetry: false };
  }
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
  refused: 'save.refused',
  changed: 'save.changed',
  stale: 'save.stale',
  'wallet-mismatch': 'save.walletMismatch',
  'too-large': 'save.tooLarge',
  busy: 'save.busy',
  'no-journal': 'save.noJournal',
  abandoned: 'save.abandoned',
  'not-sent': 'save.notSent',
};

/** The message for an outcome, with the detail some outcomes add. */
export function saveMessage(o: SaveOutcome): MessageId {
  if (o.kind === 'changed' && o.committed > 0) return 'save.changedPartly';
  if (o.kind === 'partial' && !o.canContinue) return 'save.partialStuck';
  if (o.kind === 'stale' && o.error) return 'save.refusedByLedger';
  if (o.kind === 'wallet-mismatch' && o.account) return 'save.walletMismatchTo';
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
      return 'send-again';
    case 'changed':
    case 'stale':
      return 'reopen';
    case 'refused':
    case 'busy':
      return 'retry';
    case 'not-sent':
      return o.canRetry ? 'retry' : undefined;
    default:
      return undefined;
  }
}

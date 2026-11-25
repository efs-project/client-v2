// What a save's result means to the person. Pure, so tested against every state and reason.
//
// Copy rules (PM, 2026-11-24): never say "saved" before COMPLETE; "Saved · confirming" until
// final, then "Saved"; a reorg is "undone by the network" and re-sending is the person's choice;
// abandoning is not undo; a race with another author reads as "someone else changed it", never
// as the person's save failing. Branch on state, then reason.code and reason.retry; never parse
// free text, except the E_CAS marker the SDK documents for the same-account race (until every
// STALE reason carries `revert`).
//
// Continue is offered only when the SDK says the same plan can go on (retry "transient" or
// "after-reconcile", or no reason). "after-replan" means this save can't finish as planned:
// continuing would fail the same way every time, so the person re-opens and edits again.

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
  /** Sent; the network hasn't answered yet (or the answer was lost). Settles by itself. */
  | { readonly kind: 'checking' }
  /** A reorg took a committed part back. Sending again is the person's choice. */
  | { readonly kind: 'undone' }
  | { readonly kind: 'refused' }
  /**
   * The file changed after it was opened (an edit by the same account won the race). When some
   * parts were already sent (`committed` > 0) they stay on chain but won't appear as a file.
   */
  | { readonly kind: 'changed'; readonly committed: number }
  | { readonly kind: 'stale' }
  /** The wallet moved to another account or network before sending. Nothing was sent. */
  | { readonly kind: 'wallet-mismatch' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'busy' }
  /** This browser won't keep the save journal (e.g. some private modes): saving is off here. */
  | { readonly kind: 'no-journal' }
  | { readonly kind: 'abandoned' }
  /** Not sent, for a reason this version doesn't name. Never shown as success. */
  | { readonly kind: 'not-sent'; readonly code: string };

/** The ledger refused because the editor's own HEAD moved (compare-and-swap). */
function isCasRace(reason: SequenceProgress['reason']): boolean {
  // `revert` arrives with the SDK's structured reasons; older reasons only carry `detail`.
  const revert = (reason as { revert?: { error?: string } } | undefined)?.revert;
  if (revert) return revert.error === 'E_CAS';
  return reason?.detail?.includes('E_CAS') ?? false;
}

export function saveOutcome(p: SequenceProgress): SaveOutcome {
  const code = p.reason?.code;
  const retry = p.reason?.retry;
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
      if (code === 'JOURNAL_UNAVAILABLE') return { kind: 'no-journal' };
      if (code === 'WALLET_MISMATCH') return { kind: 'wallet-mismatch' };
      if (code === 'STALE' || retry === 'after-replan') {
        return isCasRace(p.reason)
          ? { kind: 'changed', committed: p.committed }
          : p.state === 'PARTIAL'
            ? { kind: 'partial', committed: p.committed, total: p.total, canContinue: false }
            : { kind: 'stale' };
      }
      if (code === 'OVER_TX_GAS_CAP') return { kind: 'too-large' };
      if (code === 'BUSY') return { kind: 'busy' };
      if (p.state === 'PARTIAL') {
        return {
          kind: 'partial',
          committed: p.committed,
          total: p.total,
          canContinue: retry !== 'never',
        };
      }
      if (code === 'USER_REJECTED') return { kind: 'refused' };
      return { kind: 'not-sent', code: code ?? 'NOT_STARTED' };
    }
    default:
      return { kind: 'not-sent', code: String(p.state) };
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
  return SAVE_MESSAGE[o.kind];
}

export type SaveAction = 'continue' | 'send-again' | 'reopen' | 'retry' | 'abandon';

/** What the person can do next: finish, re-send, edit again, or stop offering to continue. */
export function saveAction(o: SaveOutcome): SaveAction | undefined {
  switch (o.kind) {
    case 'partial':
      return o.canContinue ? 'continue' : 'abandon';
    case 'wallet-mismatch':
      return 'continue';
    case 'undone':
      return 'send-again';
    case 'changed':
    case 'stale':
      return 'reopen';
    case 'refused':
    case 'busy':
    case 'not-sent':
      return 'retry';
    default:
      return undefined;
  }
}

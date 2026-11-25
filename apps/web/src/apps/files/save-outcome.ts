// What a save's result means to the person. Pure, so tested against every state and reason.
//
// Copy rules (PM, 2026-11-24): never say "saved" before COMPLETE; "Saved · confirming" until
// final, then "Saved"; a reorg is "undone by the network" and re-sending is the person's choice;
// abandoning is not undo; a race with another author reads as "someone else changed it", never
// as the person's save failing. Branch on state, then reason.code; never parse free text, except
// the E_CAS marker the SDK documents for the same-account race.

import type { SequenceProgress } from '@efs/sdk/actions';
import type { MessageId } from '../../ui/i18n.ts';

export type SaveOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'confirming' }
  | { readonly kind: 'partial'; readonly committed: number; readonly total: number }
  /** Sent; the network hasn't answered yet (or the answer was lost). Settles by itself. */
  | { readonly kind: 'checking' }
  /** A reorg took a committed part back. Sending again is the person's choice. */
  | { readonly kind: 'undone' }
  | { readonly kind: 'refused' }
  /** The file changed after it was opened (another tab of the same account won the race). */
  | { readonly kind: 'changed' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'busy' }
  /** This browser won't keep the save journal (e.g. some private modes): saving is off here. */
  | { readonly kind: 'no-journal' }
  | { readonly kind: 'abandoned' }
  /** Not sent, for a reason this version doesn't name. Never shown as success. */
  | { readonly kind: 'not-sent'; readonly code: string };

export function saveOutcome(p: SequenceProgress): SaveOutcome {
  const code = p.reason?.code;
  if (code === 'REORGED') return { kind: 'undone' };
  switch (p.state) {
    case 'COMPLETE':
      return p.final ? { kind: 'saved' } : { kind: 'confirming' };
    case 'PARTIAL':
      return { kind: 'partial', committed: p.committed, total: p.total };
    case 'IN_FLIGHT':
      return { kind: 'checking' };
    case 'ABANDONED':
      return { kind: 'abandoned' };
    case 'NOT_STARTED':
      if (code === 'USER_REJECTED') return { kind: 'refused' };
      if (code === 'STALE') {
        return p.reason?.detail?.includes('E_CAS') ? { kind: 'changed' } : { kind: 'stale' };
      }
      if (code === 'OVER_TX_GAS_CAP') return { kind: 'too-large' };
      if (code === 'BUSY') return { kind: 'busy' };
      if (code === 'JOURNAL_UNAVAILABLE') return { kind: 'no-journal' };
      return { kind: 'not-sent', code: code ?? 'NOT_STARTED' };
    default:
      return { kind: 'not-sent', code: String(p.state) };
  }
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
  'too-large': 'save.tooLarge',
  busy: 'save.busy',
  'no-journal': 'save.noJournal',
  abandoned: 'save.abandoned',
  'not-sent': 'save.notSent',
};

/** Whether the person can act: re-send, continue, or plan again. */
export function saveAction(
  o: SaveOutcome,
): 'continue' | 'send-again' | 'reopen' | 'retry' | undefined {
  switch (o.kind) {
    case 'partial':
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

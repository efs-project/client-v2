// Whether a new save of a file must wait for an earlier one, from the saves the banner shows.
// Pure, so the release rule is tested on the SDK's own facts (sdk-v2 #34).
//
// A save that isn't settled holds new saves of its file (records without an `effect` don't say
// their file, so they hold every file of the account). PARTIAL and NOT_STARTED wait for the
// person (finish or stop). IN_FLIGHT waits for the ledger, and is released once a successful
// ledger read finds the latest block past the part's deadline with the part not committed
// (`pastDeadline`, fail-closed): short of a reorg it can't land then, and a late landing would
// only make the new save be refused as changed. That release is never "proven not saved".

import type { SequenceProgress } from '@efs/sdk/actions';
import { unsettled } from './saves-state.ts';

export type SaveHold =
  | { readonly kind: 'unsettled' }
  /** At most `minutes` until the deadline, as of chain `block`; unknown before a ledger read. */
  | { readonly kind: 'waiting'; readonly minutes?: number; readonly block?: bigint };

export interface SaveHoldInput {
  readonly account: string;
  /** The file about to be saved (its SubjectId). */
  readonly file: string;
  /** The save a review is continuing: it never holds itself. */
  readonly except?: string | undefined;
}

export function saveHold(
  saves: readonly SequenceProgress[],
  { account, file, except }: SaveHoldInput,
): { readonly hold?: SaveHold; readonly lapsed: boolean } {
  const me = account.toLowerCase();
  const target = file.toLowerCase();
  let waiting: { minutes: number; block: bigint } | undefined;
  let waitingUnknown = false;
  let lapsed = false;
  for (const p of saves) {
    if (p.sequenceId === except || !unsettled(p)) continue;
    if (p.account.toLowerCase() !== me) continue;
    const of = p.effect?.kind === 'files.edit' ? p.effect.file : undefined;
    if (of && of.toLowerCase() !== target) continue;
    if (p.state !== 'IN_FLIGHT') return { hold: { kind: 'unsettled' }, lapsed: false };
    const current = p.current;
    if (current?.pastDeadline === true) {
      lapsed = true;
      continue;
    }
    const deadline = current?.deadline;
    const checked = current?.checkedAt;
    if (deadline === undefined || checked === undefined) {
      waitingUnknown = true;
      continue;
    }
    const minutes = Math.max(1, Math.ceil(Number(deadline - checked.timestamp) / 60));
    if (!waiting || minutes > waiting.minutes) waiting = { minutes, block: checked.blockNumber };
  }
  if (waitingUnknown) return { hold: { kind: 'waiting' }, lapsed: false };
  if (waiting) return { hold: { kind: 'waiting', ...waiting }, lapsed: false };
  return { lapsed };
}

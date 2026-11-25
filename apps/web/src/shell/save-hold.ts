// Whether a new save of a file must wait for an earlier one, from the saves the banner shows.
// Pure, so the release rule is tested on the SDK's own facts (sdk-v2 #34).
//
// A save that isn't settled holds new saves of what it touches, read from its `effect`: an edit
// holds its file; a folder operation (create, createFolder, move, remove, restore) holds each
// (folder, name) it names, a move both the place it leaves and the place it goes to. An edit and a
// folder operation don't hold each other. A missing, unknown or malformed effect says nothing
// about what it touches, so it holds every save of the account (fail-closed). PARTIAL and NOT_STARTED wait for the
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

/** One name in one folder: the folder's files-directory/1 record id, and the exact name. */
export interface Place {
  readonly folder: string;
  readonly name: string;
}

export interface SaveHoldInput {
  readonly account: string;
  /** An edit: the file about to be saved (its SubjectId). */
  readonly file?: string;
  /** A folder operation: every (folder, name) it touches (a move: both ends). */
  readonly places?: readonly Place[];
  /** The save a review is continuing: it never holds itself. */
  readonly except?: string | undefined;
}

type Touches =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'places'; readonly keys: ReadonlySet<string> }
  | { readonly kind: 'unknown' };

/** Folder ids compare case-insensitively (hex); names are exact (files-name/2 is byte-exact). */
export const placeKey = (folder: unknown, name: unknown): string | undefined =>
  typeof folder === 'string' && typeof name === 'string'
    ? `${folder.toLowerCase()}\u0000${name}`
    : undefined;

function keysOf(pairs: readonly (readonly [unknown, unknown])[]): Touches {
  const keys = new Set<string>();
  for (const [folder, name] of pairs) {
    const key = placeKey(folder, name);
    if (key === undefined) return { kind: 'unknown' };
    keys.add(key);
  }
  return keys.size > 0 ? { kind: 'places', keys } : { kind: 'unknown' };
}

/** What an unsettled save touches, from its effect; anything unrecognized is 'unknown'. */
export function touchesOf(effect: SequenceProgress['effect']): Touches {
  const e = effect as Record<string, unknown> | undefined;
  switch (e?.kind) {
    case 'files.edit':
      return typeof e.file === 'string'
        ? { kind: 'file', file: e.file.toLowerCase() }
        : { kind: 'unknown' };
    case 'files.create':
    case 'files.createFolder':
      return keysOf([[e.folder, e.name]]);
    case 'files.move':
      return Array.isArray(e.moves)
        ? keysOf(
            (e.moves as Record<string, unknown>[]).flatMap(
              (m) =>
                [
                  [m.folder, m.name],
                  [m.toFolder, m.toName],
                ] as const,
            ),
          )
        : { kind: 'unknown' };
    case 'files.remove':
    case 'files.restore':
    case 'files.unhide':
    case 'files.hide':
      return Array.isArray(e.entries)
        ? keysOf((e.entries as Record<string, unknown>[]).map((x) => [x.folder, x.name] as const))
        : { kind: 'unknown' };
    default:
      return { kind: 'unknown' };
  }
}

/** Whether two saves certainly touch nothing in common. Anything unknown is not disjoint. */
function disjoint(a: Touches, b: Touches): boolean {
  if (a.kind === 'unknown' || b.kind === 'unknown') return false;
  if (a.kind === 'file' && b.kind === 'file') return a.file !== b.file;
  if (a.kind === 'places' && b.kind === 'places') {
    for (const key of a.keys) if (b.keys.has(key)) return false;
    return true;
  }
  // An edit changes a file's contents; a folder operation changes placements.
  return true;
}

export function saveHold(
  saves: readonly SequenceProgress[],
  { account, file, places, except }: SaveHoldInput,
): { readonly hold?: SaveHold; readonly lapsed: boolean } {
  const me = account.toLowerCase();
  const mine: Touches =
    file !== undefined
      ? { kind: 'file', file: file.toLowerCase() }
      : places !== undefined
        ? keysOf(places.map((x) => [x.folder, x.name] as const))
        : { kind: 'unknown' };
  let waiting: { minutes: number; block: bigint } | undefined;
  let waitingUnknown = false;
  let lapsed = false;
  for (const p of saves) {
    if (p.sequenceId === except || !unsettled(p)) continue;
    if (p.account.toLowerCase() !== me) continue;
    if (disjoint(touchesOf(p.effect), mine)) continue;
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

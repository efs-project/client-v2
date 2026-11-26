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
import type { MessageId } from '../ui/i18n.ts';
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
  /** A tag save: every (topic, thing) statement it makes (statementKey), from its review. */
  readonly statements?: readonly string[];
  /** The save a review is continuing: it never holds itself. */
  readonly except?: string | undefined;
}

export type Touches =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'places'; readonly keys: ReadonlySet<string> }
  /** Tag statements (and labels and links between tags): one key per (subject, what). */
  | { readonly kind: 'statements'; readonly keys: ReadonlySet<string> }
  | { readonly kind: 'unknown' };

/** One statement's key: a topic (or a home) and what it says about (a thing, or a label). */
export const statementKey = (topic: string, thing: string): string =>
  `${topic.toLowerCase()}\u0000${thing.toLowerCase()}`;

/** A save's statements, or unknown when the effect doesn't name them cleanly. */
function statementsOf(topic: unknown, things: unknown): Touches {
  if (typeof topic !== 'string' || !Array.isArray(things)) return { kind: 'unknown' };
  const keys = new Set<string>();
  for (const thing of things) {
    if (typeof thing !== 'string') return { kind: 'unknown' };
    keys.add(statementKey(topic, thing));
  }
  return { kind: 'statements', keys };
}

/** Folder ids compare case-insensitively (hex); names are exact (files-name/3 is byte-exact). */
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
    // Tag saves (sdk-v2 983d70b): the statements they make, at one topic (or home) each.
    case 'tags.tag':
    case 'tags.deny':
    case 'tags.untag':
      return statementsOf(e.topic, e.targets);
    // Registration only: it makes no statement, so it holds no statement.
    case 'tags.register':
      return { kind: 'statements', keys: new Set() };
    case 'tags.label':
      return typeof e.lang === 'string'
        ? statementsOf(e.subject, [`label:${e.lang}`])
        : { kind: 'unknown' };
    case 'tags.same':
    case 'tags.broader':
      return typeof e.other === 'string'
        ? statementsOf(e.subject, [`${e.kind}:${e.other}`])
        : { kind: 'unknown' };
    default:
      return { kind: 'unknown' };
  }
}

/** Whether two saves certainly touch nothing in common. Anything unknown is not disjoint. */
function disjoint(a: Touches, b: Touches): boolean {
  if (a.kind === 'unknown' || b.kind === 'unknown') return false;
  if (a.kind === 'file' && b.kind === 'file') return a.file !== b.file;
  if (
    (a.kind === 'places' && b.kind === 'places') ||
    (a.kind === 'statements' && b.kind === 'statements')
  ) {
    for (const key of a.keys) if (b.keys.has(key)) return false;
    return true;
  }
  // An edit changes a file's contents; a folder operation changes placements.
  return true;
}

/** What a save about to be sent touches, from its review (unknown when it names nothing). */
export function touchesOfInput({ file, places, statements }: SaveHoldInput): Touches {
  return file !== undefined
    ? { kind: 'file', file: file.toLowerCase() }
    : statements !== undefined
      ? { kind: 'statements', keys: new Set(statements.map((k) => k.toLowerCase())) }
      : places !== undefined
        ? keysOf(places.map((x) => [x.folder, x.name] as const))
        : { kind: 'unknown' };
}

export function saveHold(
  saves: readonly SequenceProgress[],
  input: SaveHoldInput,
): { readonly hold?: SaveHold; readonly lapsed: boolean } {
  const { account, except } = input;
  const me = account.toLowerCase();
  const mine = touchesOfInput(input);
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

/**
 * Where a held-back save stands against its twin (the earlier attempt of the same publication),
 * from the saves listed (`saves`; undefined while they can't be read):
 * - 'same': the same save again (it touches what the twin's save touches, or the SDK named no
 *   save for the twin): "already being saved", and never a second Send;
 * - 'waiting': another save of the same bytes, still open or not yet final: Send waits for it;
 * - 'settled': that other save is final or stopped: this one may be sent again;
 * - 'unlisted': the SDK named a save the list doesn't hold (another tab's, or one that dropped
 *   off): unknown, never settled. The caller checks the twin's attempt (`twinFromReconcile`) and
 *   waits meanwhile.
 * Unknown effects count as the same (fail-closed: no Send).
 */
export type TwinStanding = 'same' | 'waiting' | 'settled' | 'unlisted';

export function twinStanding(
  twin: { readonly sequenceId?: string } | undefined,
  saves: readonly SequenceProgress[] | undefined,
  mine: Touches,
): TwinStanding {
  const id = twin?.sequenceId?.toLowerCase();
  if (id === undefined) return 'same';
  if (saves === undefined) return 'waiting';
  const earlier = saves.find((p) => p.sequenceId.toLowerCase() === id);
  if (!earlier) return 'unlisted';
  if (!disjoint(touchesOf(earlier.effect), mine)) return 'same';
  if (earlier.state === 'COMPLETE') return earlier.final ? 'settled' : 'waiting';
  return earlier.state === 'ABANDONED' || earlier.state === 'NOT_STARTED' ? 'settled' : 'waiting';
}

/** What a held-back save says, by its standing (`localChain`: this computer's test chain). */
export function heldMessage(standing: TwinStanding, localChain: boolean): MessageId {
  switch (standing) {
    case 'same':
      return 'save.held';
    case 'waiting':
    case 'unlisted':
      return localChain ? 'save.heldSameBytesLocal' : 'save.heldSameBytes';
    case 'settled':
      return 'save.heldSettled';
  }
}

/**
 * An unlisted twin, decided by its attempt (`writer.reconcile(planId)`): final or proven not
 * committed lets this save go; anything else (committed but not final, unknown) waits.
 */
export function twinFromReconcile(r: {
  readonly outcome: 'COMMITTED' | 'NOT_COMMITTED_PROVEN' | 'UNKNOWN';
  readonly final?: boolean;
}): 'settled' | 'waiting' {
  return r.outcome === 'NOT_COMMITTED_PROVEN' || (r.outcome === 'COMMITTED' && r.final === true)
    ? 'settled'
    : 'waiting';
}

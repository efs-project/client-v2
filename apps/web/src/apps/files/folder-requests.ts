// What the person asked a folder to do, as plain data: the places it holds, how the SDK plans it,
// and the words for each refusal. Pure apart from the injected planners, so every rule is tested.

import type { Efs, Lens } from '@efs/sdk';
import type { EfsWriter } from '@efs/sdk/actions';
import type { EntryRef, FolderPlanResult, FolderRef, ParentRef } from '@efs/sdk/files';
import type { TagPlace, TagPlanResult, TagTarget } from '@efs/sdk/tags';
import type { Place } from '../../shell/save-hold.ts';
import type { MessageId } from '../../ui/i18n.ts';

/** The planners the dialog needs, injected so tests can replay recorded results. */
export type FolderPlanners = Pick<
  typeof import('@efs/sdk/files'),
  | 'planCreateFile'
  | 'planCreateFolder'
  | 'planMoveEntries'
  | 'planRemoveEntries'
  | 'planRestoreEntries'
  | 'planUnhideEntries'
> &
  Pick<typeof import('@efs/sdk/tags'), 'planTag' | 'planDeny' | 'planUntag'>;

export type FolderRequest =
  | { readonly kind: 'createFolder'; readonly folder: FolderRef; readonly name: string }
  /** Upload: a new file from bytes, with the media type its bytes support ("" unknown). */
  | {
      readonly kind: 'createFile';
      readonly folder: FolderRef;
      readonly name: string;
      readonly content: Uint8Array;
      readonly mediaType: string;
    }
  | { readonly kind: 'rename'; readonly from: EntryRef; readonly to: string }
  /**
   * Entries into another folder, each under its own name: one plan for the whole selection. A
   * folder among them needs the path to `to` (`via`), which goes with the folders only.
   */
  | {
      readonly kind: 'move';
      readonly moves: readonly { readonly from: EntryRef; readonly isFolder: boolean }[];
      readonly to: FolderRef;
      readonly via?: ViewPath;
    }
  | {
      readonly kind: 'remove';
      readonly entries: readonly EntryRef[];
      /** Masks the name (only offered to the folder's owner); a release otherwise. */
      readonly hide: boolean;
    }
  | { readonly kind: 'restore'; readonly entries: readonly RestoreEntry[] }
  /**
   * Unblock: release the person's own blocks at these names (a lone block of someone else's
   * entry, NEVER_BOUND), so the Lens shows the next author's entry there again.
   */
  | { readonly kind: 'unhide'; readonly entries: readonly EntryRef[] }
  /**
   * A tag (one author's statement about each target at one place: a tag's words, or an address).
   * `stance`: "tag" (it applies, number ≥ 0, default 0), "deny" ("Not this", below 0, default −1),
   * or "untag" (Remove my tag: back to saying nothing).
   */
  | {
      readonly kind: 'tag';
      readonly place: TagPlace;
      readonly targets: readonly TagTarget[];
      readonly stance: 'tag' | 'deny' | 'untag';
      readonly number?: number;
    };

/**
 * The path to a folder from the start of the person's view (the realm's root, by names): what a
 * folder restore (the entry's folder) or move (the destination) needs, so the SDK can check the
 * folder never lands inside itself. The SDK resolves it again against the chain.
 */
export interface ViewPath {
  /** Where the path starts: the realm's root, or an address the person came in through. */
  readonly from: ParentRef;
  readonly segments: readonly string[];
}

/** One entry to restore; a folder needs the path to its folder (`via`). */
export type RestoreEntry = EntryRef & { readonly via?: ViewPath };

/**
 * A folder's (folder, name) key. A home parent (an address) has no key here yet: the client
 * doesn't place entries under an address until homes are wired, and its key is the SDK's padded
 * address, so a request naming one is held fail-closed (undefined) rather than keyed by guess.
 */
const place = (parent: ParentRef, name: string): Place | undefined =>
  parent.kind === 'folder' ? { folder: parent.directory.toLowerCase(), name } : undefined;

/** All the places, or undefined (fail-closed) when any of them can't be keyed. */
const known = (places: readonly (Place | undefined)[]): readonly Place[] | undefined =>
  places.every((p) => p !== undefined) ? (places as readonly Place[]) : undefined;

/**
 * Every (folder, name) the request touches: what a send of it holds, and what holds it. Undefined
 * when one can't be keyed: then it holds, and is held by, every unsettled save of the account.
 */
export function placesOf(r: FolderRequest): readonly Place[] | undefined {
  switch (r.kind) {
    case 'createFolder':
    case 'createFile':
      return known([place(r.folder, r.name)]);
    case 'rename':
      return known([place(r.from.folder, r.from.name), place(r.from.folder, r.to)]);
    case 'move':
      return known(
        r.moves.flatMap((m) => [place(m.from.folder, m.from.name), place(r.to, m.from.name)]),
      );
    case 'remove':
    case 'restore':
    case 'unhide':
      return known(r.entries.map((e) => place(e.folder, e.name)));
    case 'tag':
      // A tag is a statement at a tag (or an address), never a folder entry: it holds no name.
      return [];
  }
}

export type AnyFolderPlan =
  | TagPlanResult
  | FolderPlanResult<
      | import('@efs/sdk/files').CreateFileReview
      | import('@efs/sdk/files').CreateFolderReview
      | import('@efs/sdk/files').MoveReview
      | import('@efs/sdk/files').RemoveReview
      | import('@efs/sdk/files').RestoreReview
      | import('@efs/sdk/files').UnhideReview
    >;

/** Plans `r` through the SDK, in the Lens the person sees the folder through. */
export function planRequest(
  planners: FolderPlanners,
  efs: Efs,
  writer: EfsWriter,
  r: FolderRequest,
  lens: Lens,
  signal: AbortSignal,
): Promise<AnyFolderPlan> {
  const o = { signal };
  switch (r.kind) {
    case 'createFolder':
      return planners.planCreateFolder(efs, writer, { folder: r.folder, name: r.name, lens }, o);
    case 'createFile':
      return planners.planCreateFile(
        efs,
        writer,
        { folder: r.folder, name: r.name, content: r.content, mediaType: r.mediaType, lens },
        o,
      );
    case 'rename':
      return planners.planMoveEntries(
        efs,
        writer,
        { moves: [{ from: r.from, to: { name: r.to } }], lens },
        o,
      );
    case 'move':
      return planners.planMoveEntries(
        efs,
        writer,
        {
          moves: r.moves.map((m) => ({
            from: m.from,
            to: { folder: r.to, ...(m.isFolder && r.via ? { via: r.via } : {}) },
          })),
          lens,
        },
        o,
      );
    case 'remove':
      return planners.planRemoveEntries(
        efs,
        writer,
        { entries: r.entries, ...(r.hide ? { hide: true } : {}), lens },
        o,
      );
    case 'restore':
      return planners.planRestoreEntries(efs, writer, { entries: r.entries, lens }, o);
    case 'unhide':
      return planners.planUnhideEntries(efs, writer, { entries: r.entries, lens }, o);
    case 'tag': {
      // A tag is the writer's own statement: no Lens decides it.
      const input = { topic: r.place, targets: r.targets };
      if (r.stance === 'untag') return planners.planUntag(efs, writer, input, o);
      const at = { ...input, ...(r.number !== undefined ? { number: r.number } : {}) };
      return r.stance === 'deny'
        ? planners.planDeny(efs, writer, at, o)
        : planners.planTag(efs, writer, at, o);
    }
  }
}

/**
 * The request without the items at `indices` (a refusal's input indices): "Leave these out and
 * review the rest". Undefined when nothing would be left, or the request isn't a selection.
 */
export function withoutIndices(
  r: FolderRequest,
  indices: readonly number[],
): FolderRequest | undefined {
  const drop = new Set(indices);
  const keep = <T>(items: readonly T[]) => items.filter((_, i) => !drop.has(i));
  switch (r.kind) {
    case 'move': {
      const moves = keep(r.moves);
      return moves.length > 0 ? { ...r, moves } : undefined;
    }
    case 'remove': {
      const entries = keep(r.entries);
      return entries.length > 0 ? { ...r, entries } : undefined;
    }
    case 'restore': {
      const entries = keep(r.entries);
      return entries.length > 0 ? { ...r, entries } : undefined;
    }
    case 'unhide': {
      const entries = keep(r.entries);
      return entries.length > 0 ? { ...r, entries } : undefined;
    }
    case 'tag': {
      const targets = keep(r.targets);
      return targets.length > 0 ? { ...r, targets } : undefined;
    }
    default:
      return undefined;
  }
}

const REFUSAL: Readonly<Record<string, MessageId>> = {
  NAME_TAKEN_MINE: 'files.name.takenMine',
  NOT_YOURS: 'files.notYours',
  FOLDER_ABSENT: 'files.refused.folderAbsent',
  ENTRY_ABSENT: 'files.refused.entryAbsent',
  NOT_REMOVED: 'files.refused.notRemoved',
  PATH_CHANGED: 'files.refused.pathChanged',
  NEVER_BOUND: 'files.refused.neverBound',
  HISTORY_UNKNOWN: 'files.refused.historyUnknown',
  NOT_HIDDEN: 'files.refused.notHidden',
  TARGET_ABSENT: 'files.refused.targetAbsent',
  UNCHANGED: 'files.refused.tagUnchanged',
  NOT_STATED: 'files.refused.notStated',
};

/** The words for a refusal code; an unknown code is shown raw, never as success. */
export function refusalMessage(code: string): MessageId {
  return Object.hasOwn(REFUSAL, code) ? (REFUSAL[code] as MessageId) : 'files.refused.unknown';
}

/** The message for a name `checkName` refused, by its rule. */
const NAME_RULE: Readonly<Record<string, MessageId>> = {
  empty: 'files.name.rule.empty',
  'too-long': 'files.name.rule.tooLong',
  'dot-or-dotdot': 'files.name.rule.dots',
  'reserved-prefix': 'files.name.rule.reserved',
  'malformed-utf8': 'files.name.rule.character',
  'excluded-character': 'files.name.rule.character',
  'leading-whitespace': 'files.name.rule.space',
  'trailing-whitespace': 'files.name.rule.space',
};

export function nameRuleMessage(rule: string): MessageId {
  return Object.hasOwn(NAME_RULE, rule)
    ? (NAME_RULE[rule] as MessageId)
    : 'files.name.rule.character';
}

/** Why a reviewed folder save can't be sent now, in the order it's checked. */
export type FolderHold =
  /** An earlier send touching these places (or naming nothing) may have gone out: paused. */
  | { readonly kind: 'paused' }
  /** No wallet ready on this network. */
  | { readonly kind: 'wallet' }
  /** The wallet now shows another account than the one this save was prepared (and signs) for. */
  | { readonly kind: 'account'; readonly signer: string; readonly connected: string }
  /** An unsettled save of the signer's touches one of these places. */
  | { readonly kind: 'held' };

export interface FolderHoldInput {
  readonly availability: import('../../shell/writer-state.ts').WriterAvailability;
  /** The account the plan was made for: the writer that will sign (never the one on screen). */
  readonly signer: string;
  readonly unconfirmed: readonly import('../../shell/saves-state.ts').Unconfirmed[];
  readonly saves: readonly import('@efs/sdk/actions').SequenceProgress[];
  /** Undefined: places that can't be keyed (fail-closed: any unconfirmed or unsettled save holds). */
  readonly places: readonly Place[] | undefined;
  /** A tag save: its statements (topic and thing, from its review), held by statement. */
  readonly statements?: readonly string[];
  /** The save this review continues: it never holds itself. */
  readonly except?: string | undefined;
}

/**
 * The send rule for folder saves, as the editor's: the unconfirmed pause first; then a READY
 * wallet on the same account the plan signs as; then the signer's unsettled saves at these
 * places (fail-closed for anything that names nothing). `lapsed`: an earlier save's deadline
 * passed without it landing, so it no longer holds (said as a warning).
 */
export function folderHold(
  input: FolderHoldInput,
  saveHold: typeof import('../../shell/save-hold.ts').saveHold,
): { readonly hold?: FolderHold; readonly lapsed: boolean } {
  const keys = new Set((input.places ?? []).map((p) => `${p.folder.toLowerCase()}\u0000${p.name}`));
  const paused = input.unconfirmed.some((u) =>
    input.places === undefined
      ? true
      : u.places
        ? u.places.some((p) => keys.has(`${p.folder.toLowerCase()}\u0000${p.name}`))
        : u.file === undefined,
  );
  if (paused) return { hold: { kind: 'paused' }, lapsed: false };
  const a = input.availability;
  if (a.status !== 'READY') return { hold: { kind: 'wallet' }, lapsed: false };
  if (a.account.toLowerCase() !== input.signer.toLowerCase()) {
    return {
      hold: { kind: 'account', signer: input.signer, connected: a.account },
      lapsed: false,
    };
  }
  const { hold, lapsed } = saveHold(input.saves, {
    account: input.signer,
    ...(input.statements
      ? { statements: input.statements }
      : input.places
        ? { places: input.places }
        : {}),
    except: input.except,
  });
  return hold ? { hold: { kind: 'held' }, lapsed } : { lapsed };
}

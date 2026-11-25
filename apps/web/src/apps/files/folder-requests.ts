// What the person asked a folder to do, as plain data: the places it holds, how the SDK plans it,
// and the words for each refusal. Pure apart from the injected planners, so every rule is tested.

import type { Efs, Lens } from '@efs/sdk';
import type { EfsWriter } from '@efs/sdk/actions';
import type { EntryRef, FolderPlanResult, FolderRef } from '@efs/sdk/files';
import type { Place } from '../../shell/save-hold.ts';
import type { MessageId } from '../../ui/i18n.ts';

/** The planners the dialog needs, injected so tests can replay recorded results. */
export type FolderPlanners = Pick<
  typeof import('@efs/sdk/files'),
  'planCreateFolder' | 'planMoveEntries' | 'planRemoveEntries' | 'planRestoreEntries'
>;

export type FolderRequest =
  | { readonly kind: 'createFolder'; readonly folder: FolderRef; readonly name: string }
  | { readonly kind: 'rename'; readonly from: EntryRef; readonly to: string }
  | {
      readonly kind: 'remove';
      readonly entries: readonly EntryRef[];
      /** Masks the name (only offered to the folder's owner); a release otherwise. */
      readonly hide: boolean;
    }
  | { readonly kind: 'restore'; readonly entries: readonly EntryRef[] };

const place = (folder: FolderRef, name: string): Place => ({
  folder: folder.directory.toLowerCase(),
  name,
});

/** Every (folder, name) the request touches: what a send of it holds, and what holds it. */
export function placesOf(r: FolderRequest): readonly Place[] {
  switch (r.kind) {
    case 'createFolder':
      return [place(r.folder, r.name)];
    case 'rename':
      return [place(r.from.folder, r.from.name), place(r.from.folder, r.to)];
    case 'remove':
    case 'restore':
      return r.entries.map((e) => place(e.folder, e.name));
  }
}

export type AnyFolderPlan = FolderPlanResult<
  | import('@efs/sdk/files').CreateFolderReview
  | import('@efs/sdk/files').MoveReview
  | import('@efs/sdk/files').RemoveReview
  | import('@efs/sdk/files').RestoreReview
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
    case 'rename':
      return planners.planMoveEntries(
        efs,
        writer,
        { moves: [{ from: r.from, to: { name: r.to } }], lens },
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
  }
}

const REFUSAL: Readonly<Record<string, MessageId>> = {
  NAME_TAKEN_MINE: 'files.name.takenMine',
  NOT_YOURS: 'files.notYours',
  FOLDER_ABSENT: 'files.refused.folderAbsent',
  ENTRY_ABSENT: 'files.refused.entryAbsent',
  NOT_REMOVED: 'files.refused.notRemoved',
  PATH_CHANGED: 'files.refused.pathChanged',
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
  readonly places: readonly Place[];
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
  const keys = new Set(input.places.map((p) => `${p.folder.toLowerCase()}\u0000${p.name}`));
  const paused = input.unconfirmed.some((u) =>
    u.places
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
    places: input.places,
    except: input.except,
  });
  return hold ? { hold: { kind: 'held' }, lapsed } : { lapsed };
}

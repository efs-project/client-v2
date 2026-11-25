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

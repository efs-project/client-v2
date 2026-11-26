// The folder picker's rules ("Move to…"), pure so each is tested:
// - A folder being moved (any in the selection) can't be opened, so neither it nor anything below
//   it (on this path) can be picked. The SDK checks the destination's path again and refuses a folder put inside
//   itself, so the picker is a convenience, never the guard.
// - "Move here" is off where the entry already is.
// - It lists folders only, so a complete read with none says "No folders in here"; anything less
//   is said as the listing says it.

import type { FolderRef, FolderRow, ParentRef } from '@efs/sdk/files';
import { type ListingNotice, type ListingState, listingNotice } from './folder-model.ts';

const same = (a: FolderRef, b: FolderRef) =>
  a.directory.toLowerCase() === b.directory.toLowerCase();

/** Why a folder row can't be opened in the picker, if it can't: it's one of the folders moved. */
export function cannotOpen(
  row: FolderRow,
  moving: readonly FolderRef[],
): 'files.move.moving' | undefined {
  const target = row.target;
  return target?.kind === 'folder' && moving.some((m) => same(target, m))
    ? 'files.move.moving'
    : undefined;
}

/** Why the entry can't be moved into `destination`, if it can't. An address is never a folder. */
export function cannotMoveHere(
  destination: FolderRef,
  source: ParentRef,
): 'files.move.same' | undefined {
  return source.kind === 'folder' && same(destination, source) ? 'files.move.same' : undefined;
}

export type PickerNotice =
  | Exclude<ListingNotice, { id: 'files.list.empty' } | { id: 'files.list.nothingShown' }>
  | { readonly id: 'files.move.noFolders' };

/** The picker's line about what it found, or undefined when its rows speak for themselves. */
export function pickerNotice(s: ListingState): PickerNotice | undefined {
  const n = listingNotice(s);
  if (n?.id === 'files.list.empty' || n?.id === 'files.list.nothingShown') {
    return { id: 'files.move.noFolders' };
  }
  return n;
}

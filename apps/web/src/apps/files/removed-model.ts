// The "Show removed" list as state: pages of the person's removed entries in one folder, joined,
// and what the list may honestly say about itself. Pure, so each rule is tested.
//
// - Anything but PRESENT is "unavailable": the SDK never reports an unproven empty list as PRESENT,
//   and the client never turns UNKNOWN into "nothing removed".
// - Coverage only gets weaker across pages (weakest), as in the folder listing.
// - "None" only for a COMPLETE read; an empty page with more to read says so, with Keep looking.

import type { FolderCoverage, RemovedCursor, RemovedPage, RemovedRow } from '@efs/sdk/files';
import type { MessageId } from '../../ui/i18n.ts';
import { weakest } from './folder-model.ts';

export type RemovedListState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'page';
      readonly rows: readonly RemovedRow[];
      readonly coverage: FolderCoverage;
      readonly next?: RemovedCursor;
      readonly more: 'idle' | 'loading';
    }
  | { readonly phase: 'unavailable' };

type ShownPage = Extract<RemovedListState, { phase: 'page' }>;

/** A page read from the start, or (with `before`) continued from `before.next`. */
export function fromRemovedPage(page: RemovedPage, before?: ShownPage): RemovedListState {
  if (page.status !== 'PRESENT') return { phase: 'unavailable' };
  return {
    phase: 'page',
    rows: before ? [...before.rows, ...page.rows] : page.rows,
    coverage: before ? weakest(before.coverage, page.coverage) : page.coverage,
    ...(page.next ? { next: page.next } : {}),
    more: 'idle',
  };
}

/** The line shown with the list, if any. */
export function removedNotice(s: ShownPage): MessageId | undefined {
  const { coverage, rows } = s;
  if (rows.length === 0) {
    if (coverage.state === 'COMPLETE') return 'files.removed.none';
    return s.next ? 'files.removed.noneYet' : 'files.removed.noneFound';
  }
  if (coverage.state === 'UNKNOWN') return 'files.removed.unconfirmed';
  if (coverage.state === 'PARTIAL' && coverage.why === 'INDEX_PARTIAL') {
    return 'files.list.indexPartial';
  }
  return undefined;
}

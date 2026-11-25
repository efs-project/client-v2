// A folder's listing, page by page, as plain states. Pure apart from the injected SDK reads, so
// every rule below is unit-tested on the SDK's own result shapes.
//
// The rules (docs/design/file-operations.md, "A listing never reads as empty when it isn't known"):
// - "This folder is empty" only for a COMPLETE scan with no rows. A fresh scan that found nothing it
//   can vouch for is UNKNOWN from the SDK, never PRESENT and empty.
// - PARTIAL is never "that's all": INDEX_PARTIAL says the index hasn't caught up; a page with a
//   `next` offers "Keep looking"; an empty PARTIAL page with a `next` says how far it looked.
// - ABSENT_PROVEN is "this folder isn't there", never "empty".
// - A cursor gone stale (UNKNOWN, retry after-replan) lists again from the start, replacing the rows
//   so two bases are never mixed; any other failure while continuing keeps the rows shown.

import type { Efs, Lens, Reason } from '@efs/sdk';
import type {
  EntryKind,
  FolderCoverage,
  FolderCursor,
  FolderPage,
  FolderRef,
  FolderRow,
} from '@efs/sdk/files';

/** The realm's shared root folder, from the pinned deployment: the stand-in start. */
export function rootFolder(efs: Efs): FolderRef {
  const root = efs.deployment.root;
  return { kind: 'folder', directory: root.directoryRecordId, owner: root.principalId };
}

/**
 * The Lens a folder is listed through: the SDK's place Lens (the connected account, then the
 * folder's owner, then the default). The client never splices principals itself.
 */
export function placeLens(efs: Efs, folder: FolderRef, reader: string | undefined): Lens {
  return efs.lens.place({
    ...(reader ? { reader: reader as never } : {}),
    ...(folder.owner ? { owner: folder.owner } : {}),
    base: efs.lens.default,
  });
}

/** The SDK read the listing needs, injected so tests can replay recorded results. */
export interface FolderReads {
  listFolder(
    efs: Efs,
    folder: FolderRef,
    o?: {
      lens?: Lens;
      kinds?: readonly EntryKind[];
      cursor?: FolderCursor;
      withSize?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<FolderPage>;
}

export interface ListingOptions {
  readonly lens?: Lens;
  readonly kinds?: readonly EntryKind[];
}

export type ListingState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'page';
      /** The listed folder, with its subject and owner as the SDK read them. */
      readonly folder: FolderRef;
      readonly rows: readonly FolderRow[];
      /** Totals over every page read so far. */
      readonly hidden: number;
      readonly filtered: number;
      readonly coverage: FolderCoverage;
      readonly next?: FolderCursor;
      /** The state of "Keep looking": a failed continuation keeps the rows and says why. */
      readonly more:
        | { readonly status: 'idle' }
        | { readonly status: 'loading' }
        | { readonly status: 'failed'; readonly reason: Reason };
    }
  | { readonly phase: 'absent'; readonly reason: Reason }
  | { readonly phase: 'unknown'; readonly reason: Reason }
  | { readonly phase: 'invalid'; readonly reason: Reason };

type Page = Extract<ListingState, { phase: 'page' }>;

/** How little a coverage vouches for: an unvouched or index-partial page taints the whole listing. */
const weakness = (c: FolderCoverage): number =>
  c.state === 'UNKNOWN' ? 3 : c.state === 'PARTIAL' ? (c.why === 'INDEX_PARTIAL' ? 2 : 1) : 0;

/** The listing's coverage after another page: never stronger than any page read so far. */
export function weakest(before: FolderCoverage, page: FolderCoverage): FolderCoverage {
  return weakness(before) > weakness(page) ? before : page;
}

function fromPage(page: FolderPage, before?: Page): ListingState {
  if (page.status !== 'PRESENT') {
    const phase =
      page.status === 'ABSENT_PROVEN'
        ? 'absent'
        : page.status === 'INVALID'
          ? 'invalid'
          : 'unknown';
    return { phase, reason: page.reason };
  }
  // The listing reads folders only (an address isn't listed here yet): a page for anything else
  // is a client error, never shown as a folder.
  if (page.folder.kind !== 'folder') {
    return { phase: 'invalid', reason: { code: 'CLIENT_ERROR', retry: 'never' } as Reason };
  }
  return {
    phase: 'page',
    folder: page.folder,
    rows: before ? [...before.rows, ...page.rows] : page.rows,
    hidden: (before?.hidden ?? 0) + page.skipped.hidden,
    filtered: (before?.filtered ?? 0) + page.skipped.filtered,
    coverage: before ? weakest(before.coverage, page.coverage) : page.coverage,
    ...(page.next ? { next: page.next } : {}),
    more: { status: 'idle' },
  };
}

const opts = (o: ListingOptions, signal: AbortSignal, cursor?: FolderCursor) => ({
  ...(o.lens ? { lens: o.lens } : {}),
  ...(o.kinds ? { kinds: o.kinds } : {}),
  ...(cursor ? { cursor } : {}),
  withSize: true,
  signal,
});

/** The first page of `folder`. Resolves undefined when `signal` aborted (nothing to show). */
export async function startListing(
  reads: FolderReads,
  efs: Efs,
  folder: FolderRef,
  o: ListingOptions,
  signal: AbortSignal,
): Promise<ListingState | undefined> {
  const page = await reads.listFolder(efs, folder, opts(o, signal));
  return signal.aborted ? undefined : fromPage(page);
}

/**
 * "Keep looking": the next page appended to `state`. A stale cursor lists again from the start
 * (rows replaced, never mixed across bases); another failure keeps the rows and reports it.
 */
export async function continueListing(
  reads: FolderReads,
  efs: Efs,
  state: Page,
  o: ListingOptions,
  signal: AbortSignal,
): Promise<ListingState | undefined> {
  if (!state.next) return state;
  const page = await reads.listFolder(efs, state.folder, opts(o, signal, state.next));
  if (signal.aborted) return undefined;
  if (page.status === 'PRESENT') return fromPage(page, state);
  if (page.status === 'UNKNOWN' && page.reason.retry === 'after-replan') {
    return startListing(reads, efs, state.folder, o, signal);
  }
  return { ...state, more: { status: 'failed', reason: page.reason } };
}

/**
 * The line a listing shows about what it knows, or undefined when the rows speak for themselves.
 * The ids are en.json messages; `count` is the number of rows read so far.
 */
export type ListingNotice =
  | { readonly id: 'files.list.empty' }
  | { readonly id: 'files.list.nothingShown' }
  | { readonly id: 'files.list.noneFound' }
  | { readonly id: 'files.list.partialEmpty'; readonly count: number }
  | { readonly id: 'files.list.indexPartial' }
  | { readonly id: 'files.list.coverageUnknown' };

export function listingNotice(state: ListingState): ListingNotice | undefined {
  if (state.phase !== 'page') return undefined;
  const { coverage, rows } = state;
  if (coverage.state === 'UNKNOWN') return { id: 'files.list.coverageUnknown' };
  if (coverage.state === 'PARTIAL' && coverage.why === 'INDEX_PARTIAL') {
    return { id: 'files.list.indexPartial' };
  }
  if (rows.length > 0) return undefined;
  if (coverage.state === 'COMPLETE') {
    // Empty only when nothing was left out: a filter or a block hid what's there.
    return state.filtered + state.hidden === 0
      ? { id: 'files.list.empty' }
      : { id: 'files.list.nothingShown' };
  }
  // PARTIAL with no rows: more to read, or a resumed listing that ended without proving the whole.
  return state.next
    ? { id: 'files.list.partialEmpty', count: rows.length + state.hidden + state.filtered }
    : { id: 'files.list.noneFound' };
}

// "Versions" in the Preview: everyone's versions of a file (the SDK's fileVersions, from the
// contracts' head-authors list), as the Lens the file was opened under decides them.
//
// - `decision` is what the file shows in that Lens, from the same walk openFile uses; the view
//   leads with it. A hidden file names who hid it; an unknown decision is never "nobody".
// - Three tiers: the Lens authors' versions in Lens order; the creator's when the creator isn't in
//   the Lens; then everyone else, labelled public, newest author first by their FIRST version
//   (never their latest edit: the list can't say that).
// - A public page can come back empty while `next` is set (lone noes and removed versions are
//   dropped after the read), so each click reads up to VERSIONS_CALLS_PER_CLICK pages in a row,
//   stopping once rows arrive or `next` is gone; only a missing `next` ends the list.
// - "Versions · N" is `public.live` from the first page. `count` (and anything derived from it)
//   is never shown, and neither is `total`.

import type { Efs, Lens, Reason } from '@efs/sdk';
import type {
  FileVersion,
  FileVersionsCursor,
  FileVersionsOpts,
  FileVersionsResult,
  LensVersion,
  VersionsDecision,
} from '@efs/sdk/files';
import type { MessageId } from '../../ui/i18n.ts';

/** The most fileVersions calls one click (opening the section, or Load more) makes. */
export const VERSIONS_CALLS_PER_CLICK = 3;

/** How a click reads: the opened Lens, its abort signal, and (tests only) the entries per call. */
export interface ReadOpts {
  readonly lens?: Lens;
  readonly signal?: AbortSignal;
  /** fileVersions `limit` (1 to MAX_VERSIONS_PAGE; the SDK's most when absent): see pageLimit. */
  readonly limit?: number;
}

/**
 * The `limit` a click passes: a test chain's devVersionsPage when it is within the SDK's own most
 * (`max`, MAX_VERSIONS_PAGE, read where the SDK is loaded); else none, the SDK's default. Never a
 * limit the SDK would refuse as MISUSE, whatever bound the SDK takes up later.
 */
export function pageLimit(configured: number | undefined, max: number): number | undefined {
  return configured !== undefined &&
    Number.isInteger(configured) &&
    configured >= 1 &&
    configured <= max
    ? configured
    : undefined;
}

/** fileVersions, injected so tests can answer it. */
export type ReadVersions = (
  efs: Efs,
  target: { readonly kind: 'file'; readonly subject: string },
  o: FileVersionsOpts,
) => Promise<FileVersionsResult>;

export type PublicTier =
  /** The index doesn't vouch for the list: no rows and no count, never "no other versions". */
  | { readonly status: 'unknown'; readonly reason?: Reason }
  | {
      readonly status: 'present';
      readonly rows: readonly FileVersion[];
      /** Everyone's standing versions, from the first page: the "N" in "Versions · N". */
      readonly live: number;
      /** The list moved since the first page: offer a refresh. */
      readonly changed: boolean;
      /** Where the next page starts; absent only at the list's start (the end of the list). */
      readonly next?: FileVersionsCursor;
      /** The last click read pages but found no rows, and more of the list remains. */
      readonly unchecked: boolean;
      /** A Load more that failed (the rows so far stay; Try again reads from `next`). */
      readonly more: 'idle' | 'failed';
    };

export type VersionsState =
  /** Not opened yet: nothing read. */
  | { readonly phase: 'closed' }
  | { readonly phase: 'loading' }
  /** The subject was never created. */
  | { readonly phase: 'absent' }
  /** The read itself failed: not verified, BEHIND, or the reads failed. */
  | { readonly phase: 'unknown'; readonly reason?: Reason }
  | {
      readonly phase: 'read';
      readonly decision: VersionsDecision;
      readonly lens: readonly LensVersion[];
      readonly creator?: FileVersion;
      readonly public: PublicTier;
    };

export type ReadState = Extract<VersionsState, { phase: 'read' }>;

type Present = Extract<FileVersionsResult, { status: 'PRESENT' }>;
type PresentPublic = Extract<Present['public'], { status: 'PRESENT' }>;
type Paged = Present & { readonly public: PresentPublic };

interface Scan {
  /** The click's first page that read (its tiers, and `live`), if any did. */
  readonly first?: Paged;
  /** The click's last page that read. */
  readonly last?: Paged;
  readonly rows: readonly FileVersion[];
  /** Any page of the click said the list moved since the first page. */
  readonly changed: boolean;
  /** The answer that stopped the click early: the read failed, or the list stopped vouching. */
  readonly failed?: FileVersionsResult;
}

const paged = (r: FileVersionsResult): r is Paged =>
  r.status === 'PRESENT' && r.public.status === 'PRESENT';

/** Reads public pages from `cursor` until a page has rows, `next` is gone, or the budget is spent. */
async function scan(
  read: ReadVersions,
  efs: Efs,
  subject: string,
  o: ReadOpts,
  cursor: FileVersionsCursor | undefined,
): Promise<Scan> {
  const rows: FileVersion[] = [];
  let first: Paged | undefined;
  let last: Paged | undefined;
  let next = cursor;
  let changed = false;
  for (let i = 0; i < VERSIONS_CALLS_PER_CLICK; i++) {
    const r = await read(
      efs,
      { kind: 'file', subject },
      {
        ...(o.lens ? { lens: o.lens } : {}),
        ...(o.limit ? { limit: o.limit } : {}),
        ...(next ? { cursor: next } : {}),
        ...(o.signal ? { signal: o.signal } : {}),
      },
    );
    if (!paged(r)) {
      return { ...(first ? { first } : {}), ...(last ? { last } : {}), rows, changed, failed: r };
    }
    first ??= r;
    last = r;
    changed ||= r.public.changed;
    rows.push(...r.public.rows);
    next = r.public.next;
    if (r.public.rows.length > 0 || !next) break;
  }
  return { ...(first ? { first } : {}), ...(last ? { last } : {}), rows, changed };
}

/** The public tier after a click: rows so far, and where to carry on (`from` if nothing read). */
function tierAfter(
  rows: readonly FileVersion[],
  live: number,
  changed: boolean,
  click: Scan,
  from: FileVersionsCursor | undefined,
): PublicTier {
  const next = click.last ? click.last.public.next : from;
  return {
    status: 'present',
    rows,
    live,
    changed: changed || click.changed,
    ...(next ? { next } : {}),
    unchecked: !click.failed && click.rows.length === 0 && next !== undefined,
    more: click.failed ? 'failed' : 'idle',
  };
}

/** Opening the section (or Refresh, or Try again): the first page, then on up to the budget. */
export async function readVersions(
  read: ReadVersions,
  efs: Efs,
  subject: string,
  o: ReadOpts = {},
): Promise<VersionsState> {
  const click = await scan(read, efs, subject, o, undefined);
  const { first, failed } = click;
  if (!first) {
    if (!failed || failed.status === 'UNKNOWN') {
      return {
        phase: 'unknown',
        ...(failed?.status === 'UNKNOWN' ? { reason: failed.reason } : {}),
      };
    }
    if (failed.status === 'ABSENT_PROVEN') return { phase: 'absent' };
    // The read answered, but the index doesn't vouch for the list: the decision and the Lens
    // tiers are exact whatever the list's coverage, so they stay.
    return {
      phase: 'read',
      decision: failed.decision,
      lens: failed.lens,
      ...(failed.creator ? { creator: failed.creator } : {}),
      public: {
        status: 'unknown',
        ...(failed.public.status === 'UNKNOWN' ? { reason: failed.public.reason } : {}),
      },
    };
  }
  return {
    phase: 'read',
    decision: first.decision,
    lens: first.lens,
    ...(first.creator ? { creator: first.creator } : {}),
    public: tierAfter(click.rows, first.public.live, false, click, undefined),
  };
}

/** Load more (or its Try again): the public tier from `next`, up to the budget; the tiers stay. */
export async function readMore(
  read: ReadVersions,
  efs: Efs,
  subject: string,
  before: ReadState,
  o: ReadOpts = {},
): Promise<ReadState> {
  const pub = before.public;
  if (pub.status !== 'present' || !pub.next) return before;
  const click = await scan(read, efs, subject, o, pub.next);
  return {
    ...before,
    public: tierAfter([...pub.rows, ...click.rows], pub.live, pub.changed, click, pub.next),
  };
}

/** The view's first line: what the file shows in its Lens. `me` is the reader's principal. */
export function decisionLine(
  decision: VersionsDecision,
  me: string | undefined,
): { readonly id: MessageId; readonly author?: string } {
  const mine = (author: string) => me !== undefined && author.toLowerCase() === me.toLowerCase();
  switch (decision.kind) {
    case 'version':
      return mine(decision.author)
        ? { id: 'files.versions.decision.yours' }
        : { id: 'files.versions.decision.version', author: decision.author };
    case 'hidden':
      return mine(decision.author)
        ? { id: 'files.versions.decision.hiddenByYou' }
        : { id: 'files.versions.decision.hidden', author: decision.author };
    case 'none':
      return { id: 'files.versions.decision.none' };
    default:
      return { id: 'files.versions.decision.unknown' };
  }
}

/**
 * Whether "Nobody else has a version of this file." is proven: the public tier is PRESENT, no rows
 * came back across every click, the list ended (no `next`), no Load more failed, and the list didn't
 * move since the first page. A moved list's newer entries were never scanned, so then only the
 * changed notice (with Refresh) is said (PM, 2026-11-26).
 */
export function nobodyElse(pub: PublicTier): boolean {
  return (
    pub.status === 'present' &&
    pub.rows.length === 0 &&
    pub.next === undefined &&
    pub.more === 'idle' &&
    !pub.changed
  );
}

/** The "N" in "Versions · N": `live`, only when the public tier is PRESENT. */
export function versionsCount(s: VersionsState): number | undefined {
  return s.phase === 'read' && s.public.status === 'present' ? s.public.live : undefined;
}

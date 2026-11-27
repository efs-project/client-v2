// The path above a folder opened by its link (a reload, a shared link), read upward one level at a
// time with the SDK's folderNames (spec §3.7: the reader's own entry, else the folder's creator's,
// else the first Lens author's; never a stranger's). A folder has no single parent, so this is one
// path, the one its chosen name sits in, never "the" path.
//
// - Each level is one folderNames read of one folder: its name, the place that name is in (the
//   next level up), and its creator. The walk stops at the realm's root, at an address (a home),
//   at a folder nobody in that order names, at a loop (placements can form one), at the cap, or
//   at a read that couldn't be made (UNKNOWN), and says which: "not known above" never stands in
//   for "couldn't read".
// - A level with no name shows its short id. A name from a read that wasn't complete (an older
//   entry beyond the SDK's scan could outrank it) is shown, but not as settled.
// - Reads run one after another (each needs the one below it), are owned by the caller's signal,
//   and are never polled.

import type { Efs, Lens, PrincipalId, Reason } from '@efs/sdk';
import type {
  EntryLookup,
  EntryRef,
  FolderNamesOpts,
  FolderNamesResult,
  FolderRef,
  ReadOpts,
} from '@efs/sdk/files';

/** How far up a walk reads: deeper than this is "not known above" (a cap, not a claim). */
export const TRAIL_WALK_MAX = 12;

/** The read the walk needs, injected so tests can give recorded answers. */
export interface TrailReads {
  folderNames(
    efs: Efs,
    folders: readonly { folder: string; reader?: PrincipalId }[],
    o: FolderNamesOpts,
  ): Promise<FolderNamesResult>;
}

/** A folder's name as read for the trail. */
export interface TrailName {
  readonly text: string;
  /** Whose entry it is, when it isn't the connected reader's own ("named by …"). */
  readonly by: PrincipalId | undefined;
  /** False when an older entry the read didn't reach could outrank it: shown, not as final. */
  readonly settled: boolean;
}

/** One folder on the walked path. */
export interface TrailFolder {
  readonly folder: FolderRef;
  /** Undefined: nobody in the rule's order names it in what was read (shown by its short id). */
  readonly name: TrailName | undefined;
}

/** Where the walk ended, above its topmost folder. */
export type TrailTop =
  | { readonly kind: 'root' }
  | { readonly kind: 'home'; readonly address: string }
  /** Nobody names the topmost folder, or the cap was reached: the folders above aren't known. */
  | { readonly kind: 'unknown' }
  /** The topmost folder's name sits in a folder already on the path: placements loop. */
  | { readonly kind: 'loop' }
  /**
   * The walk reached the root, but following the names back down in this view's Lens leads to
   * another folder (or nowhere): the path isn't shown as one from the root.
   */
  | { readonly kind: 'elsewhere' }
  /** A read couldn't be made: the folders above couldn't be read right now (Try again). */
  | { readonly kind: 'failed'; readonly reason: Reason };

export interface TrailWalk {
  /** The walked folders, topmost first, ending with the folder the walk started at. */
  readonly folders: readonly TrailFolder[];
  /** Undefined while the walk is still reading. */
  readonly top: TrailTop | undefined;
}

export interface WalkOpts {
  /** The realm's root folder id: a name in it ends the walk. */
  readonly root: string;
  /** The connected reader's principal (rule 1, and whose names need no "named by"). */
  readonly reader: PrincipalId | undefined;
  /** The Lens for a folder's read (rule 3): the place Lens of what's known of it. */
  readonly lensFor: (folder: FolderRef) => Lens;
  readonly signal: AbortSignal;
  /** Each level as it's read, so the breadcrumb can show the path as it grows. */
  readonly onLevel?: (walk: TrailWalk) => void;
  /** Levels read at most (default TRAIL_WALK_MAX). */
  readonly max?: number;
}

const lower = (s: string): string => s.toLowerCase();

const failed = (code: string): Reason =>
  ({ code: 'CLIENT_ERROR', retry: 'transient', detail: code }) as unknown as Reason;

/**
 * Walks up from `start` (a folder opened by its link). Resolves with where it ended, or undefined
 * when `o.signal` aborted first.
 */
export async function walkTrail(
  reads: TrailReads,
  efs: Efs,
  start: FolderRef,
  o: WalkOpts,
): Promise<TrailWalk | undefined> {
  const max = o.max ?? TRAIL_WALK_MAX;
  const root = lower(o.root);
  const me = o.reader ? lower(o.reader) : undefined;
  const seen = new Set<string>([lower(start.directory)]);
  // Built nearest first, shown topmost first.
  const below: TrailFolder[] = [];
  const shown = (top: TrailTop | undefined): TrailWalk => ({
    folders: [...below].reverse(),
    top,
  });
  let current: FolderRef = start;
  for (let level = 0; level < max; level++) {
    let answer: FolderNamesResult;
    try {
      answer = await reads.folderNames(
        efs,
        [{ folder: current.directory, ...(o.reader ? { reader: o.reader } : {}) }],
        { lens: o.lensFor(current), signal: o.signal },
      );
    } catch (error) {
      if (o.signal.aborted) return undefined;
      console.error(error);
      below.push({ folder: current, name: undefined });
      return shown({ kind: 'failed', reason: failed('THROWN') });
    }
    if (o.signal.aborted) return undefined;
    const row = answer.status === 'PRESENT' ? answer.rows[0] : undefined;
    if (answer.status !== 'PRESENT' || !row || lower(row.folder) !== lower(current.directory)) {
      below.push({ folder: current, name: undefined });
      return shown({
        kind: 'failed',
        reason: answer.status === 'UNKNOWN' ? answer.reason : failed('NO_ROW'),
      });
    }
    const folder: FolderRef = row.creator
      ? { kind: 'folder', directory: current.directory, owner: row.creator }
      : current;
    if (!row.name) {
      below.push({ folder, name: undefined });
      return shown({ kind: 'unknown' });
    }
    const mine = me !== undefined && lower(row.name.author) === me;
    below.push({
      folder,
      name: {
        text: row.name.text,
        by: mine ? undefined : row.name.author,
        settled: row.complete,
      },
    });
    const parent = row.name.parent;
    if (parent.kind === 'home') return shown({ kind: 'home', address: lower(parent.address) });
    const up = lower(parent.directory);
    if (up === root) return shown({ kind: 'root' });
    if (seen.has(up)) return shown({ kind: 'loop' });
    seen.add(up);
    o.onLevel?.(shown(undefined));
    current = { kind: 'folder', directory: parent.directory };
  }
  // The cap: the folders above aren't known (not read), never "there are none".
  return shown({ kind: 'unknown' });
}

/** One folder of a root trail: its name on the way down, and how the walk up named it. */
export interface RootStep {
  readonly folder: FolderRef;
  readonly name: string;
  readonly named: TrailName;
}

/** The walked path as steps from the realm's root, when the walk reached it with a name at each level. */
export function rootSteps(walk: TrailWalk): readonly RootStep[] | undefined {
  if (walk.top?.kind !== 'root') return undefined;
  const steps: RootStep[] = [];
  for (const f of walk.folders) {
    if (!f.name) return undefined;
    steps.push({ folder: f.folder, name: f.name.text, named: f.name });
  }
  return steps;
}

/** The read the downward check needs, injected so tests can give recorded answers. */
export interface DownReads {
  lookupEntry(efs: Efs, entry: EntryRef, o: ReadOpts): Promise<EntryLookup>;
}

/**
 * Whether following `steps`' names down from the realm's root, each in its folder's place Lens (as
 * the tree lists it), lands on each step's folder in turn (PM, 2026-11-27). The walk up chose each
 * name by the name rule, but another author's entry at that name can win the Lens's choice on the
 * way down: then "Root > A > B" would claim a path the tree won't follow. `elsewhere`: some name
 * leads somewhere else, or nowhere; `failed`: a lookup couldn't be made.
 */
export async function followsDown(
  reads: DownReads,
  efs: Efs,
  root: FolderRef,
  steps: readonly RootStep[],
  lensFor: (folder: FolderRef) => Lens,
  signal: AbortSignal,
): Promise<'follows' | 'elsewhere' | { readonly failed: Reason } | undefined> {
  let parent = root;
  for (const step of steps) {
    let answer: EntryLookup;
    try {
      answer = await reads.lookupEntry(
        efs,
        { folder: parent, name: step.name },
        { lens: lensFor(parent), signal },
      );
    } catch (error) {
      if (signal.aborted) return undefined;
      console.error(error);
      return { failed: failed('THROWN') };
    }
    if (signal.aborted) return undefined;
    if (answer.status === 'UNKNOWN') return { failed: answer.reason };
    if (answer.status !== 'PRESENT') return 'elsewhere';
    const target = answer.selected.target;
    if (target?.kind !== 'folder' || lower(target.directory) !== lower(step.folder.directory))
      return 'elsewhere';
    parent = step.folder;
  }
  return 'follows';
}

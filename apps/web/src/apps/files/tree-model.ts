// The navigation tree's nodes as plain data: which folders a listed node shows, and what it can
// honestly say about the rest. Pure, so each rule is tested; the reads are folder-model.ts's.
//
// - Folders only: a node's children are the folder rows of its listing (in the place Lens).
// - A node is a leaf (no expander) only when it was read completely and has no folders.
// - Anything less is said in the node itself: more to read ("More folders…"), a read the network
//   can't vouch for ("There may be more"), or a node that couldn't be listed (Try again).
// - Nodes are keyed by the names from the realm's root, as the trail is (navigation.ts).

import type { FolderRef } from '@efs/sdk/files';
import type { ListingState } from './folder-model.ts';
import type { NavStep } from './navigation.ts';

export interface TreeFolder {
  readonly name: string;
  readonly folder: FolderRef;
}

export type TreeTail =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  /** A next page: "More folders…" (loading while it reads). */
  | { readonly kind: 'more'; readonly loading: boolean }
  /** Reading the next page failed: offered again. */
  | { readonly kind: 'more-failed' }
  /** The read ended, but the network couldn't vouch it saw every folder. */
  | { readonly kind: 'partial' }
  /** The node couldn't be listed: UNKNOWN offers Try again; the others say why. */
  | { readonly kind: 'failed'; readonly code: 'UNKNOWN' | 'ABSENT_PROVEN' | 'INVALID' };

export interface TreeNodeView {
  readonly folders: readonly TreeFolder[];
  readonly tail: TreeTail;
  /** Not read yet: it reads when opened. */
  readonly lazy: boolean;
  /** Read completely, with no folders. */
  readonly leaf?: true;
}

export function treeView(s: ListingState | undefined): TreeNodeView {
  if (!s) return { folders: [], tail: { kind: 'none' }, lazy: true };
  switch (s.phase) {
    case 'loading':
      return { folders: [], tail: { kind: 'loading' }, lazy: false };
    case 'absent':
      return { folders: [], tail: { kind: 'failed', code: 'ABSENT_PROVEN' }, lazy: false };
    case 'invalid':
      return { folders: [], tail: { kind: 'failed', code: 'INVALID' }, lazy: false };
    case 'unknown':
      return { folders: [], tail: { kind: 'failed', code: 'UNKNOWN' }, lazy: false };
    case 'page': {
      const folders: TreeFolder[] = [];
      for (const row of s.rows) {
        if (row.kind === 'folder' && row.target?.kind === 'folder') {
          folders.push({ name: row.name, folder: row.target });
        }
      }
      const tail: TreeTail =
        s.more.status === 'failed'
          ? { kind: 'more-failed' }
          : s.next
            ? { kind: 'more', loading: s.more.status === 'loading' }
            : s.coverage.state === 'UNKNOWN' ||
                (s.coverage.state === 'PARTIAL' && s.coverage.why === 'INDEX_PARTIAL')
              ? { kind: 'partial' }
              : { kind: 'none' };
      const leaf = folders.length === 0 && tail.kind === 'none' && s.coverage.state === 'COMPLETE';
      return { folders, tail, lazy: false, ...(leaf ? { leaf: true as const } : {}) };
    }
  }
}

/** A node's key: the names from the realm's root ("" is the root). */
export function treeKey(names: readonly string[]): string {
  return names.map((n) => `/${encodeURIComponent(n)}`).join('');
}

/**
 * The node of a folder opened by its link (a trail with no names above it), under the tree's
 * "above" node: keyed by its id, so its folders never share a key with the root's.
 */
export function linkedKey(directory: string): string {
  return `~${directory.toLowerCase()}`;
}

/**
 * The keys to open along the trail (the root, each folder on it, the folder on screen). A trail
 * that starts at a folder opened by its link starts at that folder's own node (linkedKey), since
 * its place under the root isn't known. Undefined for a name missing in the middle.
 */
export function trailKeys(path: readonly NavStep[]): readonly string[] | undefined {
  const first = path[0];
  const linked = first?.name === '';
  if (path.slice(linked ? 1 : 0).some((step) => step.name === '')) return undefined;
  const start = linked && first ? linkedKey(first.folder.directory) : treeKey([]);
  const keys = [start];
  const names = path.slice(linked ? 1 : 0).map((s) => s.name);
  for (let i = 1; i <= names.length; i++) keys.push(start + treeKey(names.slice(0, i)));
  return keys;
}

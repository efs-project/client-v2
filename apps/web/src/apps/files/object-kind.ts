// What an object link (`~efs/o/<id>`) names: a folder or a file. Since sdk-v2 c8ed37a an id's kind
// is fixed by the id (a folder is a record only its creator can publish; a file is a subject).
//
// The read order keeps a file link exactly as cheap as before: openFile first. PRESENT proves a
// file (a folder has no HEAD), and the Preview reuses that result instead of opening again. Only
// when it isn't PRESENT does openObject say what the id is: a folder, a file with no HEAD under
// this Lens, or nothing at all. Until then nothing reads the id as a missing file, so a folder's
// link never shows "Confirmed not present".

import type { Efs, Lens, Reason } from '@efs/sdk';
import type { FolderRef, OpenResult } from '@efs/sdk/files';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import type { FolderNav } from './navigation.ts';
import type { LinkState } from './target.ts';

export type ObjectKind =
  /** Not an object link (a revision link, the realm root, an app route): nothing to resolve. */
  | { readonly status: 'none' }
  | { readonly status: 'pending' }
  | { readonly status: 'folder'; readonly folder: FolderRef }
  /** A file, opened under `lens` (its HEAD may still be absent under it). */
  | { readonly status: 'file'; readonly open: OpenResult; readonly lens: Lens | undefined }
  /** Nothing has this id (no folder record, no created subject), as of the read. */
  | { readonly status: 'absent' }
  | { readonly status: 'invalid'; readonly reason: Reason }
  | { readonly status: 'unknown'; readonly reason: Reason };

const loadReads = async () => {
  const { openFile, openObject } = await import('@efs/sdk/files');
  return { openFile, openObject };
};

export interface ObjectKindState {
  readonly kind: ReadonlySignal<ObjectKind>;
  /** Reads the id again (after UNKNOWN). */
  retry(): void;
}

/** The Lens an object link is read in: the link's, else the one it was listed in, in this tab. */
export function readLens(l: LinkState, nav: FolderNav | undefined): Lens | undefined {
  if (l.status !== 'target') return undefined;
  if (l.lens) return l.lens;
  return l.target.kind === 'file' ? nav?.lensFor(l.target.subject) : undefined;
}

/**
 * Follows the route's link and resolves its kind. A folder answer is kept for the tab (it can't
 * change); a file is opened again each time (its HEAD can move); absent and unknown are read again.
 */
export function objectKindState(
  host: AppHost,
  link: ReadonlySignal<LinkState>,
  nav: FolderNav,
  scope: OwnerScope,
): ObjectKindState {
  const kind = state<ObjectKind>({ status: 'none' });
  const folders = new Map<string, FolderRef>();
  let resolved: string | undefined;
  let resolvedEfs: Efs | undefined;
  let run: OwnerScope | undefined;
  let attempt = 0;
  const resolve = (efs: Efs | undefined, l: LinkState) => {
    run?.dispose();
    run = undefined;
    if (!efs || l.status !== 'target' || l.target.kind !== 'file') {
      kind.set({ status: 'none' });
      return;
    }
    const subject = l.target.subject;
    const id = subject.toLowerCase();
    const folder = folders.get(id);
    if (folder) {
      kind.set({ status: 'folder', folder });
      return;
    }
    const mine = scope.child();
    run = mine;
    const lens = readLens(l, nav);
    const o = { signal: mine.signal, ...(lens ? { lens } : {}) };
    kind.set({ status: 'pending' });
    void (async () => {
      try {
        const reads = await loadReads();
        const opened = await reads.openFile(efs, { kind: 'file', subject }, o);
        if (mine.signal.aborted) return;
        if (opened.status === 'PRESENT') {
          kind.set({ status: 'file', open: opened, lens });
          return;
        }
        const object = await reads.openObject(efs, subject, o);
        if (mine.signal.aborted) return;
        if (object.status === 'FOLDER') folders.set(id, object.folder);
        kind.set(
          object.status === 'FOLDER'
            ? { status: 'folder', folder: object.folder }
            : object.status === 'FILE'
              ? { status: 'file', open: object.open, lens }
              : object.status === 'ABSENT_PROVEN'
                ? { status: 'absent' }
                : object.status === 'INVALID'
                  ? { status: 'invalid', reason: object.reason }
                  : { status: 'unknown', reason: object.reason },
        );
      } catch (error) {
        if (mine.signal.aborted) return;
        console.error(error);
        kind.set({
          status: 'unknown',
          reason: { code: 'CLIENT_ERROR', retry: 'transient' } as Reason,
        });
      }
    })();
  };
  effect(scope, () => {
    const efs = verifiedEfs(host.reader.get());
    const l = link.get();
    const key = `${l.status === 'target' ? l.canonical : l.status}|${attempt}`;
    if (key === resolved && efs === resolvedEfs) return;
    resolved = key;
    resolvedEfs = efs;
    queueMicrotask(() => resolve(efs, l));
  });
  return {
    kind,
    retry() {
      attempt++;
      resolve(verifiedEfs(host.reader.get()), link.get());
    },
  };
}

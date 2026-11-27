// The path above a folder opened by its link, for the breadcrumb and the tree (folder-trail.ts
// reads it). Created in the Files app's composition step and owned by its scope: one walk at a
// time, for the folder the trail starts at, only when that folder came in by its link (a trail the
// person clicked through is never rewritten).
//
// - The walk shows as it grows. When it reaches the realm's root and the names lead back down to
//   the folder in this view's Lens, the trail becomes the trail from the root (the tree opens along
//   it, as for one clicked through); otherwise it stays this walk, shown with what's above it.
// - Levels already read are kept for the tab, per reader, so walking from a folder on the path is
//   instant; a save that lands forgets them (a rename or a move may have changed them).
// - Reads nothing it doesn't need: no walk for a trail that has names, and no polling.

import type { PrincipalId } from '@efs/sdk';
import type { FolderNameRow, FolderNamesResult, FolderRef } from '@efs/sdk/files';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { CatchUpRetry } from '../../shell/catch-up.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { placeLens, rootFolder } from './folder-model.ts';
import {
  type DownReads,
  followsDown,
  rootSteps,
  type TrailReads,
  type TrailWalk,
  walkTrail,
} from './folder-trail.ts';
import type { FolderNav } from './navigation.ts';
import { readerOf } from './object-kind.ts';

/** The walk shown for the folder the trail starts at (its directory id, lowercase). */
export interface ShownTrail {
  readonly start: string;
  readonly walk: TrailWalk;
}

export interface TrailState {
  /** Undefined when the trail doesn't start at a folder opened by its link. */
  readonly shown: ReadonlySignal<ShownTrail | undefined>;
  /** Walks again after a read that couldn't be made ("Try again"). */
  retry(): void;
}

const loadFiles = async () => import('@efs/sdk/files');

/**
 * The walk shown for the trail's first folder, when that folder came in by its link (no name of
 * its own on the trail) and the walk is for it: the location bar, the tree and the Overview read it.
 */
export function walkFor(nav: FolderNav, trail: TrailState | undefined): TrailWalk | undefined {
  const first = nav.path.get()[0];
  const shown = trail?.shown.get();
  if (first?.name !== '' || !shown) return undefined;
  return shown.start === first.folder.directory.toLowerCase() ? shown.walk : undefined;
}

/** folderNames with the levels already read kept (per reader), so a walk from an ancestor is instant. */
function keptReads(
  read: TrailReads['folderNames'],
  kept: Map<string, FolderNameRow>,
): TrailReads['folderNames'] {
  return async (efs, folders, o) => {
    const one = folders[0];
    const key = one ? `${one.reader ?? ''}|${one.folder.toLowerCase()}` : '';
    const have = folders.length === 1 ? kept.get(key) : undefined;
    if (have) {
      return {
        kind: 'efs.folderNames',
        status: 'PRESENT',
        rows: [have],
        evidence: { attempts: [], requests: 0 },
      } as unknown as FolderNamesResult;
    }
    const answer = await read(efs, folders, o);
    const row = answer.status === 'PRESENT' ? answer.rows[0] : undefined;
    if (row && folders.length === 1) kept.set(key, row);
    return answer;
  };
}

export function trailState(host: AppHost, nav: FolderNav, scope: OwnerScope): TrailState {
  const shown = state<ShownTrail | undefined>(undefined);
  const again = state(0);
  const kept = new Map<string, FolderNameRow>();
  let key: string | undefined;
  let run: AbortController | undefined;
  let landed = 0;
  // A walk that stopped BEHIND walks again once, quietly, when a read in this client catches up
  // with the floor (as the Preview, Versions and Tags do); Try again stays the way out otherwise.
  const catchUp = new CatchUpRetry();

  // A save that lands may have renamed or moved a folder on a walked path.
  effect(scope, () => {
    const done = host.saving.saves.get().filter((p) => p.state === 'COMPLETE').length;
    if (done > landed) {
      landed = done;
      kept.clear();
    }
  });

  effect(scope, () => {
    const efs = verifiedEfs(host.reader.get());
    const account = readerOf(host);
    const path = nav.path.get();
    const tries = again.get();
    const first = path[0];
    const start = first && first.name === '' ? first.folder : undefined;
    if (!efs || !start) {
      if (key !== undefined) {
        key = undefined;
        run?.abort();
        catchUp.reset();
        queueMicrotask(() => shown.set(undefined));
      }
      return;
    }
    const next = `${efs.deployment.root.directoryRecordId}|${account ?? ''}|${start.directory.toLowerCase()}|${tries}`;
    if (next === key) return;
    key = next;
    run?.abort();
    catchUp.reading();
    const mine = new AbortController();
    run = mine;
    const id = start.directory.toLowerCase();
    /** Shows where the walk ended; one that stopped BEHIND waits for the catch-up. */
    const finish = (walk: TrailWalk) => {
      shown.set({ start: id, walk });
      if (walk.top?.kind === 'failed' && walk.top.reason.code === 'BEHIND') {
        catchUp.behind(efs, () => again.set(again.get() + 1));
      }
    };
    const reader = account ? (efs.lens.principalOf(account as never) as PrincipalId) : undefined;
    const lensFor = (folder: FolderRef) => placeLens(efs, folder, account);
    const root = rootFolder(efs);
    queueMicrotask(() => {
      if (!mine.signal.aborted) shown.set({ start: id, walk: { folders: [], top: undefined } });
    });
    void (async () => {
      const { folderNames, lookupEntry } = await loadFiles();
      if (mine.signal.aborted) return;
      const reads: TrailReads = { folderNames: keptReads(folderNames as never, kept) };
      const walk = await walkTrail(reads, efs, start, {
        root: root.directory,
        reader,
        lensFor,
        signal: mine.signal,
        onLevel: (w) => {
          if (!mine.signal.aborted) shown.set({ start: id, walk: w });
        },
      });
      if (!walk || mine.signal.aborted) return;
      const steps = rootSteps(walk);
      if (!steps) {
        finish(walk);
        return;
      }
      // Reached the root: only a path the names follow back down is shown as one from the root.
      const down: DownReads = { lookupEntry: lookupEntry as never };
      const follows = await followsDown(down, efs, root, steps, lensFor, mine.signal);
      if (follows === undefined || mine.signal.aborted) return;
      if (follows === 'follows') {
        const now = nav.path.get();
        // Only while the trail is still just this folder, opened by its link.
        if (
          now.length === 1 &&
          now[0]?.name === '' &&
          now[0].folder.directory.toLowerCase() === id
        ) {
          nav.goTo(steps.map((s) => ({ folder: s.folder, name: s.name, named: s.named })));
        }
        shown.set({ start: id, walk });
        return;
      }
      finish({
        folders: walk.folders,
        top:
          follows === 'elsewhere'
            ? { kind: 'elsewhere' }
            : { kind: 'failed', reason: follows.failed },
      });
    })().catch((error: unknown) => {
      if (mine.signal.aborted) return;
      console.error(error);
      shown.set({
        start: id,
        walk: {
          folders: [{ folder: start, name: undefined }],
          top: { kind: 'failed', reason: { code: 'CLIENT_ERROR', retry: 'transient' } as never },
        },
      });
    });
  });

  scope.signal.addEventListener(
    'abort',
    () => {
      run?.abort();
      catchUp.reset();
    },
    { once: true },
  );

  return {
    shown,
    retry() {
      again.set(again.get() + 1);
    },
  };
}

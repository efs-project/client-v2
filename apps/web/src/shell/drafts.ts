// Unsaved edits, kept in this tab's memory while the person moves around the app: open another
// file, another app or Settings, come back, and the edit is where they left it. Never stored: a
// reload or closing the tab loses them, so the shell asks first while any exist (shell.ts).
//
// One draft per file, keyed by the file's canonical route (`#/r/<realm>/<link>`): the same key
// the banner's "Review changes" navigates to, so both talk about the same file. A new file not yet
// saved has no route: it is kept under its folder and name (the Files app's newFileKey) until it
// is saved.

import type { ParentRef, RevisionRef } from '@efs/sdk/files';
import { formatRealmRoute, type RealmRef } from '../boot/route.ts';
import { type ReadonlySignal, state } from '../state/signals.ts';

export type KeptDraft = EditDraft | NewFileDraft;

/** An unsaved edit of an existing file. */
export interface EditDraft {
  readonly text: string;
  /**
   * The revision the edit is based on: the one on screen when the person pressed Edit (or the
   * newer one they chose to save over). Kept with the text, so coming back after the file
   * changed still says so at Review, instead of saving over the new version unasked.
   */
  readonly base: RevisionRef;
  /**
   * How many admissions the ledger had when the file was opened for this edit: a later HEAD that
   * is the person's own and no newer than this was already there (a reorder, "you first"), not
   * a change. Kept with the base, so coming back later still tells the two apart.
   */
  readonly since?: bigint;
}

/** An unsaved new file: its text, and where it is to be created. */
export interface NewFileDraft {
  readonly text: string;
  readonly create: {
    readonly folder: ParentRef;
    /** The place's chain key, lowercase, as save holds name it (a folder's record, an address's word). */
    readonly key: string;
    readonly folderName: string;
    readonly name: string;
  };
}

export interface DraftStore {
  get(key: string): KeptDraft | undefined;
  keep(key: string, draft: KeptDraft): void;
  drop(key: string): void;
  /** Every unsaved new file, with its key (read `count` to follow additions and removals). */
  newFiles(): readonly (readonly [string, NewFileDraft])[];
  /** How many files have an unsaved edit. */
  readonly count: ReadonlySignal<number>;
}

/** The key of a file's draft: its canonical route. */
export const draftKey = (realm: RealmRef, link: string): string => formatRealmRoute(realm, link);

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, KeptDraft>();
  const count = state(0);
  return {
    get: (key) => drafts.get(key),
    keep(key, draft) {
      drafts.set(key, draft);
      count.set(drafts.size);
    },
    drop(key) {
      if (drafts.delete(key)) count.set(drafts.size);
    },
    newFiles: () => [...drafts].filter((e): e is [string, NewFileDraft] => 'create' in e[1]),
    count,
  };
}

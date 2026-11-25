// "New text file": the file being written before it exists. It has no link yet, so the Preview
// shows the editor for it while the composer holds it, at the place it was started (the route);
// leaving that place ends the composer, and the text stays kept as an unsaved edit under the new
// file's folder and name (newFileKey), which the folder's listing offers back. Once Saved, the
// new file opens by its own link.

import type { FolderRef } from '@efs/sdk/files';
import { formatRealmRoute, type RealmRef } from '../../boot/route.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';

export interface NewFile {
  readonly folder: FolderRef;
  /** The folder's name as shown (its row's name, or the root's), for the review. */
  readonly folderName: string;
  readonly name: string;
  /** The route's link where it was started: the composer shows only there. */
  readonly route: string;
}

export interface Composer {
  readonly current: ReadonlySignal<NewFile | undefined>;
  start(file: NewFile): void;
  end(): void;
}

export function createComposer(): Composer {
  const current = state<NewFile | undefined>(undefined);
  return {
    current,
    start: (file) => current.set(file),
    end: () => {
      if (current.get() !== undefined) current.set(undefined);
    },
  };
}

/**
 * An unsaved new file's key among unsaved edits: its realm, folder and exact name. Routes start
 * with "#/", so it never collides with a file's key (shell/drafts.ts).
 */
export function newFileKey(realm: RealmRef, folder: FolderRef, name: string): string {
  return `new:${formatRealmRoute(realm)}\u0000${folder.directory.toLowerCase()}\u0000${name}`;
}

// Where the person is in the folder tree, in this tab's memory only.
//
// Folder navigation stays out of the URL until the SDK can tell a folder from a file by its link
// alone (openObject, after the contracts fix a subject's kind at birth). A folder's object link
// opened fresh would otherwise be read as a file and show "Confirmed not present". So the URL stays
// at the realm root while the person browses; files still open by their permanent link.

import type { Lens } from '@efs/sdk';
import type { FolderRef } from '@efs/sdk/files';
import { type ReadonlySignal, state } from '../../state/signals.ts';

/** One folder opened from a row: the FolderRef the row pointed at, and the name it was shown as. */
export interface NavStep {
  readonly folder: FolderRef;
  readonly name: string;
}

export interface FolderNav {
  /** The folders opened below the realm's root, in order. Empty: at the root. */
  readonly path: ReadonlySignal<readonly NavStep[]>;
  /**
   * Whether the person has been browsing folders in this tab (they opened the realm's root). Until
   * then a file link opened fresh lists nothing: no reads it doesn't need.
   */
  readonly browsing: ReadonlySignal<boolean>;
  /** Marks the tab as browsing (the realm's root is on screen). */
  startBrowsing(): void;
  /** Opens a folder from a row of the folder now shown. */
  open(step: NavStep): void;
  /** Back to the root (0), or to the folder at `depth` (1 is the first opened). */
  back(depth: number): void;
  /**
   * Remembers the Lens a file row was shown in, before the file opens. The Preview reads that
   * file in it, so a file listed as "yours" isn't "not present" there. Tab memory only: links
   * stay clean object links, and a copied link never carries the person's trust list.
   */
  rememberLens(subject: string, lens: Lens): void;
  /** The Lens `subject` was last listed in, in this tab. */
  lensFor(subject: string): Lens | undefined;
}

export function createFolderNav(): FolderNav {
  const path = state<readonly NavStep[]>([]);
  const browsing = state(false);
  const lenses = new Map<string, Lens>();
  return {
    rememberLens(subject, lens) {
      lenses.set(subject.toLowerCase(), lens);
    },
    lensFor(subject) {
      return lenses.get(subject.toLowerCase());
    },
    path,
    browsing,
    startBrowsing() {
      if (!browsing.get()) browsing.set(true);
    },
    open(step) {
      browsing.set(true);
      path.set([...path.get(), step]);
    },
    back(depth) {
      const now = path.get();
      if (depth < now.length) path.set(now.slice(0, Math.max(0, depth)));
    },
  };
}

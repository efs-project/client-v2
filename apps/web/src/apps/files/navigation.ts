// Where the person is in the folder tree, in this tab's memory only.
//
// The URL says which folder is shown (its object link, routed through openObject); this keeps the
// trail of folders the person came through, for the breadcrumb. A folder opened by its link with
// no trail (a reload, a shared link) starts a new trail with just itself.

import type { Lens } from '@efs/sdk';
import type { FolderRef } from '@efs/sdk/files';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import type { ViewPath } from './folder-requests.ts';

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
  /** A folder opened by its link (a reload, a shared link): it becomes the only folder opened. */
  resetTo(step: NavStep): void;
  /** A folder chosen in the tree: the trail becomes the names from the root to it. */
  goTo(steps: readonly NavStep[]): void;
  /**
   * The URL arrived at `folder` (undefined: the realm's root): back along the trail to it when it's
   * there (Back, the breadcrumb), else a trail of its own (resetTo). Nothing when it's the last.
   */
  arrive(folder: FolderRef | undefined): void;
  /**
   * Remembers the Lens a file row was shown in, before the file opens. The Preview reads that
   * file in it, so a file listed as "yours" isn't "not present" there. Tab memory only: links
   * stay clean object links, and a copied link never carries the person's trust list.
   */
  rememberLens(subject: string, lens: Lens): void;
  /** The Lens `subject` was last listed in, in this tab. */
  lensFor(subject: string): Lens | undefined;
  /**
   * The media gate: `subject` was opened from a tag's public tier (nobody the person trusts
   * vouched for it), so the Preview shows its Type, size and author before any content.
   */
  gate(subject: string): void;
  /** "Show preview": the person lifted the gate for `subject` (this tab). */
  ungate(subject: string): void;
  readonly gated: ReadonlySignal<ReadonlySet<string>>;
}

/**
 * The path from the realm's root to the folder now shown, by the names on the trail: what a folder
 * restore (or move) gives the SDK so it can check the folder never lands inside itself. Unknown
 * once the trail starts at a folder opened by its link (its name, and its parents, aren't known
 * here). The SDK checks the path against the chain, so a stale trail is refused, not trusted.
 */
export function viewPath(path: readonly NavStep[], root: FolderRef): ViewPath | undefined {
  if (path.some((step) => step.name === '')) return undefined;
  return { from: root, segments: path.map((step) => step.name) };
}

export function createFolderNav(): FolderNav {
  const path = state<readonly NavStep[]>([]);
  const browsing = state(false);
  const lenses = new Map<string, Lens>();
  const gated = state<ReadonlySet<string>>(new Set());
  return {
    gated,
    gate(subject) {
      const id = subject.toLowerCase();
      if (gated.get().has(id)) return;
      gated.set(new Set([...gated.get(), id]));
    },
    ungate(subject) {
      const id = subject.toLowerCase();
      if (!gated.get().has(id)) return;
      const next = new Set(gated.get());
      next.delete(id);
      gated.set(next);
    },
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
    resetTo(step) {
      browsing.set(true);
      path.set([step]);
    },
    goTo(steps) {
      browsing.set(true);
      path.set([...steps]);
    },
    back(depth) {
      const now = path.get();
      if (depth < now.length) path.set(now.slice(0, Math.max(0, depth)));
    },
    arrive(folder) {
      if (!folder) {
        this.back(0);
        return;
      }
      const now = path.get();
      const id = folder.directory.toLowerCase();
      const at = now.findIndex((step) => step.folder.directory.toLowerCase() === id);
      if (at >= 0 && at === now.length - 1) return;
      if (at >= 0) this.back(at + 1);
      else this.resetTo({ folder, name: '' });
    },
  };
}

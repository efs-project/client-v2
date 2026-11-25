// The navigation pane: the folders below the realm's root as a tree (wa-tree: keyboard and
// screen-reader behaviour are Web Awesome's), read as the person opens them.
//
// - Each folder is listed when first opened, folders only, through its place Lens (the listing's
//   reads, folder-model.ts); what a node can honestly say is tree-model.ts's.
// - An unread node holds one "Reading…" item, so it can be opened; reading replaces it with its
//   folders, or with nothing for a folder read completely without any (then a leaf). Web
//   Awesome's own lazy mode isn't used: a lazy item that loads no children never stops loading.
// - It follows the trail: the folders on it open, and the folder on screen is selected. Choosing a
//   folder sets the trail to the names from the root and opens the folder's link.
// - A save touching a listed folder lists it again, once it lands; another account or session
//   starts the tree again (the Lens changed).
// - Like the listing, it reads nothing until the person browses (a file link opened fresh costs
//   only the file's reads): the root opens then, or when the person opens it themselves.

import type { Efs } from '@efs/sdk';
import type { FolderRef } from '@efs/sdk/files';
import { link } from '@efs/sdk/links';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import { appIcon } from '../../ui/icons.ts';
import {
  continueListing,
  type FolderReads,
  type ListingState,
  placeLens,
  rootFolder,
  startListing,
} from './folder-model.ts';
import { touchesFolder } from './listing-sync.ts';
import type { FolderNav, NavStep } from './navigation.ts';
import { readerOf } from './object-kind.ts';
import { trailKeys, treeKey, treeView } from './tree-model.ts';

const loadReads = async (): Promise<FolderReads> => {
  const { listFolder } = await import('@efs/sdk/files');
  return { listFolder };
};

const ROOT = treeKey([]);

interface Placed {
  readonly folder: FolderRef;
  /** The trail to it from the root (empty for the root). */
  readonly path: readonly NavStep[];
}

export class EfsFilesTree extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;

  #nodes = state<ReadonlyMap<string, ListingState>>(new Map());
  #expanded = state<ReadonlySet<string>>(new Set());
  /** Where each listed node is (its folder and trail), learned as the tree renders. */
  #placed = new Map<string, Placed>();
  #runs = new Map<string, AbortController>();
  #session: string | undefined;
  /** Saves already listed again for (once each). */
  #synced = new Set<string>();

  protected override createRenderRoot() {
    return this;
  }

  start(scope: OwnerScope): void {
    // Another session or account (the Lens changed): the tree starts again from the root.
    effect(scope, () => {
      const efs = verifiedEfs(this.host.reader.get());
      const session = efs
        ? `${efs.deployment.root.directoryRecordId}|${readerOf(this.host) ?? ''}`
        : undefined;
      if (session === this.#session) return;
      this.#session = session;
      queueMicrotask(() => this.#restart(efs));
    });
    // The trail: every folder on it opens (and is read), so the folder on screen shows selected.
    // Only once the person browses: until then the tree reads nothing.
    effect(scope, () => {
      const keys = trailKeys(this.nav.path.get());
      if (!keys || !this.nav.browsing.get()) return;
      queueMicrotask(() => {
        const open = new Set(this.#expanded.get());
        let changed = false;
        for (const key of keys) {
          if (!open.has(key)) {
            open.add(key);
            changed = true;
          }
        }
        if (changed) this.#expanded.set(open);
        for (const key of keys) this.#read(key);
      });
    });
    // A save touching a listed folder: list it again once it lands.
    effect(scope, () => {
      for (const p of this.host.saving.saves.get()) {
        if (p.state !== 'COMPLETE' || this.#synced.has(p.sequenceId)) continue;
        this.#synced.add(p.sequenceId);
        const touched = [...this.#placed].filter(
          ([key, at]) => this.#nodes.get().has(key) && touchesFolder(p.effect, at.folder.directory),
        );
        if (touched.length > 0)
          queueMicrotask(() => {
            for (const [key] of touched) this.#read(key, true);
          });
      }
    });
    scope.signal.addEventListener('abort', () => {
      for (const run of this.#runs.values()) run.abort();
    });
  }

  // An open node the tree has just placed (its parent was read) is read now. Deferred: no signal
  // writes inside Lit's update (docs/design/shell.md).
  override updated(): void {
    const nodes = this.#nodes.get();
    const due = [...this.#expanded.get()].filter((k) => this.#placed.has(k) && !nodes.has(k));
    if (due.length > 0)
      queueMicrotask(() => {
        for (const key of due) this.#read(key);
      });
  }

  #restart(efs: Efs | undefined): void {
    for (const run of this.#runs.values()) run.abort();
    this.#runs.clear();
    this.#placed.clear();
    this.#nodes.set(new Map());
    if (!efs) return;
    this.#placed.set(ROOT, { folder: rootFolder(efs), path: [] });
    if (this.#expanded.get().has(ROOT)) this.#read(ROOT);
  }

  /** Reads a node (once; again with `force`). Unplaced nodes wait until the tree renders them. */
  #read(key: string, force = false): void {
    const efs = verifiedEfs(this.host.reader.get());
    const at = this.#placed.get(key);
    if (!efs || !at) return;
    const now = this.#nodes.get().get(key);
    if (!force && now !== undefined && now.phase !== 'unknown') return;
    this.#runs.get(key)?.abort();
    const run = new AbortController();
    this.#runs.set(key, run);
    this.#setNode(key, { phase: 'loading' });
    const o = { lens: placeLens(efs, at.folder, readerOf(this.host)), kinds: ['folder'] as const };
    loadReads()
      .then((reads) => startListing(reads, efs, at.folder, o, run.signal))
      .then((s) => {
        if (s && !run.signal.aborted) this.#setNode(key, s);
      })
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#setNode(key, {
          phase: 'unknown',
          reason: { code: 'CLIENT_ERROR', retry: 'transient' } as never,
        });
      });
  }

  /** "More folders…": the node's next page. */
  #more(key: string): void {
    const efs = verifiedEfs(this.host.reader.get());
    const s = this.#nodes.get().get(key);
    const at = this.#placed.get(key);
    const run = this.#runs.get(key);
    if (!efs || !at || !run || s?.phase !== 'page' || !s.next) return;
    this.#setNode(key, { ...s, more: { status: 'loading' } });
    const o = { lens: placeLens(efs, at.folder, readerOf(this.host)), kinds: ['folder'] as const };
    loadReads()
      .then((reads) => continueListing(reads, efs, s, o, run.signal))
      .then((next) => {
        if (next && !run.signal.aborted) this.#setNode(key, next);
      })
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#setNode(key, {
          ...s,
          more: { status: 'failed', reason: { code: 'CLIENT_ERROR', retry: 'transient' } as never },
        });
      });
  }

  #setNode(key: string, s: ListingState): void {
    const next = new Map(this.#nodes.get());
    next.set(key, s);
    this.#nodes.set(next);
  }

  #setExpanded(key: string, open: boolean): void {
    const now = this.#expanded.get();
    if (now.has(key) === open) return;
    const next = new Set(now);
    if (open) next.add(key);
    else next.delete(key);
    this.#expanded.set(next);
  }

  /** The node of the folder on screen, if it sits in the tree (not one opened by its link). */
  #currentKey(): string | undefined {
    const location = this.host.location.get();
    const keys = trailKeys(this.nav.path.get());
    if (!keys) return undefined;
    if (location.kind === 'realm' && location.link === '') return ROOT;
    return keys.at(-1);
  }

  #onSelect = (event: Event): void => {
    const item = (event as CustomEvent<{ selection: HTMLElement[] }>).detail.selection[0];
    const key = item?.dataset.key;
    if (!item || key === undefined) return;
    const action = item.dataset.action;
    if (action) {
      // An action, not a place: do it, and keep the folder on screen selected.
      (item as HTMLElement & { selected: boolean }).selected = false;
      if (action === 'more') this.#more(key);
      else if (action === 'retry') this.#read(key, true);
      return;
    }
    const at = this.#placed.get(key);
    if (!at) return;
    const last = at.path.at(-1);
    if (!last) {
      this.nav.back(0);
      this.host.openLink('');
      return;
    }
    this.nav.goTo(at.path);
    this.host.openLink(link({ kind: 'object', subject: last.folder.directory as never }));
  };

  #item(key: string, at: Placed, label: string, current: string | undefined): unknown {
    const t = this.host.translator.t.bind(this.host.translator);
    this.#placed.set(key, at);
    const view = treeView(this.#nodes.get().get(key));
    const expanded = this.#expanded.get().has(key);
    const own = (e: Event) => e.target === e.currentTarget;
    let tail: unknown = nothing;
    switch (view.tail.kind) {
      case 'loading':
        break;
      case 'more':
        tail = html`<wa-tree-item data-key=${key} data-action="more" class="efs-tree-more"
          >${view.tail.loading ? html`<wa-spinner></wa-spinner>` : nothing}
          ${t('files.tree.more')}</wa-tree-item
        >`;
        break;
      case 'more-failed':
        tail = html`<wa-tree-item data-key=${key} data-action="more" class="efs-tree-more"
          >${t('files.tree.moreFailed')}</wa-tree-item
        >`;
        break;
      case 'partial':
        tail = html`<wa-tree-item disabled class="efs-tree-note">${t('files.tree.partial')}</wa-tree-item>`;
        break;
      case 'failed':
        tail =
          view.tail.code === 'UNKNOWN'
            ? html`<wa-tree-item data-key=${key} data-action="retry" class="efs-tree-retry"
                >${t('files.tree.failed')}</wa-tree-item
              >`
            : html`<wa-tree-item disabled class="efs-tree-note"
                >${t(view.tail.code === 'ABSENT_PROVEN' ? 'files.tree.absent' : 'files.tree.invalid')}</wa-tree-item
              >`;
        break;
      case 'none':
        break;
    }
    // Unread (or reading): one item saying so keeps the node openable, and is replaced by what
    // the read finds.
    const reading =
      view.lazy || view.tail.kind === 'loading'
        ? html`<wa-tree-item disabled class="efs-tree-reading"
            ><wa-spinner></wa-spinner> ${t('files.list.loading')}</wa-tree-item
          >`
        : nothing;
    return html`<wa-tree-item
      data-key=${key}
      data-name=${label}
      class="efs-tree-folder"
      ?expanded=${expanded && !view.leaf}
      ?selected=${key === current}
      @wa-expand=${(e: Event) => {
        if (!own(e)) return;
        this.#setExpanded(key, true);
        this.#read(key);
      }}
      @wa-collapse=${(e: Event) => {
        if (own(e)) this.#setExpanded(key, false);
      }}
    >
      ${appIcon('folder')} <span class="efs-tree-label" translate="no" dir="auto">${label}</span>
      ${reading}
      ${view.folders.map((f) => {
        const path = [...at.path, { folder: f.folder, name: f.name }];
        return this.#item(
          treeKey(path.map((s) => s.name)),
          { folder: f.folder, path },
          f.name,
          current,
        );
      })}
      ${tail}
    </wa-tree-item>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const efs = verifiedEfs(this.host.reader.get());
    if (!efs) return nothing;
    return html`<wa-tree
      selection="single"
      class="efs-files-tree"
      aria-label=${t('files.navigation.label')}
      @wa-selection-change=${this.#onSelect}
    >
      ${this.#item(ROOT, { folder: rootFolder(efs), path: [] }, t('files.location.root'), this.#currentKey())}
    </wa-tree>`;
  }
}

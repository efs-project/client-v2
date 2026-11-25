// The Entries pane: the folder the person is in, listed through the SDK (folder-model.ts).
//
// - The realm's shared root is the starting folder: a stand-in parent until folders live under
//   an address. Folders opened from rows stay in this tab's memory (navigation.ts); files open by
//   their permanent link, in the Preview.
// - The Lens is the SDK's place Lens: the connected account, then the folder's owner, then the
//   default. The client never splices principals itself.
// - Every row that isn't the folder owner's says whose it is, the person's own included.
// - Nothing reads as empty unless the SDK proved it (COMPLETE); see listingNotice.
// - "Show removed" (a connected account only) lists the person's own removed entries here, each
//   with Restore (removed-list.ts). A folder is restored only with the path to it (viewPath).

import type { Efs, Lens } from '@efs/sdk';
import type { SequenceProgress } from '@efs/sdk/actions';
import type { EntryKind, EntryRef, FolderRef, FolderRow, RemovedRow } from '@efs/sdk/files';
import { link } from '@efs/sdk/links';
import { formatRealmRoute } from '../../boot/route.ts';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { placeKey, touchesOf } from '../../shell/save-hold.ts';
import { saveOutcome } from '../../shell/save-outcome.ts';
import { unsettled } from '../../shell/saves-state.ts';
import { effect } from '../../state/effect.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { shortId } from './editor.ts';
import {
  continueListing,
  type FolderReads,
  type ListingState,
  listingNotice,
  startListing,
} from './folder-model.ts';
import type { EfsFolderSave, FolderAsk, FolderSavedDetail } from './folder-save.ts';
import { pendingCreates, showsEffect, touchesFolder } from './listing-sync.ts';
import { type FolderNav, viewPath } from './navigation.ts';
import { readerNotice } from './notice.ts';
import type { ObjectKindState } from './object-kind.ts';
import type { RestoreRemovedDetail } from './removed-list.ts';

const loadReads = async (): Promise<FolderReads> => {
  const { listFolder } = await import('@efs/sdk/files');
  return { listFolder };
};

export type KindFilter = 'all' | 'folder' | 'file' | 'other';
const KINDS: Readonly<Record<KindFilter, readonly EntryKind[] | undefined>> = {
  all: undefined,
  folder: ['folder'],
  file: ['file'],
  other: ['other', 'invalid'],
};
const FILTER_LABEL: Readonly<Record<KindFilter, MessageId>> = {
  all: 'files.filter.all',
  folder: 'files.filter.folders',
  file: 'files.filter.files',
  other: 'files.filter.other',
};
const KIND_LABEL: Readonly<Record<EntryKind, MessageId>> = {
  folder: 'files.kind.folder',
  file: 'files.kind.file',
  other: 'files.kind.other',
  invalid: 'files.kind.invalid',
};

type PaneState = ListingState | { readonly phase: 'load-failed' };

/** A removal saved from here: its save, the entry, and whether it was a folder (for Restore). */
interface Removal {
  readonly sequenceId: string;
  readonly entry: EntryRef;
  readonly isFolder: boolean;
}

/** The realm's shared root folder, from the pinned deployment: the stand-in start. */
export function rootFolder(efs: Efs): FolderRef {
  const root = efs.deployment.root;
  return { kind: 'folder', directory: root.directoryRecordId, owner: root.principalId };
}

export class EfsFilesListing extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
    object: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;
  /** What the route's object link names (a folder lists here). */
  declare object: ObjectKindState;

  #state = state<PaneState | undefined>(undefined);
  #kind = state<KindFilter>('all');
  #scope: OwnerScope | undefined;
  #run: OwnerScope | undefined;
  #loaded: string | undefined;
  /** The route's link the trail last followed (see nav.arrive). */
  #arrived: string | undefined;
  #efs: Efs | undefined;
  /** How far each save touching the folder on screen has been listed again for. */
  #synced = new Map<string, 'committed' | 'final'>();
  /** A removal sent from here, until its save is complete (or fails). */
  #pendingRemoval: Removal | undefined;
  /**
   * The entry the person removed here, offered back with Restore (this tab only): shown only once
   * the removal's save is complete, and cleared if it fails or the network undoes it.
   */
  #removed = state<Removal | undefined>(undefined);
  /** "Show removed": the person's own removed entries in the folder on screen. */
  #showRemoved = state(false);
  /** Bumped when a save touching the folder on screen lands, so the removed list reads again. */
  #removedGeneration = state(0);

  protected override createRenderRoot() {
    return this;
  }

  start(scope: OwnerScope): void {
    this.#scope = scope;
    effect(scope, () => {
      const efs = verifiedEfs(this.host.reader.get());
      // A different session (network, deployment): back to that realm's root.
      if (efs !== this.#efs) {
        this.#efs = efs;
        queueMicrotask(() => this.nav.back(0));
      }
      // Lists only while the person browses: at the realm's root, at a folder's link, or once they
      // have done either in this tab. A file link opened fresh reads nothing here.
      const location = this.host.location.get();
      const atRoot = location.kind === 'realm' && location.link === '';
      const named = this.object.kind.get();
      // The trail follows the URL when the URL changes (a reload, a shared link, Back, the
      // breadcrumb), once its link's kind is known: back along the trail to the folder it names,
      // a trail of its own for a folder off it, none at the root. Only then: a click changes the
      // trail and the URL one after the other, and the URL left behind is never acted on again.
      const routeLink = location.kind === 'realm' ? location.link : undefined;
      if (efs && routeLink !== this.#arrived && named.status !== 'pending') {
        this.#arrived = routeLink;
        const arrivedAt = named.status === 'folder' ? named.folder : undefined;
        if (atRoot || arrivedAt) queueMicrotask(() => this.nav.arrive(arrivedAt));
      }
      if (atRoot && !this.nav.browsing.get()) queueMicrotask(() => this.nav.startBrowsing());
      const browsing = atRoot || named.status === 'folder' || this.nav.browsing.get();
      const folder = browsing ? this.#folder(efs) : undefined;
      const kind = this.#kind.get();
      const reader = this.#reader();
      const key = efs && folder ? `${folder.directory}|${kind}|${reader ?? ''}` : undefined;
      if (key === this.#loaded) return;
      this.#loaded = key;
      queueMicrotask(() => this.#load(efs, folder, kind));
    });
    // Any save touching the folder on screen (from here, another tab, or resumed by the banner):
    // list again once every part is committed, and again once it's final.
    effect(scope, () => {
      const s = this.#state.get();
      const dir = s?.phase === 'page' ? s.folder.directory : undefined;
      for (const p of this.host.saving.saves.get()) {
        this.#watchRemoval(p);
        if (!dir || !touchesFolder(p.effect, dir)) continue;
        const stage = p.final
          ? 'final'
          : p.total > 0 && p.committed === p.total
            ? 'committed'
            : undefined;
        if (!stage || this.#synced.get(p.sequenceId) === stage) continue;
        if (this.#synced.get(p.sequenceId) === 'final') continue;
        this.#synced.set(p.sequenceId, stage);
        const { effect: saved, account } = p;
        queueMicrotask(() => {
          this.#removedGeneration.set(this.#removedGeneration.get() + 1);
          void this.#listAgainFor(saved, account);
        });
      }
    });
  }

  /**
   * Lists again after a save, and once more (up to three times) while the answer doesn't show it
   * yet: the endpoint answered from a block before the save (a lagging RPC).
   */
  async #listAgainFor(saved: SequenceProgress['effect'], account: string, attempt = 0) {
    await this.#retry();
    const s = this.#state.get();
    const efs = this.#efs;
    if (s?.phase !== 'page' || !efs || this.#kind.get() !== 'all' || attempt >= 3) return;
    const me = efs.lens.principalOf(account as never);
    if (showsEffect(saved, s.folder.directory, s.rows, me)) return;
    setTimeout(() => void this.#listAgainFor(saved, account, attempt + 1), 1500);
  }

  /** The removal notice follows its save: shown when complete, gone if it fails or is undone. */
  #watchRemoval(p: SequenceProgress): void {
    const pending = this.#pendingRemoval;
    const shown = this.#removed.get();
    const failed = (o: ReturnType<typeof saveOutcome>) =>
      o.kind === 'abandoned' ||
      o.kind === 'expired' ||
      o.kind === 'not-through' ||
      o.kind === 'undone' ||
      o.kind === 'undone-checking' ||
      o.kind === 'changed';
    if (pending?.sequenceId === p.sequenceId) {
      if (p.state === 'COMPLETE') {
        this.#pendingRemoval = undefined;
        queueMicrotask(() => this.#removed.set(pending));
      } else if (failed(saveOutcome(p))) {
        this.#pendingRemoval = undefined;
      }
    }
    if (shown?.sequenceId === p.sequenceId && (p.state !== 'COMPLETE' || failed(saveOutcome(p)))) {
      queueMicrotask(() => this.#removed.set(undefined));
    }
  }

  /** The folder dialog: New folder, Rename, Remove and Restore (from a click). */
  #ask(ask: FolderAsk): void {
    const dialog = this.querySelector<EfsFolderSave>('efs-files-folder-save');
    dialog?.open(ask);
  }

  /**
   * Restore for an entry of the folder on screen. A folder needs the path to it from the root, so
   * the SDK can check it never lands inside itself: unknown for a folder opened by its link, and
   * then there is no ask (the caller says why: files.restore.needsPath).
   */
  #restoreAsk(entry: EntryRef, isFolder: boolean): FolderAsk | undefined {
    if (!isFolder) return { kind: 'restore', entry };
    const efs = this.#efs;
    const via = efs ? viewPath(this.nav.path.get(), rootFolder(efs)) : undefined;
    return via ? { kind: 'restore', entry, via } : undefined;
  }

  /** Why a removed row can't be restored now, if it can't. */
  #unrestorable(folder: FolderRef, row: RemovedRow, pending: ReadonlySet<string>) {
    if (pending.has(placeKey(folder.directory, row.name) ?? '')) return 'files.pending' as const;
    const entry = { folder, name: row.name };
    return this.#restoreAsk(entry, row.target.kind === 'folder')
      ? undefined
      : ('files.restore.needsPath' as const);
  }

  #onRestoreRemoved = (event: Event): void => {
    event.stopPropagation();
    const { folder, row } = (event as CustomEvent<RestoreRemovedDetail>).detail;
    const ask = this.#restoreAsk({ folder, name: row.name }, row.target.kind === 'folder');
    if (ask) this.#ask(ask);
  };

  /** The name the folder now shown goes by: its row's name, or the root's. */
  #folderName(): string {
    return this.nav.path.get().at(-1)?.name ?? this.host.translator.t('files.location.root');
  }

  /** Whether `author` is the connected account. */
  #isMine(author: string): boolean {
    const reader = this.#reader();
    return (
      reader !== undefined &&
      this.#efs?.lens.principalOf(reader as never).toLowerCase() === author.toLowerCase()
    );
  }

  /** The (folder, name) places an unsettled save of this tab's journal touches. */
  #pending(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const p of this.host.saving.saves.get()) {
      if (!unsettled(p)) continue;
      const touches = touchesOf(p.effect);
      if (touches.kind === 'places') for (const key of touches.keys) keys.add(key);
    }
    return keys;
  }

  /** The folder now shown: the last one opened, else the realm's root. */
  #folder(efs: Efs | undefined): FolderRef | undefined {
    if (!efs) return undefined;
    return this.nav.path.get().at(-1)?.folder ?? rootFolder(efs);
  }

  /** The connected account, when there is one on this network. */
  #reader(): string | undefined {
    const a = this.host.saving.availability.get();
    return a.status === 'READY' ? a.account : undefined;
  }

  #lens(efs: Efs, folder: FolderRef): Lens {
    const reader = this.#reader();
    return efs.lens.place({
      ...(reader ? { reader: reader as never } : {}),
      ...(folder.owner ? { owner: folder.owner } : {}),
      base: efs.lens.default,
    });
  }

  #load(efs: Efs | undefined, folder: FolderRef | undefined, kind: KindFilter): Promise<void> {
    this.#run?.dispose();
    this.#run = undefined;
    if (!efs || !folder || !this.#scope || this.#scope.signal.aborted) {
      this.#state.set(undefined);
      return Promise.resolve();
    }
    const run = this.#scope.child();
    this.#run = run;
    // A re-read keeps the rows on screen until it answers (no flash of "Reading…").
    if (this.#state.get()?.phase !== 'page') this.#state.set({ phase: 'loading' });
    const kinds = KINDS[kind];
    return loadReads()
      .then((reads) =>
        startListing(
          reads,
          efs,
          folder,
          { lens: this.#lens(efs, folder), ...(kinds ? { kinds } : {}) },
          run.signal,
        ),
      )
      .then((s) => {
        if (s && !run.signal.aborted) this.#state.set(s);
      })
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#state.set({ phase: 'load-failed' });
      });
  }

  #more(): void {
    const s = this.#state.get();
    const efs = this.#efs;
    const run = this.#run;
    if (s?.phase !== 'page' || !efs || !run || !s.next) return;
    const kinds = KINDS[this.#kind.get()];
    this.#state.set({ ...s, more: { status: 'loading' } });
    loadReads()
      .then((reads) =>
        continueListing(
          reads,
          efs,
          s,
          { lens: this.#lens(efs, s.folder), ...(kinds ? { kinds } : {}) },
          run.signal,
        ),
      )
      .then((next) => {
        if (next && !run.signal.aborted) this.#state.set(next);
      })
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#state.set({ phase: 'load-failed' });
      });
  }

  #retry(): Promise<void> {
    const efs = this.#efs;
    const folder = this.#folder(efs);
    const kind = this.#kind.get();
    this.#loaded =
      efs && folder ? `${folder.directory}|${kind}|${this.#reader() ?? ''}` : undefined;
    return this.#load(efs, folder, kind);
  }

  /** "yours", "0x12…ab's", or nothing for the folder owner's own rows. */
  #whose(row: FolderRow, owner: string | undefined) {
    const t = this.host.translator.t.bind(this.host.translator);
    const author = row.author.toLowerCase();
    if (owner && author === owner.toLowerCase()) return nothing;
    const reader = this.#reader();
    const mine =
      reader !== undefined && this.#efs?.lens.principalOf(reader as never).toLowerCase() === author;
    return html`<span class="efs-entry-whose"
      >${
        mine ? t('files.whose.yours') : t('files.whose.author', { author: shortId(row.author) })
      }</span
    >`;
  }

  #row(row: FolderRow, folder: FolderRef, pending: ReadonlySet<string>, lens: Lens | undefined) {
    const t = this.host.translator.t.bind(this.host.translator);
    const saving = pending.has(placeKey(folder.directory, row.name) ?? '');
    const meta = html`<span class="efs-entry-meta efs-quiet">
      <span>${t(KIND_LABEL[row.kind])}</span>
      ${
        row.size !== undefined
          ? html`<span>${t('files.list.size', { size: Number(row.size) })}</span>`
          : nothing
      }
      ${this.#whose(row, folder.owner)}
      ${saving ? html`<span class="efs-entry-saving" role="status">${t('files.pending')}</span>` : nothing}
    </span>`;
    // Rename and Remove only on the person's own entries (another author's is theirs to change).
    const entry: EntryRef = { folder, name: row.name };
    const actions =
      this.#isMine(row.author) && row.kind !== 'invalid'
        ? html`<span class="efs-entry-actions">
            <wa-button
              size="s"
              appearance="plain"
              class="efs-entry-rename"
              ?disabled=${saving}
              @click=${() => this.#ask({ kind: 'rename', from: entry })}
              >${appIcon('pen-to-square', t('files.rename.button', { name: row.name }))}</wa-button
            >
            <wa-button
              size="s"
              appearance="plain"
              class="efs-entry-remove"
              ?disabled=${saving}
              @click=${() =>
                this.#ask({
                  kind: 'remove',
                  entry,
                  folderName: this.#folderName(),
                  isFolder: row.kind === 'folder',
                  hide: false,
                })}
              >${appIcon('trash', t('files.remove.button', { name: row.name }))}</wa-button
            >
          </span>`
        : nothing;
    const name = html`<span class="efs-entry-name" translate="no">${row.name}</span>`;
    const target = row.target;
    let open: unknown;
    if (row.kind === 'folder' && target?.kind === 'folder') {
      open = html`<button
        type="button"
        class="efs-entry-open"
        @click=${() => {
          // The trail first (so the breadcrumb names it), then the folder's own link in the URL.
          this.nav.open({ folder: target, name: row.name });
          this.host.openLink(link({ kind: 'object', subject: target.directory as never }));
        }}
      >
        ${appIcon('folder')} ${name}
      </button>`;
    } else if (row.kind === 'file' && target?.kind === 'file') {
      const location = this.host.location.get();
      // A clean object link: the Lens this row was shown in travels in the tab's memory, not the
      // URL, so a copied link never carries the person's trust list.
      const objectLink = link({ kind: 'object', subject: target.subject });
      const href =
        location.kind === 'realm' ? formatRealmRoute(location.realm, objectLink) : undefined;
      open = html`<a
        class="efs-entry-open"
        href=${href ?? nothing}
        @click=${(event: MouseEvent) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          if (lens) this.nav.rememberLens(target.subject, lens);
          this.host.openLink(objectLink);
        }}
        >${appIcon('file')} ${name}</a
      >`;
    } else {
      // Other and invalid rows are shown, never opened as something they aren't.
      open = html`<span class="efs-entry-open">${appIcon('circle-info')} ${name}</span>`;
    }
    return html`<li class="efs-entry" data-kind=${row.kind}>${open} ${meta} ${actions}</li>`;
  }

  #filter() {
    const t = this.host.translator.t.bind(this.host.translator);
    return html`<wa-select
      class="efs-entries-filter"
      size="s"
      label=${t('files.filter.label')}
      .value=${this.#kind.get()}
      @change=${(event: Event) => {
        const value = (event.target as HTMLSelectElement).value as KindFilter;
        if (value in KINDS) this.#kind.set(value);
      }}
    >
      ${(Object.keys(KINDS) as KindFilter[]).map(
        (k) => html`<wa-option value=${k}>${t(FILTER_LABEL[k])}</wa-option>`,
      )}
    </wa-select>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const notice = readerNotice(this, this.host, t);
    if (notice) return html`<div class="wa-stack wa-gap-m efs-files-empty">${notice}</div>`;
    const s = this.#state.get();
    const retry = () => this.#retry();
    const location = this.host.location.get();
    const browsing = this.nav.browsing.get() || (location.kind === 'realm' && location.link === '');
    if (!browsing) {
      return html`<div class="wa-stack wa-gap-s efs-listing">
        <p class="efs-quiet">${t('files.list.notBrowsing')}</p>
        <div>
          <wa-button size="s" class="efs-entries-browse" @click=${() => this.host.openLink('')}
            ><span slot="start">${appIcon('folder')}</span>${t('files.list.browse')}</wa-button
          >
        </div>
      </div>`;
    }
    let body: unknown;
    if (!s || s.phase === 'loading') {
      body = html`<p class="efs-quiet" role="status">
        <wa-spinner></wa-spinner> ${t('files.list.loading')}
      </p>`;
    } else if (s.phase === 'load-failed') {
      body = html`<wa-callout variant="danger">
        <p>${t('files.preview.failed')}</p>
      </wa-callout>`;
    } else if (s.phase !== 'page') {
      const code =
        s.phase === 'absent' ? 'ABSENT_PROVEN' : s.phase === 'invalid' ? 'INVALID' : 'UNKNOWN';
      body = html`<efs-outcome
        .kind=${'read'}
        .code=${code}
        .translator=${this.host.translator}
        retryable
        @efs-retry=${retry}
      ></efs-outcome>`;
    } else {
      const line = listingNotice(s);
      const folder = s.folder;
      const pending = this.#pending();
      const placeLens = this.#efs ? this.#lens(this.#efs, folder) : undefined;
      const removedSave = this.#removed.get();
      const removed = removedSave?.entry;
      const creating = pendingCreates(
        this.host.saving.saves.get(),
        folder.directory,
        s.rows,
        unsettled,
      );
      const restoreAsk = removedSave
        ? this.#restoreAsk(removedSave.entry, removedSave.isFolder)
        : undefined;
      body = html`${
        removed && removed.folder.directory === folder.directory
          ? html`<p class="efs-entries-removed" role="status">
              ${t('files.list.removed', { name: removed.name })}
              <wa-button
                size="s"
                class="efs-entries-restore"
                ?disabled=${!restoreAsk}
                @click=${() => restoreAsk && this.#ask(restoreAsk)}
                >${t('files.restore')}</wa-button
              >
              ${
                restoreAsk
                  ? nothing
                  : html`<span class="efs-quiet">${t('files.restore.needsPath')}</span>`
              }
            </p>`
          : nothing
      }
      ${
        line && !(line.id === 'files.list.empty' && creating.length > 0)
          ? html`<p class="efs-entries-notice" role="status">
              ${t(line.id, 'count' in line ? { count: line.count } : {})}
            </p>`
          : nothing
      }
        ${
          s.rows.length > 0 || creating.length > 0
            ? html`<ul class="efs-entries" aria-label=${t('files.entries.title')}>
              ${s.rows.map((row) => this.#row(row, folder, pending, placeLens))}
              ${creating.map(
                (c) => html`<li class="efs-entry efs-entry-creating" data-kind=${c.kind}>
                  <span class="efs-entry-open"
                    >${appIcon(c.kind)}
                    <span class="efs-entry-name" translate="no">${c.name}</span></span
                  >
                  <span class="efs-entry-meta efs-quiet">
                    <span>${t(KIND_LABEL[c.kind])}</span>
                    <span class="efs-entry-saving" role="status">${t('files.pending')}</span>
                  </span>
                </li>`,
              )}
            </ul>`
            : nothing
        }
        ${
          s.filtered > 0
            ? html`<p class="efs-quiet">${t('files.filter.hidden', { count: s.filtered })}</p>`
            : nothing
        }
        ${
          s.hidden > 0
            ? html`<p class="efs-quiet">${t('files.list.hidden', { count: s.hidden })}</p>`
            : nothing
        }
        ${
          s.more.status === 'failed'
            ? html`<efs-outcome
              compact
              .kind=${'read'}
              .code=${'UNKNOWN'}
              .translator=${this.host.translator}
              retryable
              @efs-retry=${() => this.#more()}
            ></efs-outcome>`
            : nothing
        }
        ${
          s.next && s.more.status !== 'failed'
            ? html`<div>
              <wa-button
                size="s"
                class="efs-entries-more"
                ?loading=${s.more.status === 'loading'}
                @click=${() => this.#more()}
                >${t('files.list.keepLooking')}</wa-button
              >
            </div>`
            : nothing
        }`;
    }
    const efs = this.#efs;
    const folder = s?.phase === 'page' ? s.folder : undefined;
    const ready = this.host.saving.availability.get().status !== 'SHARED_GATEWAY';
    // Whose removed entries: the connected account's, so only with one (READY).
    const reader = this.#reader();
    const author = efs && reader ? efs.lens.principalOf(reader as never) : undefined;
    const showRemoved = this.#showRemoved.get() && folder !== undefined && author !== undefined;
    const pending = this.#pending();
    const toolbar = html`<div class="wa-cluster wa-gap-s efs-listing-toolbar">
      ${this.#filter()}
      ${
        folder && ready
          ? html`<wa-button
              size="s"
              class="efs-new-folder"
              @click=${() =>
                this.#ask({ kind: 'createFolder', folder, folderName: this.#folderName() })}
              ><span slot="start">${appIcon('plus')}</span>${t('files.new.folder')}</wa-button
            >`
          : nothing
      }
      ${
        folder && author
          ? html`<wa-switch
              class="efs-show-removed"
              size="s"
              ?checked=${this.#showRemoved.get()}
              @change=${(event: Event) =>
                this.#showRemoved.set((event.target as HTMLInputElement).checked)}
              >${t('files.removed.toggle')}</wa-switch
            >`
          : nothing
      }
    </div>`;
    return html`<div
      class="wa-stack wa-gap-s efs-listing"
      @efs-folder-saved=${this.#onSaved}
      @efs-restore-removed=${this.#onRestoreRemoved}
    >
      ${toolbar} ${body}
      ${
        showRemoved
          ? html`<efs-files-removed
              .efs=${efs}
              .folder=${folder}
              .author=${author}
              .translator=${this.host.translator}
              .generation=${this.#removedGeneration.get()}
              .restorable=${(row: RemovedRow) => this.#unrestorable(folder, row, pending)}
            ></efs-files-removed>`
          : nothing
      }
      <efs-files-folder-save
        .host=${this.host}
        .efs=${efs}
        .lens=${efs && folder ? this.#lens(efs, folder) : undefined}
      ></efs-files-folder-save>
    </div>`;
  }

  /** A save the dialog handed to the banner. A removal's notice waits for its save to complete. */
  #onSaved = (event: Event) => {
    const detail = (event as CustomEvent<FolderSavedDetail>).detail;
    const ask = detail.ask;
    if (ask?.kind === 'remove') {
      this.#pendingRemoval = {
        sequenceId: detail.sequenceId,
        entry: ask.entry,
        isFolder: ask.isFolder,
      };
      this.#removed.set(undefined);
    } else if (ask?.kind === 'restore') {
      this.#removed.set(undefined);
    }
  };
}

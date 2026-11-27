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
import type {
  EntryKind,
  EntryRef,
  FolderRef,
  FolderRow,
  ParentRef,
  RemovedRow,
} from '@efs/sdk/files';
import { link } from '@efs/sdk/links';
import { formatRealmRoute } from '../../boot/route.ts';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { draftKey } from '../../shell/drafts.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { placeKey, touchesOf } from '../../shell/save-hold.ts';
import { saveOutcome } from '../../shell/save-outcome.ts';
import { unsettled } from '../../shell/saves-state.ts';
import { shortAccount } from '../../shell/wallet-state.ts';
import { effect } from '../../state/effect.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { type Composer, newFileKey } from './compose.ts';
import {
  continueListing,
  type FolderReads,
  type ListingState,
  listingNotice,
  placeLens,
  rootFolder,
  startListing,
} from './folder-model.ts';
import type {
  ComposeDetail,
  EfsFolderSave,
  FolderAsk,
  FolderSavedDetail,
  SelectedEntry,
} from './folder-save.ts';
import { pendingCreates, showsEffect, touchesFolder } from './listing-sync.ts';
import { declaredMediaType, uploadMediaType } from './upload-model.ts';
import { authorLabel } from './who.ts';

/**
 * The largest file read for an upload: past this it isn't read into memory at all (the SDK's own
 * limits, far lower today, refuse what it can't save, in the review).
 */
const UPLOAD_MAX_MB = 50;

import { markOnce } from '../../platform/marks.ts';
import { readFloorReset } from '../../shell/read-floor.ts';
import { type FolderNav, parentKey, sameParent, viewPath } from './navigation.ts';
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

/** One of the person's own rows, selected: what it is, and the folder it is when it's one. */
interface SelectedItem extends SelectedEntry {
  readonly moving?: FolderRef;
}

/** A removal saved from here: its save, and the entries (folders flagged, for Restore). */
interface Removal {
  readonly sequenceId: string;
  readonly entries: readonly SelectedEntry[];
  /** Removed and blocked (a mask): Restore also unblocks. */
  readonly blocked: boolean;
  /** Someone else's entry the place's owner blocked here (a lone block): Unblock undoes it. */
  readonly other?: boolean;
}

export class EfsFilesListing extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
    object: { attribute: false },
    composer: { attribute: false },
    shown: { attribute: false },
    suspended: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;
  /** What the route's object link names (a folder lists here). */
  declare object: ObjectKindState;
  /** "New text file": the file being written (the Preview shows its editor). */
  declare composer: Composer | undefined;
  /** Where this pane publishes what it lists (the Overview reads the folder's README from it). */
  declare shown: { set(s: ListingState | undefined): void } | undefined;
  /** True while the Entries pane shows a tag or an address instead: nothing is read here. */
  declare suspended: { get(): boolean } | undefined;

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
  /** Addresses' chain keys (padded words), by address, once read. */
  #homeKeys = state<ReadonlyMap<string, string>>(new Map());
  /**
   * The entry the person removed here, offered back with Restore (this tab only): shown only once
   * the removal's save is complete, and cleared if it fails or the network undoes it.
   */
  #removed = state<Removal | undefined>(undefined);
  /** "Show removed": the person's own removed entries in the folder on screen. */
  #showRemoved = state(false);
  /** Bumped when a save touching the folder on screen lands, so the removed list reads again. */
  #removedGeneration = state(0);
  /**
   * The person's own entries selected in the folder on screen, by name: Move and Remove act on
   * them all in one review (one plan, all or nothing). Cleared when the folder changes.
   */
  #selected = state<ReadonlyMap<string, SelectedItem>>(new Map());
  /** Why the last upload didn't start (several files, or one too large to read). */
  #uploadNote = state<'files.upload.oneAtATime' | 'files.upload.tooBig' | undefined>(undefined);

  protected override createRenderRoot() {
    return this;
  }

  start(scope: OwnerScope): void {
    this.#scope = scope;
    effect(scope, () => {
      const s = this.#state.get();
      queueMicrotask(() => this.shown?.set(s?.phase === 'load-failed' ? undefined : s));
    });
    effect(scope, () => {
      if (this.suspended?.get()) return;
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
        // An address: its entries are listed, and the trail starts there.
        if (named.status === 'home') queueMicrotask(() => this.nav.arriveHome(named.home));
        else if (atRoot || arrivedAt) queueMicrotask(() => this.nav.arrive(arrivedAt));
      }
      if (atRoot && !this.nav.browsing.get()) queueMicrotask(() => this.nav.startBrowsing());
      const browsing =
        atRoot || named.status === 'folder' || named.status === 'home' || this.nav.browsing.get();
      const folder = browsing ? this.#folder(efs) : undefined;
      const kind = this.#kind.get();
      const reader = this.#reader();
      const key =
        efs && folder
          ? `${parentKey(folder)}|${folder.owner ?? ''}|${kind}|${reader ?? ''}`
          : undefined;
      if (key === this.#loaded) return;
      this.#loaded = key;
      queueMicrotask(() => this.#load(efs, folder, kind));
    });
    // Any save touching the folder on screen (from here, another tab, or resumed by the banner):
    // list again once every part is committed, and again once it's final.
    effect(scope, () => {
      const s = this.#state.get();
      // Saves name a folder by its record, an address by its padded word (once read).
      const dir = s?.phase === 'page' ? this.#keyOf(s.folder) : undefined;
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
    const key = this.#keyOf(s.folder);
    if (!key || showsEffect(saved, key, s.rows, me)) return;
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
  #restoreAsk(entries: readonly SelectedEntry[], blocked = false): FolderAsk | undefined {
    const efs = this.#efs;
    const via = efs
      ? viewPath(this.nav.path.get(), this.nav.base.get() ?? rootFolder(efs))
      : undefined;
    if (!via && entries.some((e) => e.isFolder)) return undefined;
    return {
      kind: 'restore',
      entries: entries.map((e) => ({
        entry: e.entry,
        ...(e.isFolder && via ? { via } : {}),
        ...(blocked ? { blocked: true } : {}),
      })),
    };
  }

  /** Why a removed row's Restore (or Unblock) can't be taken now, if it can't. */
  #unrestorable(folder: ParentRef, row: RemovedRow, pending: ReadonlySet<string>) {
    const key = placeKey(this.#keyOf(folder), row.name);
    if (pending.has(key ?? '')) return 'files.pending' as const;
    if (row.last !== 'KNOWN') return undefined;
    const entry = { folder, name: row.name };
    return this.#restoreAsk([{ entry, isFolder: row.target.kind === 'folder' }])
      ? undefined
      : ('files.restore.needsPath' as const);
  }

  #onRestoreRemoved = (event: Event): void => {
    event.stopPropagation();
    const { folder, row, action } = (event as CustomEvent<RestoreRemovedDetail>).detail;
    const entry = { folder, name: row.name };
    // A lone block of someone else's entry has nothing of yours to put back: Unblock it.
    if (action === 'unhide') {
      if (row.last === 'NEVER_BOUND') this.#ask({ kind: 'unhide', entries: [entry] });
      return;
    }
    if (row.last !== 'KNOWN') return;
    const ask = this.#restoreAsk(
      [{ entry, isFolder: row.target.kind === 'folder' }],
      row.state === 'MASKED',
    );
    if (ask) this.#ask(ask);
  };

  /** The name the place now shown goes by: its row's name, the address's, or the root's. */
  #folderName(): string {
    const last = this.nav.path.get().at(-1)?.name;
    if (last !== undefined) return last;
    const base = this.nav.base.get();
    return base ? shortAccount(base.address) : this.host.translator.t('files.location.root');
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

  /** The place listed: the last folder opened, else the trail's start (an address, or the root). */
  #folder(efs: Efs | undefined): ParentRef | undefined {
    if (!efs) return undefined;
    return this.nav.path.get().at(-1)?.folder ?? this.nav.base.get() ?? rootFolder(efs);
  }

  /** The connected account, when there is one on this network. */
  #reader(): string | undefined {
    const a = this.host.saving.availability.get();
    return a.status === 'READY' ? a.account : undefined;
  }

  #lens(efs: Efs, folder: ParentRef): Lens {
    return placeLens(efs, folder, this.#reader());
  }

  /**
   * A place's chain key, as saves' effects name it: a folder's record, or an address's padded word
   * (the SDK's homeId, read once per address). Undefined until an address's is read.
   */
  #keyOf = (p: ParentRef): string | undefined =>
    p.kind === 'folder'
      ? p.directory.toLowerCase()
      : this.#homeKeys.get().get(p.address.toLowerCase());

  /** Reads an address's chain key (lazily: the SDK's id code stays out of startup). */
  #readHomeKey(address: string): void {
    const id = address.toLowerCase();
    if (this.#homeKeys.get().has(id)) return;
    void import('@efs/sdk/tags')
      .then(({ homeId }) => {
        const next = new Map(this.#homeKeys.get());
        next.set(id, homeId(id as never).toLowerCase());
        this.#homeKeys.set(next);
      })
      .catch((error: unknown) => console.error(error));
  }

  #load(efs: Efs | undefined, folder: ParentRef | undefined, kind: KindFilter): Promise<void> {
    if (folder?.kind === 'home') this.#readHomeKey(folder.address);
    // Another folder: what was selected there isn't here.
    const selected = this.#selected.get();
    const parent = selected.values().next().value?.entry.folder;
    if (parent && !sameParent(parent, folder)) this.#selected.set(new Map());
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
        if (!s || run.signal.aborted) return;
        this.#state.set(s);
        // The first rows (or an honest empty or unknown) are on screen: the budget's end point.
        markOnce('efs:listing-listed');
      })
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#state.set({ phase: 'load-failed' });
        markOnce('efs:listing-listed');
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
      efs && folder
        ? `${parentKey(folder)}|${folder.owner ?? ''}|${kind}|${this.#reader() ?? ''}`
        : undefined;
    return this.#load(efs, folder, kind);
  }

  /**
   * Whether this tab keeps an unsaved edit of the row's file: the editor's own store, under the
   * editor's own key (the file's object-link route, drafts.ts `draftKey`), never guessed from a
   * time. Reads the store's count so a keep or a discard re-renders the row.
   */
  #hasDraft(row: FolderRow): boolean {
    const location = this.host.location.get();
    if (location.kind !== 'realm' || row.target?.kind !== 'file') return false;
    this.host.saving.drafts.count.get();
    const kept = this.host.saving.drafts.get(
      draftKey(location.realm, link({ kind: 'object', subject: row.target.subject })),
    );
    return kept !== undefined && !('create' in kept);
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
        mine
          ? t('files.whose.yours')
          : t('files.whose.author', {
              author: authorLabel(this.#efs, row.author, undefined, this.host.names.get()),
            })
      }</span
    >`;
  }

  #row(row: FolderRow, folder: ParentRef, pending: ReadonlySet<string>, lens: Lens | undefined) {
    const t = this.host.translator.t.bind(this.host.translator);
    const saving = pending.has(placeKey(this.#keyOf(folder), row.name) ?? '');
    // Writes need the place's chain key: an address's is read lazily (its entries are read-only
    // here until it is).
    const writable = this.#keyOf(folder) !== undefined;
    const meta = html`<span class="efs-entry-meta efs-quiet">
      <span>${t(KIND_LABEL[row.kind])}</span>
      ${
        row.size !== undefined
          ? html`<span>${t('files.list.size', { size: Number(row.size) })}</span>`
          : nothing
      }
      ${this.#whose(row, folder.owner)}
      ${
        this.#hasDraft(row)
          ? html`<span class="efs-entry-unsaved-note efs-entry-draft">${t('files.list.unsavedEdit')}</span>`
          : nothing
      }
      ${saving ? html`<span class="efs-entry-saving" role="status">${t('files.pending')}</span>` : nothing}
    </span>`;
    // Rename and Remove only on the person's own entries (another author's is theirs to change).
    // Tag on anyone's file or folder: a tag is the tagger's own statement about it.
    const entry: EntryRef = { folder, name: row.name };
    const tagTarget =
      row.kind === 'invalid'
        ? undefined
        : row.target?.kind === 'file' || row.target?.kind === 'folder'
          ? row.target
          : undefined;
    const tag = tagTarget
      ? html`<wa-button
          size="s"
          appearance="plain"
          class="efs-entry-tag"
          ?disabled=${saving || this.host.saving.hosting.shared}
          @click=${() => this.#ask({ kind: 'tag', targets: [tagTarget], names: [row.name] })}
          >${appIcon('tag', t('files.tag.buttonFor', { name: row.name }))}</wa-button
        >`
      : nothing;
    // Block on someone else's entry, for the place's owner only: a block is the owner's own entry
    // at that name, which hides the other one for anyone whose view puts the owner first (the
    // address's or folder's owner, cleaning up what others put there). Any row, "other" and invalid
    // included: a block masks the name's place, never reading what the entry points at (the SDK
    // plans it from the Lens's heads there), and junk is what an owner most wants gone.
    const owner = folder.owner;
    const block =
      writable && owner !== undefined && this.#isMine(owner) && !this.#isMine(row.author)
        ? html`<wa-button
            size="s"
            appearance="plain"
            class="efs-entry-block"
            ?disabled=${saving}
            @click=${() =>
              this.#ask({ kind: 'hide', entries: [entry], folderName: this.#folderName() })}
            >${appIcon('ban', t('files.hide.button', { name: row.name }))}</wa-button
          >`
        : nothing;
    const actions =
      writable && this.#isMine(row.author) && row.kind !== 'invalid'
        ? html`<span class="efs-entry-actions">
            ${tag}
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
              class="efs-entry-move"
              ?disabled=${saving}
              @click=${() =>
                this.#ask({
                  kind: 'move',
                  entries: [
                    row.kind === 'folder' && row.target?.kind === 'folder'
                      ? { entry, moving: row.target }
                      : { entry },
                  ],
                  start: this.nav.path.get(),
                })}
              >${appIcon('file-export', t('files.move.button', { name: row.name }))}</wa-button
            >
            <wa-button
              size="s"
              appearance="plain"
              class="efs-entry-remove"
              ?disabled=${saving}
              @click=${() =>
                this.#ask({
                  kind: 'remove',
                  entries: [{ entry, isFolder: row.kind === 'folder' }],
                  folderName: this.#folderName(),
                  hide: false,
                })}
              >${appIcon('trash', t('files.remove.button', { name: row.name }))}</wa-button
            >
          </span>`
        : tagTarget || block !== nothing
          ? html`<span class="efs-entry-actions">${tag} ${block}</span>`
          : nothing;
    const name = html`<span class="efs-entry-name" translate="no" dir="auto">${row.name}</span>`;
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
    const select =
      writable && this.#isMine(row.author) && row.kind !== 'invalid'
        ? html`<input
            type="checkbox"
            class="efs-entry-select"
            aria-label=${t('files.select.one', { name: row.name })}
            .checked=${this.#selected.get().has(row.name)}
            ?disabled=${saving}
            @change=${(event: Event) =>
              this.#toggle(
                {
                  entry,
                  isFolder: row.kind === 'folder',
                  ...(row.kind === 'folder' && row.target?.kind === 'folder'
                    ? { moving: row.target }
                    : {}),
                },
                (event.target as HTMLInputElement).checked,
              )}
          />`
        : nothing;
    return html`<li class="efs-entry" data-kind=${row.kind}>
      ${select} ${open} ${meta} ${actions}
    </li>`;
  }

  /** Selects or unselects one of the person's own rows. */
  #toggle(item: SelectedItem, on: boolean): void {
    const next = new Map(this.#selected.get());
    if (on) next.set(item.entry.name, item);
    else next.delete(item.entry.name);
    this.#selected.set(next);
  }

  /** "N selected · Move… · Remove · Clear selection": one review for the whole selection. */
  #selectionBar() {
    const t = this.host.translator.t.bind(this.host.translator);
    const items = [...this.#selected.get().values()];
    if (items.length === 0) return nothing;
    return html`<div class="wa-cluster wa-gap-s efs-selection">
      <span role="status">${t('files.select.count', { count: items.length })}</span>
      <wa-button
        size="s"
        class="efs-selection-move"
        @click=${() =>
          this.#ask({
            kind: 'move',
            entries: items.map((x) =>
              x.moving ? { entry: x.entry, moving: x.moving } : { entry: x.entry },
            ),
            start: this.nav.path.get(),
          })}
        ><span slot="start">${appIcon('file-export')}</span>${t('files.select.move')}</wa-button
      >
      <wa-button
        size="s"
        class="efs-selection-remove"
        @click=${() =>
          this.#ask({
            kind: 'remove',
            entries: items.map((x) => ({ entry: x.entry, isFolder: x.isFolder })),
            folderName: this.#folderName(),
            hide: false,
          })}
        ><span slot="start">${appIcon('trash')}</span>${t('files.select.remove')}</wa-button
      >
      <wa-button
        size="s"
        appearance="plain"
        class="efs-selection-clear"
        @click=${() => this.#selected.set(new Map())}
        >${t('files.select.clear')}</wa-button
      >
    </div>`;
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
        .reason=${'reason' in s ? s.reason?.code : undefined}
        .reset=${readFloorReset(this.host.network.get(), this.host.reader.get())}
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
      const removed = removedSave?.entries[0]?.entry;
      const removedCount = removedSave?.entries.length ?? 0;
      const key = this.#keyOf(folder);
      const creating = key
        ? pendingCreates(this.host.saving.saves.get(), key, s.rows, unsettled)
        : [];
      const unsaved = this.#unsavedNewFiles(folder);
      const restoreAsk = removedSave
        ? removedSave.other
          ? { kind: 'unhide' as const, entries: removedSave.entries.map((e) => e.entry) }
          : this.#restoreAsk(removedSave.entries, removedSave.blocked)
        : undefined;
      body = html`${
        removed && sameParent(removed.folder, folder)
          ? html`<p class="efs-entries-removed" role="status">
              ${
                removedSave?.other
                  ? removedCount > 1
                    ? t('files.list.blockedOtherMany', { count: removedCount })
                    : t('files.list.blockedOther', { name: removed.name })
                  : removedSave?.blocked
                    ? removedCount > 1
                      ? t('files.list.blockedMany', { count: removedCount })
                      : t('files.list.blocked', { name: removed.name })
                    : removedCount > 1
                      ? t('files.list.removedMany', { count: removedCount })
                      : t('files.list.removed', { name: removed.name })
              })
              }
              <wa-button
                size="s"
                class="efs-entries-restore"
                ?disabled=${!restoreAsk}
                @click=${() => restoreAsk && this.#ask(restoreAsk)}
                >${t(removedSave?.other ? 'files.unhide.yes' : 'files.restore')}</wa-button
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
        line && !(line.id === 'files.list.empty' && creating.length + unsaved.length > 0)
          ? html`<p class="efs-entries-notice" role="status">
              ${t(line.id, 'count' in line ? { count: line.count } : {})}
            </p>`
          : nothing
      }
        ${this.#selectionBar()}
        ${
          s.rows.length > 0 || creating.length > 0 || unsaved.length > 0
            ? html`<ul class="efs-entries" aria-label=${t('files.entries.title')}>
              ${s.rows.map((row) => this.#row(row, folder, pending, placeLens))}
              ${unsaved}
              ${creating.map(
                (c) => html`<li class="efs-entry efs-entry-creating" data-kind=${c.kind}>
                  <span class="efs-entry-open"
                    >${appIcon(c.kind)}
                    <span class="efs-entry-name" translate="no" dir="auto">${c.name}</span></span
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
              .reason=${s.more.reason?.code}
              .reset=${readFloorReset(this.host.network.get(), this.host.reader.get())}
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
    const place = s?.phase === 'page' ? s.folder : undefined;
    // Writes need the place's chain key (an address's is read lazily): until then, read-only.
    const folder = place && this.#keyOf(place) !== undefined ? place : undefined;
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
            >
            <wa-button
              size="s"
              class="efs-new-file"
              @click=${() =>
                this.#ask({ kind: 'createFile', folder, folderName: this.#folderName() })}
              ><span slot="start">${appIcon('file')}</span>${t('files.new.textFile')}</wa-button
            >
            <wa-button
              size="s"
              class="efs-upload"
              @click=${() => this.querySelector<HTMLInputElement>('input.efs-upload-input')?.click()}
              ><span slot="start">${appIcon('upload')}</span>${t('files.new.upload')}</wa-button
            >
            <input
              type="file"
              class="efs-upload-input"
              hidden
              @change=${(event: Event) => {
                const input = event.target as HTMLInputElement;
                void this.#upload(input.files);
                input.value = '';
              }}
            />`
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
      ${
        this.#uploadNote.get()
          ? html`<p class="efs-upload-note" role="status">
              ${t(this.#uploadNote.get() as 'files.upload.tooBig', { limit: UPLOAD_MAX_MB })}
            </p>`
          : nothing
      }
    </div>`;
    return html`<div
      class="wa-stack wa-gap-s efs-listing"
      tabindex="-1"
      aria-label=${t('files.entries.title')}
      @efs-folder-focus-lost=${(event: Event) => {
        event.stopPropagation();
        (event.currentTarget as HTMLElement).focus();
      }}
      @efs-folder-saved=${this.#onSaved}
      @efs-restore-removed=${this.#onRestoreRemoved}
      @efs-compose=${this.#onCompose}
      @dragover=${(event: DragEvent) => {
        // A file dragged over a folder that can take writes: allow the drop.
        if (folder && ready && event.dataTransfer?.types.includes('Files')) event.preventDefault();
      }}
      @drop=${(event: DragEvent) => {
        if (!folder || !ready || !event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        void this.#upload(event.dataTransfer.files);
      }}
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
        .lens=${efs && place ? this.#lens(efs, place) : undefined}
        .keyOf=${this.#keyOf}
      ></efs-files-folder-save>
    </div>`;
  }

  /**
   * Upload, from the picker or a drop: one file, read here, its media type found from its bytes
   * (upload-model.ts), then named and reviewed in the folder dialog.
   */
  async #upload(files: FileList | null | undefined): Promise<void> {
    const list = files ? [...files] : [];
    const file = list[0];
    const s = this.#state.get();
    if (!file || s?.phase !== 'page') return;
    if (list.length > 1) {
      this.#uploadNote.set('files.upload.oneAtATime');
      return;
    }
    this.#uploadNote.set(undefined);
    if (this.#keyOf(s.folder) === undefined) return;
    const { normalizeMediaType } = await import('@efs/sdk/files');
    const base = {
      kind: 'upload',
      folder: s.folder,
      folderName: this.#folderName(),
      name: file.name,
      file,
    } as const;
    // Too large to read here (and far past what the chain stores): it can only be linked, so its
    // bytes are read once, to fingerprint, and its type is as the device reports it.
    if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
      const declared = declaredMediaType(file.type, normalizeMediaType);
      this.#ask({ ...base, mediaType: declared, typeFrom: declared ? 'browser' : 'unknown' });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = uploadMediaType(bytes, file.type, normalizeMediaType);
    this.#ask({ ...base, bytes, mediaType: type.mediaType, typeFrom: type.from });
  }

  /** "New text file", named in the dialog: the Preview's editor writes it, here. */
  #onCompose = (event: Event): void => {
    const detail = (event as CustomEvent<ComposeDetail>).detail;
    event.stopPropagation();
    this.#write(detail);
  };

  /** Writes (or keeps writing) a new file in the folder on screen. */
  #write(file: ComposeDetail): void {
    const location = this.host.location.get();
    if (location.kind !== 'realm') return;
    this.composer?.start({ ...file, route: location.link });
  }

  /** Unsaved new files in `folder` (this tab), each offered back. */
  #unsavedNewFiles(folder: ParentRef) {
    const t = this.host.translator.t.bind(this.host.translator);
    const location = this.host.location.get();
    if (location.kind !== 'realm' || !this.composer) return [];
    this.host.saving.drafts.count.get();
    const writing = this.composer.current.get();
    return this.host.saving.drafts
      .newFiles()
      .filter(([key, d]) => key === newFileKey(location.realm, folder, d.create.name))
      .filter(
        ([, d]) => !(writing && writing.name === d.create.name && writing.route === location.link),
      )
      .map(
        ([, d]) => html`<li class="efs-entry efs-entry-unsaved" data-kind="file">
          <button
            type="button"
            class="efs-entry-open"
            aria-label=${t('files.new.resume', { name: d.create.name })}
            @click=${() => this.#write({ ...d.create, folder })}
          >
            ${appIcon('file')}
            <span class="efs-entry-name" translate="no" dir="auto">${d.create.name}</span>
          </button>
          <span class="efs-entry-meta efs-quiet">
            <span>${t('files.kind.file')}</span>
            <span class="efs-entry-unsaved-note">${t('files.new.unsaved')}</span>
          </span>
        </li>`,
      );
  }

  /** A save the dialog handed to the banner. A removal's notice waits for its save to complete. */
  #onSaved = (event: Event) => {
    const detail = (event as CustomEvent<FolderSavedDetail>).detail;
    const ask = detail.ask;
    // A save from the selection: the selection is done.
    if (ask?.kind === 'remove' || ask?.kind === 'move') this.#selected.set(new Map());
    if (ask?.kind === 'remove') {
      this.#pendingRemoval = {
        sequenceId: detail.sequenceId,
        entries: ask.entries,
        blocked: ask.hide,
      };
      this.#removed.set(undefined);
    } else if (ask?.kind === 'hide') {
      this.#pendingRemoval = {
        sequenceId: detail.sequenceId,
        entries: ask.entries.map((entry) => ({ entry, isFolder: false })),
        blocked: true,
        other: true,
      };
      this.#removed.set(undefined);
    } else if (ask?.kind === 'restore' || ask?.kind === 'unhide') {
      this.#removed.set(undefined);
    }
  };
}

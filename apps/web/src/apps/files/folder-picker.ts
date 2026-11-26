// "Move to…": the folders below the realm's root, folders only, to choose where an entry goes.
//
// - It opens at the folder the person is in when its path is known (the trail's names), else at
//   the root, and walks down by names, so the path to the folder picked is always known: it
//   travels as `via`, which the SDK resolves again against the chain (a stale path is refused).
// - Each folder is listed through its place Lens, as the Entries pane lists it.
// - The rules for what can't be opened or picked are in picker-model.ts.

import type { Efs } from '@efs/sdk';
import type { FolderRef, FolderRow, ParentRef } from '@efs/sdk/files';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import {
  continueListing,
  type FolderReads,
  type ListingState,
  placeLens,
  rootFolder,
  startListing,
} from './folder-model.ts';
import type { ViewPath } from './folder-requests.ts';
import { type NavStep, viewPath } from './navigation.ts';
import { cannotMoveHere, cannotOpen, pickerNotice } from './picker-model.ts';
import { authorLabel } from './who.ts';

export const PICKER_CHANGE_EVENT = 'efs-picker-change';
/** The folder the picker is on now: where "Move here" would put the entry. */
export interface PickerSelection {
  readonly folder: FolderRef;
  /** The path to it from the realm's root, by names. */
  readonly via: ViewPath;
  /** Its name as listed (or the root's), for the review. */
  readonly label: string;
  /** Why the entry can't go here, if it can't. */
  readonly why?: MessageId;
}

const loadReads = async (): Promise<FolderReads> => {
  const { listFolder } = await import('@efs/sdk/files');
  return { listFolder };
};

export class EfsFolderPicker extends EfsElement {
  static override properties = {
    efs: { attribute: false },
    reader: { attribute: false },
    reset: { attribute: false },
    translator: { attribute: false },
    names: { attribute: false },
    start: { attribute: false },
    source: { attribute: false },
    moving: { attribute: false },
  };
  declare efs: Efs | undefined;
  /** The connected account (the place Lens puts it first). */
  declare reader: string | undefined;
  /** Forgets the read floor (a local test chain only; shell/read-floor.ts), from the dialog. */
  declare reset: (() => void) | undefined;
  declare translator: Translator;
  /** Names beside addresses (the local test chain's dev accounts). */
  declare names: ReadonlyMap<string, string> | undefined;
  /** Where to open: the trail to the folder the person is in (used only if every name is known). */
  declare start: readonly NavStep[];
  /** The folder (or address) the entry is in now. */
  declare source: ParentRef;
  /** The folders being moved (the selection's folders; none when only files move). */
  declare moving: readonly FolderRef[];

  #path = state<readonly NavStep[] | undefined>(undefined);
  #listing = state<ListingState | undefined>(undefined);
  #loaded: string | undefined;
  #announced: string | undefined;
  #controller: AbortController | undefined;

  protected override createRenderRoot() {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller?.abort();
  }

  /** The folders opened, from the root: where it started until the person moves. */
  #pathNow(): readonly NavStep[] {
    const path = this.#path.get();
    if (path) return path;
    const efs = this.efs;
    return efs && viewPath(this.start, rootFolder(efs)) ? this.start : [];
  }

  // Signal writes and the selection event wait for a microtask: a write during Lit's update
  // (SignalWatcher runs it inside a computed) would not render again.
  override updated(): void {
    const efs = this.efs;
    if (!efs) return;
    const root = rootFolder(efs);
    const path = this.#pathNow();
    const folder = path.at(-1)?.folder ?? root;
    const key = `${folder.directory.toLowerCase()}|${this.reader ?? ''}`;
    if (key !== this.#loaded) {
      this.#loaded = key;
      queueMicrotask(() => void this.#load(efs, folder));
    }
    const why = cannotMoveHere(folder, this.source);
    const announce = `${key}|${why ?? ''}`;
    if (announce === this.#announced) return;
    this.#announced = announce;
    const detail: PickerSelection = {
      folder,
      via: viewPath(path, root) ?? { from: root, segments: [] },
      label: path.at(-1)?.name ?? this.translator.t('files.location.root'),
      ...(why ? { why } : {}),
    };
    queueMicrotask(() =>
      this.dispatchEvent(
        new CustomEvent<PickerSelection>(PICKER_CHANGE_EVENT, {
          detail,
          bubbles: true,
          composed: true,
        }),
      ),
    );
  }

  async #load(efs: Efs, folder: FolderRef): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    this.#listing.set({ phase: 'loading' });
    try {
      const s = await startListing(
        await loadReads(),
        efs,
        folder,
        { lens: placeLens(efs, folder, this.reader), kinds: ['folder'] },
        controller.signal,
      );
      if (s && !controller.signal.aborted) this.#listing.set(s);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      this.#listing.set({
        phase: 'unknown',
        reason: { code: 'CLIENT_ERROR', retry: 'transient' } as never,
      });
    }
  }

  async #more(): Promise<void> {
    const s = this.#listing.get();
    const efs = this.efs;
    const controller = this.#controller;
    if (s?.phase !== 'page' || !efs || !controller || !s.next) return;
    this.#listing.set({ ...s, more: { status: 'loading' } });
    try {
      const next = await continueListing(
        await loadReads(),
        efs,
        s,
        { lens: placeLens(efs, s.folder, this.reader), kinds: ['folder'] },
        controller.signal,
      );
      if (next && !controller.signal.aborted) this.#listing.set(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      this.#listing.set({
        ...s,
        more: { status: 'failed', reason: { code: 'CLIENT_ERROR', retry: 'transient' } as never },
      });
    }
  }

  #retry(): void {
    this.#loaded = undefined;
    this.requestUpdate();
  }

  #row(row: FolderRow, owner: string | undefined) {
    const t = this.translator.t.bind(this.translator);
    const target = row.target;
    if (row.kind !== 'folder' || target?.kind !== 'folder') return nothing;
    const why = cannotOpen(row, this.moving ?? []);
    const author = row.author.toLowerCase();
    const mine =
      this.reader !== undefined &&
      this.efs?.lens.principalOf(this.reader as never).toLowerCase() === author;
    const whose =
      owner && author === owner.toLowerCase()
        ? nothing
        : html`<span class="efs-entry-whose"
            >${mine ? t('files.whose.yours') : t('files.whose.author', { author: authorLabel(this.efs, row.author, undefined, this.names) })}</span
          >`;
    return html`<li class="efs-entry" data-kind="folder">
      <button
        type="button"
        class="efs-entry-open"
        ?disabled=${why !== undefined}
        @click=${() => this.#path.set([...this.#pathNow(), { folder: target, name: row.name }])}
      >
        ${appIcon('folder')} <span class="efs-entry-name" translate="no" dir="auto">${row.name}</span>
      </button>
      <span class="efs-entry-meta efs-quiet">${whose}${why ? html`<span>${t(why)}</span>` : nothing}</span>
    </li>`;
  }

  #breadcrumb(path: readonly NavStep[]) {
    const t = this.translator.t.bind(this.translator);
    const crumbs = [
      { name: t('files.location.root'), depth: 0, data: false },
      ...path.map((step, i) => ({ name: step.name, depth: i + 1, data: true })),
    ];
    const last = crumbs.length - 1;
    return html`<wa-breadcrumb label=${t('files.move.where')} class="efs-picker-location">
      ${crumbs.map((c) =>
        c.depth === last
          ? html`<wa-breadcrumb-item aria-current="location"
              ><span translate=${c.data ? 'no' : nothing} dir=${c.data ? 'auto' : nothing}>${c.name}</span></wa-breadcrumb-item
            >`
          : html`<wa-breadcrumb-item
              @click=${() => this.#path.set(this.#pathNow().slice(0, c.depth))}
              ><span translate=${c.data ? 'no' : nothing} dir=${c.data ? 'auto' : nothing}>${c.name}</span></wa-breadcrumb-item
            >`,
      )}
    </wa-breadcrumb>`;
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const path = this.#pathNow();
    const s = this.#listing.get();
    let body: unknown;
    if (!s || s.phase === 'loading') {
      body = html`<p class="efs-quiet" role="status">
        <wa-spinner></wa-spinner> ${t('files.list.loading')}
      </p>`;
    } else if (s.phase !== 'page') {
      const code =
        s.phase === 'absent' ? 'ABSENT_PROVEN' : s.phase === 'invalid' ? 'INVALID' : 'UNKNOWN';
      body = html`<efs-outcome
        compact
        .kind=${'read'}
        .code=${code}
        .reason=${'reason' in s ? s.reason?.code : undefined}
        .reset=${this.reset}
        .translator=${this.translator}
        retryable
        @efs-retry=${() => this.#retry()}
      ></efs-outcome>`;
    } else {
      const line = pickerNotice(s);
      const rows = s.rows.filter((r) => r.kind === 'folder' && r.target?.kind === 'folder');
      body = html`${
        rows.length > 0
          ? html`<ul class="efs-entries efs-picker-folders" aria-label=${t('files.move.folders')}>
              ${rows.map((row) => this.#row(row, s.folder.owner))}
            </ul>`
          : nothing
      }
      ${
        line
          ? html`<p class="efs-quiet efs-picker-notice" role="status">
              ${t(line.id, 'count' in line ? { count: line.count } : {})}
            </p>`
          : nothing
      }
      ${
        s.more.status === 'failed'
          ? html`<efs-outcome
              compact
              .kind=${'read'}
              .code=${'UNKNOWN'}
              .reason=${s.more.reason?.code}
              .reset=${this.reset}
              .translator=${this.translator}
              retryable
              @efs-retry=${() => void this.#more()}
            ></efs-outcome>`
          : s.next
            ? html`<div>
                <wa-button
                  size="s"
                  class="efs-picker-more"
                  ?loading=${s.more.status === 'loading'}
                  @click=${() => void this.#more()}
                  >${t('files.list.keepLooking')}</wa-button
                >
              </div>`
            : nothing
      }`;
    }
    return html`<div class="wa-stack wa-gap-s efs-picker">${this.#breadcrumb(path)} ${body}</div>`;
  }
}

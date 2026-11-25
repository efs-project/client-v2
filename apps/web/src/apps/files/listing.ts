// The Entries pane: the folder the person is in, listed through the SDK (folder-model.ts).
//
// - The realm's shared root is the starting folder: a stand-in parent until folders live under
//   an address. Folders opened from rows stay in this tab's memory (navigation.ts); files open by
//   their permanent link, in the Preview.
// - The Lens is the SDK's place Lens: the connected account, then the folder's owner, then the
//   default. The client never splices principals itself.
// - Every row that isn't the folder owner's says whose it is, the person's own included.
// - Nothing reads as empty unless the SDK proved it (COMPLETE); see listingNotice.

import type { Efs, Lens } from '@efs/sdk';
import { link } from '@efs/sdk';
import type { EntryKind, FolderRef, FolderRow } from '@efs/sdk/files';
import { formatRealmRoute } from '../../boot/route.ts';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
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
import type { FolderNav } from './navigation.ts';
import { readerNotice } from './notice.ts';

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

/** The realm's shared root folder, from the pinned deployment: the stand-in start. */
export function rootFolder(efs: Efs): FolderRef {
  const root = efs.deployment.root;
  return {
    kind: 'folder',
    directory: root.directoryRecordId,
    subject: root.subjectId,
    owner: root.principalId,
  };
}

export class EfsFilesListing extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;

  #state = state<PaneState | undefined>(undefined);
  #kind = state<KindFilter>('all');
  #scope: OwnerScope | undefined;
  #run: OwnerScope | undefined;
  #loaded: string | undefined;
  #efs: Efs | undefined;

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
      // Lists only while the person browses: at the realm's root, or once they have opened it in
      // this tab. A file link opened fresh reads nothing here (its Preview is what was asked for).
      const location = this.host.location.get();
      const atRoot = location.kind === 'realm' && location.link === '';
      if (atRoot && !this.nav.browsing.get()) queueMicrotask(() => this.nav.startBrowsing());
      const browsing = atRoot || this.nav.browsing.get();
      const folder = browsing ? this.#folder(efs) : undefined;
      const kind = this.#kind.get();
      const reader = this.#reader();
      const key = efs && folder ? `${folder.directory}|${kind}|${reader ?? ''}` : undefined;
      if (key === this.#loaded) return;
      this.#loaded = key;
      queueMicrotask(() => this.#load(efs, folder, kind));
    });
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

  #load(efs: Efs | undefined, folder: FolderRef | undefined, kind: KindFilter): void {
    this.#run?.dispose();
    this.#run = undefined;
    if (!efs || !folder || !this.#scope || this.#scope.signal.aborted) {
      this.#state.set(undefined);
      return;
    }
    const run = this.#scope.child();
    this.#run = run;
    this.#state.set({ phase: 'loading' });
    const kinds = KINDS[kind];
    loadReads()
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

  #retry(): void {
    this.#loaded = undefined;
    const efs = this.#efs;
    this.#load(efs, this.#folder(efs), this.#kind.get());
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

  #row(row: FolderRow, owner: string | undefined) {
    const t = this.host.translator.t.bind(this.host.translator);
    const meta = html`<span class="efs-entry-meta efs-quiet">
      <span>${t(KIND_LABEL[row.kind])}</span>
      ${
        row.size !== undefined
          ? html`<span>${t('files.list.size', { size: Number(row.size) })}</span>`
          : nothing
      }
      ${this.#whose(row, owner)}
    </span>`;
    const name = html`<span class="efs-entry-name" translate="no">${row.name}</span>`;
    const target = row.target;
    if (row.kind === 'folder' && target?.kind === 'folder') {
      return html`<li class="efs-entry" data-kind="folder">
        <button
          type="button"
          class="efs-entry-open"
          @click=${() => this.nav.open({ folder: target, name: row.name })}
        >
          ${appIcon('folder')} ${name}
        </button>
        ${meta}
      </li>`;
    }
    if (row.kind === 'file' && target?.kind === 'file') {
      const location = this.host.location.get();
      const objectLink = link({ kind: 'object', subject: target.subject });
      const href =
        location.kind === 'realm' ? formatRealmRoute(location.realm, objectLink) : undefined;
      return html`<li class="efs-entry" data-kind="file">
        <a
          class="efs-entry-open"
          href=${href ?? nothing}
          @click=${(event: MouseEvent) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            this.host.openLink(objectLink);
          }}
          >${appIcon('file')} ${name}</a
        >
        ${meta}
      </li>`;
    }
    // Other and invalid rows are shown, never opened as something they aren't.
    return html`<li class="efs-entry" data-kind=${row.kind}>
      <span class="efs-entry-open">${appIcon('circle-info')} ${name}</span>
      ${meta}
    </li>`;
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
      const owner = s.folder.owner;
      body = html`${
        line
          ? html`<p class="efs-entries-notice" role="status">
              ${t(line.id, 'count' in line ? { count: line.count } : {})}
            </p>`
          : nothing
      }
        ${
          s.rows.length > 0
            ? html`<ul class="efs-entries" aria-label=${t('files.entries.title')}>
              ${s.rows.map((row) => this.#row(row, owner))}
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
    return html`<div class="wa-stack wa-gap-s efs-listing">${this.#filter()} ${body}</div>`;
  }
}

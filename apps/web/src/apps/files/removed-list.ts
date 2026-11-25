// "Show removed": the person's own removed entries in the folder on screen (released, or removed
// and blocked), each with Restore. One author's scope list, read through listRemoved; never the
// Lens, so it shows what *you* removed, not what anyone hid.
//
// What a row offers follows its history (`last`): KNOWN puts its last target back (Restore); a
// block with nothing of yours before it (NEVER_BOUND: someone else's entry) offers Unblock; a
// history too deep to read (UNKNOWN) offers nothing and says why, for that row only.
//
// - An empty list is said only for a COMPLETE read; anything not vouched for is UNKNOWN from the
//   SDK, shown as "can't be listed right now" with Try again, never as "nothing removed"
//   (removed-model.ts holds those rules).
// - Row labels come from a table keyed by the SDK's row state, so new states (the tag release adds
//   "you hid someone else's entry: Unhide") slot in without reshaping the row.

import type { Efs, PrincipalId } from '@efs/sdk';
import type { FolderRef, RemovedCursor, RemovedRow } from '@efs/sdk/files';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { fromRemovedPage, type RemovedListState, removedNotice } from './removed-model.ts';

export const RESTORE_REMOVED_EVENT = 'efs-restore-removed';
/** The event's detail: the removed row the person chose, what to do with it, and its folder. */
export interface RestoreRemovedDetail {
  readonly folder: FolderRef;
  readonly row: RemovedRow;
  /** Restore its last target (KNOWN rows), or unblock the name (NEVER_BOUND rows). */
  readonly action: 'restore' | 'unhide';
}

const loadListRemoved = async () => (await import('@efs/sdk/files')).listRemoved;

/** Words for each row state the SDK reports. Unknown states say so, never guessed. */
const STATE_LABEL: Readonly<Record<string, MessageId>> = {
  RELEASED: 'files.removed.released',
  MASKED: 'files.removed.masked',
};

export class EfsFilesRemoved extends EfsElement {
  static override properties = {
    efs: { attribute: false },
    folder: { attribute: false },
    author: { attribute: false },
    translator: { attribute: false },
    generation: { attribute: false },
    restorable: { attribute: false },
  };
  declare efs: Efs | undefined;
  declare folder: FolderRef | undefined;
  /** The connected account's principal: whose removed entries these are. */
  declare author: PrincipalId | undefined;
  declare translator: Translator;
  /** Bumped by the listing when a save touching this folder lands: read again. */
  declare generation: number;
  /** Whether a row's action can be taken now, and if not, why (e.g. a folder needs its path). */
  declare restorable: (row: RemovedRow) => MessageId | undefined;

  #state = state<RemovedListState>({ phase: 'loading' });
  #loaded: string | undefined;
  /** The folder and author the rows on screen are for: a re-read of the same keeps them shown. */
  #shown: string | undefined;
  #controller: AbortController | undefined;

  protected override createRenderRoot() {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller?.abort();
  }

  override updated(): void {
    const base =
      this.efs && this.folder && this.author
        ? `${this.folder.directory.toLowerCase()}|${this.author.toLowerCase()}`
        : undefined;
    const key = base ? `${base}|${this.generation}` : undefined;
    if (key === this.#loaded) return;
    this.#loaded = key;
    // After a microtask: a signal write during Lit's update (inside SignalWatcher's computed)
    // would not render again.
    const keep = base === this.#shown;
    if (base) queueMicrotask(() => void this.#load(undefined, keep));
    this.#shown = base;
  }

  /** Reads the first page (or the next, from `cursor`). `keep`: leave the rows shown meanwhile. */
  async #load(cursor?: RemovedCursor, keep = false): Promise<void> {
    const { efs, folder, author } = this;
    if (!efs || !folder || !author) return;
    if (!cursor) {
      this.#controller?.abort();
      this.#controller = new AbortController();
    }
    const signal = this.#controller?.signal;
    const before = this.#state.get();
    if (cursor && before.phase === 'page') this.#state.set({ ...before, more: 'loading' });
    else if (!(keep && before.phase === 'page')) this.#state.set({ phase: 'loading' });
    try {
      const listRemoved = await loadListRemoved();
      const page = await listRemoved(
        efs,
        { folder, author },
        { ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) },
      );
      if (signal?.aborted) return;
      this.#state.set(
        fromRemovedPage(page, cursor && before.phase === 'page' ? before : undefined),
      );
    } catch (error) {
      if (signal?.aborted) return;
      console.error(error);
      this.#state.set({ phase: 'unavailable' });
    }
  }

  #row(row: RemovedRow) {
    const t = this.translator.t.bind(this.translator);
    const label =
      row.last === 'NEVER_BOUND'
        ? 'files.removed.neverBound'
        : row.last === 'UNKNOWN'
          ? 'files.removed.historyUnknown'
          : STATE_LABEL[row.state];
    const action = row.last === 'KNOWN' ? 'restore' : row.last === 'NEVER_BOUND' ? 'unhide' : null;
    const why = action ? this.restorable?.(row) : undefined;
    const icon =
      row.last === 'KNOWN' ? (row.target.kind === 'folder' ? 'folder' : 'file') : 'circle-info';
    return html`<li class="efs-entry efs-entry-removed" data-state=${row.state} data-last=${row.last}>
      <span class="efs-entry-open">
        ${appIcon(icon)}
        <span class="efs-entry-name" translate="no" dir="auto">${row.name}</span>
      </span>
      <span class="efs-entry-meta efs-quiet">
        ${label ? t(label) : html`<code translate="no">${row.state}</code>`}
        ${why ? html`<span>${t(why)}</span>` : nothing}
      </span>
      <span class="efs-entry-actions">
        ${
          action
            ? html`<wa-button
              size="s"
              class=${action === 'restore' ? 'efs-removed-restore' : 'efs-removed-unhide'}
              ?disabled=${why !== undefined}
              @click=${() =>
                this.folder &&
                this.dispatchEvent(
                  new CustomEvent<RestoreRemovedDetail>(RESTORE_REMOVED_EVENT, {
                    detail: { folder: this.folder, row, action },
                    bubbles: true,
                    composed: true,
                  }),
                )}
              >${t(action === 'restore' ? 'files.removed.restore' : 'files.removed.unhide', {
                name: row.name,
              })}</wa-button
            >`
            : nothing
        }
      </span>
    </li>`;
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const s = this.#state.get();
    let body: unknown;
    if (s.phase === 'loading') {
      body = html`<p class="efs-quiet" role="status"><wa-spinner></wa-spinner></p>`;
    } else if (s.phase === 'unavailable') {
      body = html`<p role="status" class="efs-removed-unavailable">
        ${t('files.removed.unavailable')}
        <wa-button size="s" @click=${() => void this.#load()}>${t('outcome.retry')}</wa-button>
      </p>`;
    } else {
      const line = removedNotice(s);
      body = html`${
        s.rows.length > 0
          ? html`<ul class="efs-entries" aria-label=${t('files.removed.title')}>
              ${s.rows.map((row) => this.#row(row))}
            </ul>`
          : nothing
      }
      ${line ? html`<p class="efs-quiet efs-removed-notice" role="status">${t(line)}</p>` : nothing}
      ${
        s.next
          ? html`<div>
              <wa-button
                size="s"
                class="efs-removed-more"
                ?loading=${s.more === 'loading'}
                @click=${() => void this.#load(s.next)}
                >${t('files.list.keepLooking')}</wa-button
              >
            </div>`
          : nothing
      }`;
    }
    return html`<section class="wa-stack wa-gap-xs efs-removed" aria-label=${t('files.removed.title')}>
      <h3 class="efs-removed-title">${t('files.removed.title')}</h3>
      ${body}
    </section>`;
  }
}

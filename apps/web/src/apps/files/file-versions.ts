// "Versions" in the Preview: everyone's versions of the file shown (the SDK's fileVersions), in
// the Lens the file was opened under, read only when the person opens the section
// (versions-model.ts has the rules).
//
// - The decision line comes first: whose version this view shows, or who hid it.
// - Rows: the Lens authors' versions, then the creator's (when not in the Lens), then everyone
//   else, labelled public. Show puts that author first in the Preview, as "Show my version"
//   does; a public row's Open does the same behind the media gate (nothing is fetched until
//   "Show preview"). The creator's row skips the gate: the file view's own fallback ("you, then
//   its creator, then that Lens") opens the creator's version without it.
// - "Versions · N" is `live`; nothing is derived from the list's `count`.
// - Focus: after Load more it moves to the first new row (or stays on the button); after Refresh
//   or Try again to the first row (or the decision line). Opening the section doesn't move it.

import type { Efs, Lens } from '@efs/sdk';
import type { FileVersion } from '@efs/sdk/files';
import { versionsPageOf } from '../../platform/settings/model.ts';
import type { AppHost } from '../../shell/apps.ts';
import { CatchUpRetry } from '../../shell/catch-up.ts';
import { readFloorReset } from '../../shell/read-floor.ts';
import { state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { readerOf } from './object-kind.ts';
import {
  decisionLine,
  nobodyElse,
  pageLimit,
  type ReadOpts,
  type ReadState,
  type ReadVersions,
  readMore,
  readVersions,
  type VersionsState,
  versionsBehind,
  versionsCount,
} from './versions-model.ts';
import { authorLabel } from './who.ts';

const loadFiles = async () => import('@efs/sdk/files');

/** Show (or Open) on a row: put this author first in the Preview. */
export interface VersionShowDetail {
  readonly author: string;
  /** A public row: open it behind the media gate. */
  readonly gated: boolean;
}

export const VERSION_SHOW_EVENT = 'efs-version-show';

type Tier = 'lens' | 'creator' | 'public';
type Focus =
  | { readonly to: 'first-new'; readonly index: number }
  | { readonly to: 'first-row' }
  /** No new rows: focus stays where it is, or (if its button went away) on Load more or the heading. */
  | { readonly to: 'keep' };

export class EfsFileVersions extends EfsElement {
  static override properties = {
    host: { attribute: false },
    efs: { attribute: false },
    subject: { attribute: false },
    lens: { attribute: false },
    shown: { attribute: false },
    stamp: { attribute: false },
  };
  declare host: AppHost;
  declare efs: Efs | undefined;
  /** The file shown (its subject id). */
  declare subject: string | undefined;
  /**
   * The Lens the file was opened under, its fallback included ("you, then its creator, then that
   * Lens"): never a Show override. Only then is the decision what the file's link shows.
   */
  declare lens: Lens | undefined;
  /** The author of the version the Preview shows now (any view), to mark "Showing here". */
  declare shown: string | undefined;
  /**
   * Moves when what was read may be stale: a save on this file, another Lens, or the file's own
   * view showing something new. Open, the section reads again; closed, on its next opening.
   */
  declare stamp: string | undefined;

  #state = state<VersionsState>({ phase: 'closed' });
  /** A click's read in flight: the content stays, its button busy, so focus has somewhere to be. */
  #busy = state<'refresh' | 'more' | undefined>(undefined);
  /** The row whose Show was pressed, until the Preview's `shown` moves. */
  #requested = state<string | undefined>(undefined);
  #controller: AbortController | undefined;
  #subjectSeen: string | undefined;
  #stampSeen: string | undefined;
  #shownSeen: string | undefined;
  #focus: Focus | undefined;
  /** A BEHIND read re-reads itself once, on the SDK's catch-up signal (shell/catch-up.ts). */
  #catchUp = new CatchUpRetry();

  protected override createRenderRoot() {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#controller?.abort();
    this.#catchUp.reset();
  }

  override updated(): void {
    const shown = this.shown?.toLowerCase();
    if (shown !== this.#shownSeen) {
      this.#shownSeen = shown;
      if (this.#requested.get() !== undefined) queueMicrotask(() => this.#requested.set(undefined));
    }
    // Another file: what was read is someone else's; the section closes again.
    const key = this.subject?.toLowerCase();
    if (key !== this.#subjectSeen) {
      this.#subjectSeen = key;
      this.#stampSeen = this.stamp;
      this.#controller?.abort();
      this.#catchUp.reset();
      queueMicrotask(() => {
        this.#state.set({ phase: 'closed' });
        this.#busy.set(undefined);
        this.#requested.set(undefined);
        const details = this.querySelector('details');
        if (details) details.open = false;
      });
      return;
    }
    if (this.stamp !== this.#stampSeen) {
      this.#stampSeen = this.stamp;
      this.#readAgain();
    }
    this.#placeFocus();
  }

  /** What was read may be stale: open, it reads again in place; closed, when next opened. */
  #readAgain(): void {
    if (this.#state.get().phase === 'closed') return;
    const open = this.querySelector('details')?.open === true;
    queueMicrotask(() => {
      if (open) void this.#load(this.contains(document.activeElement) ? 'refresh' : undefined);
      else this.#state.set({ phase: 'closed' });
    });
  }

  /**
   * fileVersions and how to call it: the opened Lens, and a local test chain's devVersionsPage
   * (never anywhere else) within the SDK's own MAX_VERSIONS_PAGE.
   */
  async #reader(signal: AbortSignal): Promise<{ read: ReadVersions; opts: ReadOpts }> {
    const files = await loadFiles();
    const network = this.host.network.get();
    const configured = 'network' in network ? versionsPageOf(network.network) : undefined;
    const limit = pageLimit(configured, files.MAX_VERSIONS_PAGE);
    return {
      read: files.fileVersions as ReadVersions,
      opts: { ...(this.lens ? { lens: this.lens } : {}), ...(limit ? { limit } : {}), signal },
    };
  }

  /**
   * The first read (opening), or a whole re-read in place: Refresh or Try again (`refresh`, focus
   * then moves to the first row), or the section's own re-read after a catch-up (`self`, focus
   * untouched: the person didn't act).
   */
  async #load(busy?: 'refresh' | 'self'): Promise<void> {
    const { efs, subject } = this;
    if (!efs || !subject) return;
    this.#catchUp.reading();
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const { signal } = controller;
    if (busy) this.#busy.set('refresh');
    else this.#state.set({ phase: 'loading' });
    this.dataset.reading = '';
    try {
      const { read, opts } = await this.#reader(signal);
      const next = await readVersions(read, efs, subject, opts);
      if (signal.aborted) return;
      if (busy === 'refresh') this.#focus = { to: 'first-row' };
      this.#state.set(next);
      if (versionsBehind(next)) this.#catchUp.behind(efs, () => void this.#load('self'));
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      if (busy === 'refresh') this.#focus = { to: 'first-row' };
      this.#state.set({ phase: 'unknown' });
    } finally {
      if (!signal.aborted) {
        this.#busy.set(undefined);
        delete this.dataset.reading;
      }
    }
  }

  /** Load more (or its Try again): the public tier from `next`, up to the budget. */
  async #more(before: ReadState): Promise<void> {
    const { efs, subject } = this;
    if (!efs || !subject || before.public.status !== 'present') return;
    const controller = new AbortController();
    this.#controller?.abort();
    this.#controller = controller;
    const { signal } = controller;
    const had = before.public.rows.length;
    this.#busy.set('more');
    this.dataset.reading = '';
    try {
      const { read, opts } = await this.#reader(signal);
      const next = await readMore(read, efs, subject, before, opts);
      if (signal.aborted) return;
      const now = next.public.status === 'present' ? next.public.rows.length : had;
      // New rows: focus the first of them. None: focus stays on Load more (still there while
      // more remains); at the list's end, on the public heading.
      this.#focus = now > had ? { to: 'first-new', index: had } : { to: 'keep' };
      this.#state.set(next);
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      this.#focus = { to: 'keep' };
      this.#state.set({ ...before, public: { ...before.public, more: 'failed' } });
    } finally {
      if (!signal.aborted) {
        this.#busy.set(undefined);
        delete this.dataset.reading;
      }
    }
  }

  /** Moves focus where the last click asked, once its rows are rendered; never to body. */
  #placeFocus(): void {
    const want = this.#focus;
    if (!want) return;
    this.#focus = undefined;
    if (want.to === 'keep') {
      if (this.contains(document.activeElement)) return;
      (
        this.querySelector<HTMLElement>('wa-button.efs-versions-more') ??
        this.querySelector<HTMLElement>('[data-section="public"] .efs-topic-heading')
      )?.focus();
      return;
    }
    const target =
      want.to === 'first-new'
        ? this.querySelectorAll<HTMLElement>('[data-section="public"] li.efs-version')[want.index]
        : (this.querySelector<HTMLElement>('li.efs-version') ??
          this.querySelector<HTMLElement>('.efs-versions-decision'));
    target?.focus();
  }

  #row(row: FileVersion, tier: Tier, t: Translator['t']) {
    const efs = this.efs;
    const reader = readerOf(this.host);
    const me = efs && reader ? efs.lens.principalOf(reader as never).toLowerCase() : undefined;
    const author = row.author.toLowerCase();
    const mine = me !== undefined && author === me;
    const showing = (this.#requested.get() ?? this.shown?.toLowerCase()) === author;
    const label = authorLabel(efs, row.author, undefined, this.host.names.get());
    const gated = tier === 'public';
    const show = (event: Event) => {
      this.#requested.set(author);
      // The button gives way to "Showing here": focus stays on the row.
      const li = (event.currentTarget as HTMLElement).closest('li');
      queueMicrotask(() => (li as HTMLElement | null)?.focus());
      this.dispatchEvent(
        new CustomEvent<VersionShowDetail>(VERSION_SHOW_EVENT, {
          detail: { author: row.author, gated },
          bubbles: true,
          composed: true,
        }),
      );
    };
    return html`<li
      class="efs-entry efs-version"
      tabindex="-1"
      data-author=${author}
      ?data-shown=${showing}
    >
      <span class="efs-entry-name" translate="no" dir="auto">${label}</span>
      <span class="efs-entry-meta efs-quiet">
        ${mine ? html`<span>${t('files.versions.markYou')}</span>` : nothing}
        ${row.creator ? html`<span>${t('files.versions.markCreator')}</span>` : nothing}
        ${gated ? html`<span>${t('files.versions.markPublic')}</span>` : nothing}
      </span>
      <span class="efs-entry-actions">
        ${
          showing
            ? html`<span class="efs-quiet efs-version-showing">${t('files.versions.showingHere')}</span>`
            : html`<wa-button
                size="s"
                appearance=${gated ? 'outlined' : 'filled'}
                class=${gated ? 'efs-version-open' : 'efs-version-show'}
                @click=${show}
                ><span aria-hidden="true"
                  >${t(gated ? 'files.versions.open' : 'files.versions.show')}</span
                ><span class="wa-visually-hidden"
                  >${
                    // wa-button doesn't pass an aria-label on to its own button: the full name
                    // ("Show Alice's version") is its hidden text instead.
                    mine
                      ? t('files.edit.showMine')
                      : t(gated ? 'files.versions.openLabel' : 'files.versions.showLabel', {
                          author: label,
                        })
                  }</span
                ></wa-button
              >`
        }
      </span>
    </li>`;
  }

  #tier(tier: 'lens' | 'creator', rows: readonly FileVersion[], t: Translator['t']) {
    const standing = rows.filter((r) => r.state === 'PRESENT');
    if (standing.length === 0) return nothing;
    return html`<section class="wa-stack wa-gap-2xs" data-section=${tier}>
      <h4 class="efs-topic-heading">
        ${t(tier === 'lens' ? 'files.versions.lensSection' : 'files.versions.creatorSection')}
      </h4>
      <ul class="efs-entries" role="list">${standing.map((r) => this.#row(r, tier, t))}</ul>
    </section>`;
  }

  #public(s: ReadState, t: Translator['t']) {
    const pub = s.public;
    const busy = this.#busy.get();
    const retry = () => void this.#load('refresh');
    const outcome = (code: string, reason: string | undefined) =>
      html`<efs-outcome
        compact
        .kind=${'read'}
        .code=${code}
        .reason=${reason}
        .unknownMessage=${'files.versions.publicUnknown'}
        .reset=${readFloorReset(this.host.network.get(), this.host.reader.get())}
        .translator=${this.host.translator}
        retryable
        @efs-retry=${retry}
      ></efs-outcome>`;
    const rows = pub.status === 'present' ? pub.rows.filter((r) => r.state === 'PRESENT') : [];
    return html`<section class="wa-stack wa-gap-2xs" data-section="public">
      <h4 class="efs-topic-heading" tabindex="-1">${t('files.versions.publicSection')}</h4>
      ${
        pub.status === 'unknown'
          ? outcome('UNKNOWN', pub.reason?.code)
          : html`${
              rows.length > 0
                ? html`<ul class="efs-entries" role="list">
                    ${rows.map((r) => this.#row(r, 'public', t))}
                  </ul>`
                : nobodyElse(pub)
                  ? html`<p class="efs-quiet efs-versions-no-others">${t('files.versions.noOthers')}</p>`
                  : nothing
            }
            ${
              pub.changed
                ? html`<div class="wa-cluster wa-gap-xs efs-versions-changed" role="status">
                    <span>${t('files.versions.changed')}</span>
                    <wa-button
                      size="s"
                      appearance="outlined"
                      class="efs-versions-refresh"
                      ?loading=${busy === 'refresh'}
                      @click=${retry}
                      >${t('files.versions.refresh')}</wa-button
                    >
                  </div>`
                : nothing
            }
            ${
              pub.more === 'failed'
                ? html`<div class="wa-cluster wa-gap-xs efs-versions-more-failed" role="status">
                    <span>${t('files.versions.moreFailed')}</span>
                    <wa-button
                      size="s"
                      class="efs-versions-more"
                      ?loading=${busy === 'more'}
                      @click=${() => void this.#more(s)}
                      >${t('outcome.retry')}</wa-button
                    >
                  </div>`
                : pub.next
                  ? html`<div class="wa-cluster wa-gap-xs">
                      ${
                        pub.unchecked
                          ? html`<span class="efs-quiet efs-versions-unchecked" role="status"
                              >${t('files.versions.moreToCheck')}</span
                            >`
                          : nothing
                      }
                      <wa-button
                        size="s"
                        class="efs-versions-more"
                        ?loading=${busy === 'more'}
                        @click=${() => void this.#more(s)}
                        >${t('files.versions.loadMore')}</wa-button
                      >
                    </div>`
                  : nothing
            }`
      }
    </section>`;
  }

  #body(t: Translator['t']) {
    const s = this.#state.get();
    switch (s.phase) {
      case 'closed':
        return nothing;
      case 'loading':
        return html`<p class="wa-cluster wa-gap-xs" role="status">
          <wa-spinner></wa-spinner>${t('files.versions.reading')}
        </p>`;
      case 'absent':
        return html`<p class="efs-quiet">${t('files.versions.absent')}</p>`;
      case 'unknown':
        return html`<efs-outcome
          .kind=${'read'}
          .code=${'UNKNOWN'}
          .reason=${s.reason?.code}
          .unknownMessage=${'files.versions.unknown'}
          .reset=${readFloorReset(this.host.network.get(), this.host.reader.get())}
          .translator=${this.host.translator}
          retryable
          @efs-retry=${() => void this.#load('refresh')}
        ></efs-outcome>`;
      case 'read': {
        const efs = this.efs;
        const reader = readerOf(this.host);
        const me = efs && reader ? efs.lens.principalOf(reader as never) : undefined;
        const line = decisionLine(s.decision, me);
        const author = line.author
          ? authorLabel(efs, line.author, undefined, this.host.names.get())
          : undefined;
        return html`${
          s.decision.kind === 'unknown'
            ? html`<div class="efs-versions-decision" tabindex="-1" data-decision="unknown">
                <efs-outcome
                  compact
                  .kind=${'read'}
                  .code=${'UNKNOWN'}
                  .reason=${s.decision.reason.code}
                  .unknownMessage=${'files.versions.decision.unknown'}
                  .reset=${readFloorReset(this.host.network.get(), this.host.reader.get())}
                  .translator=${this.host.translator}
                  retryable
                  @efs-retry=${() => void this.#load('refresh')}
                ></efs-outcome>
              </div>`
            : html`<p
                class="efs-versions-decision"
                tabindex="-1"
                data-decision=${s.decision.kind}
              >
                ${t(line.id, author ? { author } : {})}
              </p>`
        }
          ${this.#tier('lens', s.lens, t)}
          ${s.creator ? this.#tier('creator', [s.creator], t) : nothing}
          ${this.#public(s, t)}`;
      }
    }
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    if (!this.subject) return nothing;
    const count = versionsCount(this.#state.get());
    return html`<details
      class="efs-file-versions"
      @toggle=${(event: Event) => {
        const open = (event.target as HTMLDetailsElement).open;
        if (open && this.#state.get().phase === 'closed') void this.#load();
      }}
    >
      <summary>
        ${
          count === undefined
            ? t('files.versions.title')
            : t('files.versions.titleCount', { count })
        }
      </summary>
      <div class="wa-stack wa-gap-s efs-file-versions-body">${this.#body(t)}</div>
    </details>`;
  }
}

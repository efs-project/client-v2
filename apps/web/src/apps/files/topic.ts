// A tag's list (a topic: `cars/tesla`) or an address's (a home: `0x…`), in the Entries pane.
//
// - Reads go through the SDK's topicItems in the view the person picked (Mine, Everyone, Raw; Everyone
//   is the default, D11), here and below or only here (topics), in one Lens: the link's own, or
//   "you first" then the default Lens; an address puts itself right after the reader
//   (efs.lens.place). Raw reads no Lens.
// - Rows are placed by who decided them (`decider`): the Lens's first, then the public tier,
//   labelled ("not checked by anyone you trust · recently added"). Every row says whose it is.
// - A row filed below the tag says where (topicPath, read once per topic).
// - Nothing is read before the pin is VERIFIED; UNKNOWN is never an empty list; only `finished`
//   ends a list. Page sizes are the SDK's own (its read bounds), never set here.
// - A row opens by its permanent link. A thing reached only through the public tier opens behind
//   the media gate (nav.gate): its Type, size and author first, with "Show preview".
// - No display name is invented: until the SDK names things in a list (tags-0.1 §5.5), a row shows
//   the thing's short id.

import type { Address, Efs, Lens, Reason } from '@efs/sdk';
import { link as linkOf } from '@efs/sdk/links';
import type { TopicPlace, TopicRow, TopicView } from '@efs/sdk/tags';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { shortId } from './editor.ts';
import type { FolderNav } from './navigation.ts';
import { readerNotice } from './notice.ts';
import { readerOf } from './object-kind.ts';
import type { LinkState } from './target.ts';
import {
  badWord,
  DEFAULT_TOPIC_VIEW,
  emptyLine,
  filedBelow,
  fromTopicPage,
  pathText,
  rowWho,
  sections,
  TOPIC_VIEWS,
  type TopicListState,
} from './topic-model.ts';

/** A tag or an address: the places this pane lists. */
export type PlaceLink = Extract<LinkState, { status: 'topic' } | { status: 'home' }>;

/** A row opened from this list: the Entries pane keeps showing the list while its link is open. */
export interface PlaceOpened {
  readonly place: PlaceLink;
  /** The object link the row opened (canonical). */
  readonly link: string;
}

const loadTags = async () => import('@efs/sdk/tags');
const loadChecksum = async () => (await import('@efs/sdk')).checksumAddress;

const VIEW_LABEL: Readonly<Record<TopicView, MessageId>> = {
  mine: 'files.topic.view.mine',
  everyone: 'files.topic.view.everyone',
  raw: 'files.topic.view.raw',
};

type CountState =
  | { readonly status: 'present'; readonly positionsEver: bigint }
  | { readonly status: 'unknown' };

export class EfsFilesTopic extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
    place: { attribute: false },
    opened: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;
  /** The tag or address to list (the route's, or the one a row was opened from). */
  declare place: ReadonlySignal<PlaceLink | undefined>;
  /** Where this pane says which row it opened. */
  declare opened: { set(o: PlaceOpened | undefined): void };

  #view = state<TopicView>(DEFAULT_TOPIC_VIEW);
  #below = state(true);
  #state = state<TopicListState | undefined>(undefined);
  #count = state<CountState | undefined>(undefined);
  /** Each topic a roll-up row was filed under, by id: its words, or null if they couldn't be read. */
  #paths = state<ReadonlyMap<string, readonly string[] | null>>(new Map());
  /** The address shown, checksummed (display only; the lowercase form is what's read). */
  #checksummed = state<string | undefined>(undefined);
  #scope: OwnerScope | undefined;
  #run: OwnerScope | undefined;
  #loaded: string | undefined;

  protected override createRenderRoot() {
    return this;
  }

  start(scope: OwnerScope): void {
    this.#scope = scope;
    effect(scope, () => {
      const efs = verifiedEfs(this.host.reader.get());
      const place = this.place.get();
      const view = this.#view.get();
      const below = this.#below.get();
      const reader = readerOf(this.host);
      const key = efs && place ? `${place.canonical}|${view}|${below}|${reader ?? ''}` : undefined;
      if (key === this.#loaded) return;
      this.#loaded = key;
      queueMicrotask(() => void this.#load(efs, place, view, below, reader));
    });
  }

  /** What the SDK reads for `place`: a topic's words as typed, or a home. */
  #target(place: PlaceLink): TopicPlace {
    return place.status === 'topic'
      ? place.segments
      : { kind: 'home', address: place.address as Address };
  }

  /**
   * The Lens the list is read in: the link's own; else, for a tag, you first then the default
   * Lens; for an address, you, then the address, then the default (efs.lens.place).
   */
  #lens(efs: Efs, place: PlaceLink, reader: string | undefined): Lens {
    if (place.lens) return place.lens;
    if (place.status === 'home') {
      return efs.lens.place({
        ...(reader ? { reader: reader as never } : {}),
        owner: place.address as Address,
        base: efs.lens.default,
      });
    }
    return reader ? efs.lens.mineFirst(reader as never, efs.lens.default) : efs.lens.default;
  }

  async #load(
    efs: Efs | undefined,
    place: PlaceLink | undefined,
    view: TopicView,
    below: boolean,
    reader: string | undefined,
  ): Promise<void> {
    this.#run?.dispose();
    this.#run = undefined;
    if (!efs || !place || !this.#scope || this.#scope.signal.aborted) {
      this.#state.set(undefined);
      return;
    }
    const run = this.#scope.child();
    this.#run = run;
    const { signal } = run;
    this.#state.set({ phase: 'loading' });
    this.#count.set(undefined);
    if (place.status === 'home') {
      void loadChecksum()
        .then((checksum) => {
          if (!signal.aborted) this.#checksummed.set(checksum(place.address as never));
        })
        .catch(() => undefined);
    }
    try {
      const tags = await loadTags();
      if (signal.aborted) return;
      // Words as typed (no fold yet): one the chain refuses is named, and nothing is read.
      const refused =
        place.status === 'topic' ? badWord(place.segments, tags.checkWord) : undefined;
      if (refused) {
        this.#state.set(refused);
        return;
      }
      const target = this.#target(place);
      const rollup = place.status === 'topic' && below;
      const lens = view === 'raw' ? undefined : this.#lens(efs, place, reader);
      // "About N": the place's own count, plus what's filed strictly below it in a roll-up (the
      // chain's `below` count leaves the place itself out). A thing filed at both is counted
      // twice, which is why it's only ever "about".
      const count = (below: boolean) =>
        tags
          .placeCount(efs, target, { ...(below ? { below: true } : {}), signal })
          .catch(() => undefined);
      const [page, here, deeper] = await Promise.all([
        tags.topicItems(efs, target, {
          view,
          ...(lens ? { lens } : {}),
          ...(rollup ? { below: true } : {}),
          signal,
        }),
        count(false),
        rollup ? count(true) : Promise.resolve(undefined),
      ]);
      if (signal.aborted) return;
      this.#count.set(
        here?.status === 'PRESENT' && (!rollup || deeper?.status === 'PRESENT')
          ? {
              status: 'present',
              positionsEver:
                here.positionsEver + (deeper?.status === 'PRESENT' ? deeper.positionsEver : 0n),
            }
          : { status: 'unknown' },
      );
      const next = fromTopicPage(page);
      this.#state.set(next);
      void this.#readPaths(efs, next, signal);
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      // A word the SDK refuses before reading (MISUSE): the grammar's own rule.
      this.#state.set({
        phase: 'invalid',
        reason: (error as { reason?: Reason }).reason ?? ({ code: 'CLIENT_ERROR' } as Reason),
      });
    }
  }

  /** "Keep looking": the next page, appended. */
  async #more(): Promise<void> {
    const s = this.#state.get();
    const efs = verifiedEfs(this.host.reader.get());
    const place = this.place.get();
    const run = this.#run;
    if (s?.phase !== 'page' || !s.next || !efs || !place || !run) return;
    const view = this.#view.get();
    const below = place.status === 'topic' && this.#below.get();
    const lens = view === 'raw' ? undefined : this.#lens(efs, place, readerOf(this.host));
    this.#state.set({ ...s, more: 'loading' });
    try {
      const { topicItems } = await loadTags();
      const page = await topicItems(efs, this.#target(place), {
        view,
        ...(lens ? { lens } : {}),
        ...(below ? { below: true } : {}),
        cursor: s.next,
        signal: run.signal,
      });
      if (run.signal.aborted) return;
      const next = fromTopicPage(page, s);
      this.#state.set(next);
      void this.#readPaths(efs, next, run.signal);
    } catch (error) {
      if (run.signal.aborted) return;
      console.error(error);
      this.#state.set({ ...s, more: 'failed' });
    }
  }

  /** The words of each topic a shown row was filed under (below the place), each read once. */
  async #readPaths(efs: Efs, s: TopicListState, signal: AbortSignal): Promise<void> {
    if (s.phase !== 'page') return;
    const known = this.#paths.get();
    const ids = [
      ...new Set(s.rows.filter((r) => filedBelow(r, s.place)).map((r) => r.topic.toLowerCase())),
    ].filter((id) => !known.has(id));
    if (ids.length === 0) return;
    const { topicPath } = await loadTags();
    for (const id of ids) {
      const answer = await topicPath(efs, id as never, { signal }).catch(() => undefined);
      if (signal.aborted) return;
      const next = new Map(this.#paths.get());
      next.set(id, answer?.status === 'PRESENT' ? answer.words : null);
      this.#paths.set(next);
    }
  }

  /** Opens a row by its permanent link; one reached only through the public tier, gated. */
  #open(row: TopicRow, place: PlaceLink): void {
    const target = linkOf({ kind: 'object', subject: row.thing as never });
    if (row.decider.kind !== 'lens') this.nav.gate(row.thing);
    this.opened.set({ place, link: target });
    this.host.openLink(target);
  }

  #who(row: TopicRow, me: string | undefined, owner: string | undefined, t: Translator['t']) {
    const who = rowWho(row, me, owner);
    if (!who) return '';
    switch (who.kind) {
      case 'you':
        return t('files.topic.taggedByYou');
      case 'author':
        return t('files.topic.taggedBy', { author: shortId(who.author) });
      case 'public':
        return who.yes === undefined ? '' : t('files.topic.yes', { count: Number(who.yes) });
      case 'raw':
        return who.yes === undefined || who.statements === undefined
          ? ''
          : t('files.topic.rawCounts', {
              yes: Number(who.yes),
              statements: Number(who.statements),
            });
    }
  }

  #row(row: TopicRow, s: Extract<TopicListState, { phase: 'page' }>, place: PlaceLink) {
    const t = this.host.translator.t.bind(this.host.translator);
    const efs = verifiedEfs(this.host.reader.get());
    const reader = readerOf(this.host);
    const me = efs && reader ? efs.lens.principalOf(reader as never) : undefined;
    const owner =
      efs && place.status === 'home' ? efs.lens.principalOf(place.address as never) : undefined;
    const below = filedBelow(row, s.place)
      ? this.#paths.get().get(row.topic.toLowerCase())
      : undefined;
    const filed =
      below === undefined
        ? nothing
        : html`<span class="efs-topic-filed"
            >${
              below
                ? t('files.topic.filedAt', { path: pathText(below) })
                : t('files.topic.filedBelow')
            }</span
          >`;
    const id = shortId(row.thing);
    return html`<li class="efs-entry efs-topic-row" data-decider=${row.decider.kind}>
      <button
        type="button"
        class="efs-entry-open"
        aria-label=${t('files.topic.open', { id })}
        @click=${() => this.#open(row, place)}
      >
        ${appIcon('file')} <span class="efs-entry-name" translate="no" dir="ltr">${id}</span>
      </button>
      <span class="efs-entry-meta efs-quiet">
        <span class="efs-topic-who">${this.#who(row, me, owner, t)}</span>
        ${filed}
      </span>
    </li>`;
  }

  #list(s: TopicListState, place: PlaceLink, t: Translator['t']) {
    switch (s.phase) {
      case 'loading':
        return html`<p class="wa-cluster wa-gap-xs" role="status">
          <wa-spinner></wa-spinner>${t('files.topic.reading')}
        </p>`;
      case 'unknown':
        return html`<efs-outcome
          .kind=${'read'}
          .code=${'UNKNOWN'}
          .translator=${this.host.translator}
          retryable
          @efs-retry=${() => this.#reload()}
        ></efs-outcome>`;
      case 'badWord':
        return html`<wa-callout variant="warning" class="efs-topic-bad-word">
          <span slot="icon">${appIcon('triangle-exclamation')}</span>
          <p>${t('files.topic.badWord', { word: s.word, code: s.code })}</p>
          <p class="efs-quiet" translate="no">${s.rule}</p>
        </wa-callout>`;
      case 'invalid':
        return html`<wa-callout variant="warning" class="efs-topic-invalid">
          <span slot="icon">${appIcon('triangle-exclamation')}</span>
          <p>
            ${t('files.topic.invalid')}
            <code translate="no" dir="ltr">${s.reason.code}${s.reason.detail ? `: ${s.reason.detail}` : ''}</code>
          </p>
        </wa-callout>`;
      case 'page': {
        const parts = sections(s.rows);
        const empty = emptyLine(s);
        const group = (heading: MessageId, rows: readonly TopicRow[], kind: string) =>
          rows.length === 0
            ? nothing
            : html`<section class="wa-stack wa-gap-2xs efs-topic-section" data-section=${kind}>
                <h4 class="efs-topic-heading">${t(heading)}</h4>
                <ul class="efs-entries" role="list">
                  ${rows.map((row) => this.#row(row, s, place))}
                </ul>
              </section>`;
        return html`${
          empty
            ? html`<p class="efs-quiet efs-topic-empty" role="status">
                ${t(empty === 'none' ? 'files.topic.none' : 'files.topic.noneYet')}
              </p>`
            : nothing
        }
          ${group('files.topic.lensSection', parts.lens, 'lens')}
          ${group('files.topic.publicSection', parts.public, 'public')}
          ${group('files.topic.rawSection', parts.raw, 'raw')}
          ${
            s.dedupBounded
              ? html`<p class="efs-quiet efs-topic-repeats">${t('files.topic.repeats')}</p>`
              : nothing
          }
          ${
            s.more === 'failed'
              ? html`<efs-outcome
                  .kind=${'read'}
                  .code=${'UNKNOWN'}
                  .translator=${this.host.translator}
                  retryable
                  @efs-retry=${() => void this.#more()}
                ></efs-outcome>`
              : s.next
                ? html`<div>
                    <wa-button
                      size="s"
                      class="efs-topic-more"
                      ?loading=${s.more === 'loading'}
                      @click=${() => void this.#more()}
                      >${t('files.list.keepLooking')}</wa-button
                    >
                  </div>`
                : nothing
          }`;
      }
    }
  }

  #reload(): void {
    this.#loaded = undefined;
    const place = this.place.get();
    void this.#load(
      verifiedEfs(this.host.reader.get()),
      place,
      this.#view.get(),
      this.#below.get(),
      readerOf(this.host),
    );
  }

  #header(place: PlaceLink, t: Translator['t']) {
    const count = this.#count.get();
    const isTopic = place.status === 'topic';
    const shownAddress = this.#checksummed.get() ?? (isTopic ? '' : place.address);
    return html`<header class="wa-stack wa-gap-2xs efs-topic-header">
      <p class="wa-cluster wa-gap-2xs efs-quiet efs-topic-mark" data-mark=${isTopic ? 'tag' : 'address'}>
        ${appIcon(isTopic ? 'tag' : 'house')}
        <span>${t(isTopic ? 'files.topic.mark' : 'files.home.mark')}</span>
      </p>
      <h3 class="efs-topic-title">
        ${
          isTopic
            ? t('files.topic.title', { path: pathText(place.segments) })
            : t('files.home.title', { address: shownAddress })
        }
      </h3>
      ${
        isTopic && place.segments.length === 1 && place.segments[0]?.endsWith('.eth')
          ? html`<p class="efs-quiet efs-topic-not-address">
              ${t('files.topic.notAddress', { word: place.segments[0] })}
            </p>`
          : nothing
      }
      ${
        count?.status === 'present'
          ? html`<p class="efs-quiet efs-topic-count">
              ${t('files.topic.about', { count: Number(count.positionsEver) })}
            </p>`
          : count?.status === 'unknown'
            ? html`<p class="efs-quiet efs-topic-count">${t('files.topic.countUnknown')}</p>`
            : nothing
      }
    </header>`;
  }

  #controls(place: PlaceLink, t: Translator['t']) {
    return html`<div class="wa-cluster wa-gap-m efs-topic-controls">
      <wa-radio-group
        class="efs-topic-view"
        label=${t('files.topic.view.label')}
        orientation="horizontal"
        size="s"
        .value=${this.#view.get()}
        @change=${(event: Event) => {
          const value = (event.target as HTMLElement & { value: string }).value;
          const next = TOPIC_VIEWS.find((v) => v === value);
          if (next && next !== this.#view.get()) this.#view.set(next);
        }}
      >
        ${TOPIC_VIEWS.map((v) => html`<wa-radio value=${v}>${t(VIEW_LABEL[v])}</wa-radio>`)}
      </wa-radio-group>
      ${
        place.status === 'topic'
          ? html`<wa-radio-group
              class="efs-topic-scope"
              label=${t('files.topic.scope.label')}
              orientation="horizontal"
              size="s"
              .value=${this.#below.get() ? 'below' : 'here'}
              @change=${(event: Event) => {
                const value = (event.target as HTMLElement & { value: string }).value;
                const below = value !== 'here';
                if (below !== this.#below.get()) this.#below.set(below);
              }}
            >
              <wa-radio value="below">${t('files.topic.scope.below')}</wa-radio>
              <wa-radio value="here">${t('files.topic.scope.here')}</wa-radio>
            </wa-radio-group>`
          : nothing
      }
    </div>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const place = this.place.get();
    if (!place) return nothing;
    const notice = readerNotice(this, this.host, t);
    if (place.status === 'home' && place.names.length > 0) {
      const home = linkOf({ kind: 'home', address: place.address as Address, names: [] });
      return html`<div class="wa-stack wa-gap-s efs-topic" data-place="home">
        ${this.#header(place, t)}
        <p class="efs-home-names-soon" role="status">${t('files.home.namesSoon')}</p>
        <div>
          <wa-button size="s" class="efs-home-open" @click=${() => this.host.openLink(home)}
            >${t('files.home.openBare')}</wa-button
          >
        </div>
      </div>`;
    }
    const s = this.#state.get();
    return html`<div class="wa-stack wa-gap-s efs-topic" data-place=${place.status}>
      ${this.#header(place, t)}
      ${notice ?? html`${this.#controls(place, t)} ${s ? this.#list(s, place, t) : nothing}`}
    </div>`;
  }
}

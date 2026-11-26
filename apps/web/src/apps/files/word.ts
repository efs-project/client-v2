// The word page (`#/r/<realm>/tesla`): "what does anyone mean by tesla?". Grouped by place, never
// one mixed list (tags.md, spec §3.4).
//
// - The groups are the SDK's wordPage: every place whose own last word is the word, the plain
//   one-word tag first ("/tesla (just the word)"), then the rest in the SDK's order (Lens-first
//   ordering waits for a Lens count). Each shows "about N" (exact plus below), its few most recently
//   added items, and Open. Opening the plain one shows that tag's own list here (tab memory: its
//   link is this page's); any other opens its tag's link.
// - Items follow the tag list's rules: rows by `decider`, the public tier gated when opened, and
//   only `finished` ends a list. A group that can't be read says so; nothing is added into a
//   total as if known.
// - Reads run one after another (one group at a time), so a replay sees them in one order.

import type { Efs } from '@efs/sdk';
import { link as linkOf } from '@efs/sdk/links';
import type { PlaceCountRow, TopicRow, TopicView } from '@efs/sdk/tags';
import { markOnce } from '../../platform/marks.ts';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { shortId } from './editor.ts';
import { type NameRead, nameOf, readFileNames } from './names.ts';
import type { FolderNav } from './navigation.ts';
import { readerNotice } from './notice.ts';
import { readerOf } from './object-kind.ts';
import {
  openThing,
  type PlaceLink,
  type PlaceOpened,
  tagLens,
  viewControl,
  whoLine,
} from './topic.ts';
import {
  aboutCount,
  badWord,
  DEFAULT_TOPIC_VIEW,
  emptyLine,
  fromPlacesPage,
  fromTopicPage,
  type PlacesState,
  pathText,
  sections,
  type TopicListState,
} from './topic-model.ts';

const loadTags = async () => import('@efs/sdk/tags');

/** How many recently added items a group shows: the page's choice, not a read bound. */
const GROUP_ROWS = 3;

interface Group {
  /** The place's words (root first), or null when they couldn't be read. */
  readonly words: readonly string[] | null | undefined;
  readonly list: TopicListState;
}

export class EfsFilesWord extends EfsElement {
  static override properties = {
    host: { attribute: false },
    nav: { attribute: false },
    place: { attribute: false },
    opened: { attribute: false },
    plain: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;
  /** The one-word tag whose word this page is. */
  declare place: ReadonlySignal<PlaceLink | undefined>;
  declare opened: { set(o: PlaceOpened | undefined): void };
  /** Shows the plain one-word tag's own list in place of this page (its canonical link). */
  declare plain: { set(canonical: string | undefined): void };

  #view = state<TopicView>(DEFAULT_TOPIC_VIEW);
  #places = state<PlacesState | undefined>(undefined);
  #groups = state<ReadonlyMap<string, Group>>(new Map());
  #refused = state<Extract<TopicListState, { phase: 'badWord' }> | undefined>(undefined);
  /** Names for the groups' items (fileNames), by thing. */
  #names = state<ReadonlyMap<string, NameRead>>(new Map());
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
      const reader = readerOf(this.host);
      const key = efs && place ? `${place.canonical}|${view}|${reader ?? ''}` : undefined;
      if (key === this.#loaded) return;
      this.#loaded = key;
      queueMicrotask(() => void this.#load(efs, place, view, reader));
    });
  }

  #word(place: PlaceLink): string | undefined {
    return place.status === 'topic' && place.segments.length === 1 ? place.segments[0] : undefined;
  }

  async #load(
    efs: Efs | undefined,
    place: PlaceLink | undefined,
    view: TopicView,
    reader: string | undefined,
  ): Promise<void> {
    this.#run?.dispose();
    this.#run = undefined;
    // A run replaced or stopped is no longer reading (the new one, if any, says so itself).
    delete this.dataset.reading;
    this.#places.set(undefined);
    this.#groups.set(new Map());
    this.#refused.set(undefined);
    this.#names.set(new Map());
    const word = place ? this.#word(place) : undefined;
    if (!efs || !place || word === undefined || !this.#scope || this.#scope.signal.aborted) return;
    const run = this.#scope.child();
    this.#run = run;
    const { signal } = run;
    this.#places.set({ phase: 'loading' });
    // While the page's reads run: `data-reading` on the element (what a test waits on).
    this.dataset.reading = '';
    try {
      const tags = await loadTags();
      if (signal.aborted) return;
      const refused = badWord([word], tags.checkWord);
      if (refused) {
        this.#refused.set(refused);
        this.#places.set(undefined);
        return;
      }
      const page = await tags.wordPage(efs, word, { signal });
      if (signal.aborted) return;
      const places = fromPlacesPage(page);
      this.#places.set(places);
      // The word's places are on screen (or honestly not): the budget's end point.
      markOnce('efs:word-listed');
      if (places.phase === 'page') {
        await this.#readGroups(efs, place, view, reader, places.rows, signal);
        await this.#readNames(efs, place, view, reader, signal);
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      this.#places.set({ phase: 'unknown' });
      markOnce('efs:word-listed');
    } finally {
      if (this.#run === run) delete this.dataset.reading;
    }
  }

  /** Each place's words and its few most recently added items, one place at a time. */
  async #readGroups(
    efs: Efs,
    place: PlaceLink,
    view: TopicView,
    reader: string | undefined,
    rows: readonly PlaceCountRow[],
    signal: AbortSignal,
  ): Promise<void> {
    const tags = await loadTags();
    const lens = view === 'raw' ? undefined : tagLens(efs, place.lens, reader);
    for (const row of rows) {
      const id = row.topic.toLowerCase();
      if (this.#groups.get().has(id)) continue;
      const path = await tags.topicPath(efs, row.topic, { signal }).catch(() => undefined);
      if (signal.aborted) return;
      const words = path?.status === 'PRESENT' ? path.words : null;
      this.#setGroup(id, { words, list: { phase: 'loading' } });
      const page = await tags
        .topicItems(
          efs,
          { kind: 'topic', id: row.topic },
          { view, ...(lens ? { lens } : {}), below: true, rows: GROUP_ROWS, signal },
        )
        .catch(() => undefined);
      if (signal.aborted) return;
      this.#setGroup(id, {
        words,
        list: page
          ? fromTopicPage(page)
          : { phase: 'unknown', reason: { code: 'CLIENT_ERROR' } as never },
      });
    }
  }

  /** Names for the groups' shown items (fileNames), one batch after the groups are read. */
  async #readNames(
    efs: Efs,
    place: PlaceLink,
    view: TopicView,
    reader: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const rows = [...this.#groups.get().values()].flatMap((g) =>
      g.list.phase === 'page' ? g.list.rows.slice(0, GROUP_ROWS) : [],
    );
    const lens = view === 'raw' ? undefined : tagLens(efs, place.lens, reader);
    const found = await readFileNames(efs, rows, this.#names.get(), lens, signal);
    if (signal.aborted || found.size === 0) return;
    this.#names.set(new Map([...this.#names.get(), ...found]));
  }

  #setGroup(id: string, group: Group): void {
    const next = new Map(this.#groups.get());
    next.set(id, group);
    this.#groups.set(next);
  }

  /** "Keep looking": more places, then their groups. */
  async #more(): Promise<void> {
    const s = this.#places.get();
    const efs = verifiedEfs(this.host.reader.get());
    const place = this.place.get();
    const word = place ? this.#word(place) : undefined;
    const run = this.#run;
    if (s?.phase !== 'page' || !s.next || !efs || !place || word === undefined || !run) return;
    this.#places.set({ ...s, more: 'loading' });
    try {
      const { wordPage } = await loadTags();
      const page = await wordPage(efs, word, { cursor: s.next, signal: run.signal });
      if (run.signal.aborted) return;
      const next = fromPlacesPage(page, s);
      this.#places.set(next);
      if (next.phase === 'page') {
        await this.#readGroups(
          efs,
          place,
          this.#view.get(),
          readerOf(this.host),
          next.rows,
          run.signal,
        );
      }
    } catch (error) {
      if (run.signal.aborted) return;
      console.error(error);
      this.#places.set({ ...s, more: 'failed' });
    }
  }

  #reload(): void {
    this.#loaded = undefined;
    void this.#load(
      verifiedEfs(this.host.reader.get()),
      this.place.get(),
      this.#view.get(),
      readerOf(this.host),
    );
  }

  /** Open: the plain one-word tag shows its own list here; any other opens its tag's link. */
  #open(place: PlaceLink, words: readonly string[]): void {
    if (words.length === 1) {
      this.plain.set(place.canonical);
      return;
    }
    try {
      this.host.openLink(linkOf({ kind: 'topic', segments: words, words }));
    } catch (error) {
      console.error(error);
    }
  }

  #item(row: TopicRow, place: PlaceLink, t: Translator['t']) {
    const efs = verifiedEfs(this.host.reader.get());
    const reader = readerOf(this.host);
    const me = efs && reader ? efs.lens.principalOf(reader as never) : undefined;
    const id = shortId(row.thing);
    const name = nameOf(this.#names.get(), row);
    return html`<li class="efs-entry efs-topic-row" data-decider=${row.decider.kind}>
      <button
        type="button"
        class="efs-entry-open"
        aria-label=${t('files.topic.open', { id: name ?? id })}
        @click=${() => openThing(this.host, this.nav, this.opened, place, row)}
      >
        ${appIcon('file')}
        ${
          name
            ? html`<span class="efs-entry-name" translate="no" dir="auto">${name}</span>${
                // A name nobody you trust vouched for never stands alone: its id stays beside it.
                row.decider.kind === 'lens'
                  ? nothing
                  : html` <span class="efs-quiet efs-entry-id" translate="no" dir="ltr">${id}</span>`
              }`
            : html`<span class="efs-entry-name" translate="no" dir="ltr">${id}</span>`
        }
      </button>
      <span class="efs-entry-meta efs-quiet">
        <span class="efs-topic-who">${whoLine(t, efs, row, me, undefined, undefined, this.host.names.get())}</span>
        ${
          row.decider.kind === 'public'
            ? html`<span class="efs-word-public">${t('files.word.fromEveryone')}</span>`
            : nothing
        }
      </span>
    </li>`;
  }

  #group(row: PlaceCountRow, place: PlaceLink, t: Translator['t']) {
    const group = this.#groups.get().get(row.topic.toLowerCase());
    const words = group?.words;
    const path = words ? pathText(words) : shortId(row.topic);
    const heading = words?.length === 1 ? t('files.word.justTheWord', { path }) : path;
    const list = group?.list;
    let items: unknown = nothing;
    if (!list || list.phase === 'loading') {
      items = html`<p class="wa-cluster wa-gap-xs efs-quiet" role="status">
        <wa-spinner></wa-spinner>${t('files.topic.reading')}
      </p>`;
    } else if (list.phase === 'page') {
      const empty = emptyLine(list);
      const parts = sections(list.rows);
      const shown = [...parts.lens, ...parts.public, ...parts.raw].slice(0, GROUP_ROWS);
      items = empty
        ? html`<p class="efs-quiet">${t(empty === 'none' ? 'files.topic.none' : 'files.topic.noneYet')}</p>`
        : html`<ul class="efs-entries" role="list">
            ${shown.map((r) => this.#item(r, place, t))}
          </ul>`;
    } else {
      items = html`<p class="efs-quiet efs-word-group-unknown">${t('files.word.groupUnknown')}</p>`;
    }
    return html`<section class="wa-stack wa-gap-2xs efs-word-group" data-root=${words?.length === 1 ? 'yes' : 'no'}>
      <div class="wa-split wa-gap-s">
        <div class="wa-stack wa-gap-3xs">
          <h4 class="efs-topic-heading" translate="no" dir="auto">${heading}</h4>
          <span class="efs-quiet">${t('files.topic.childAbout', { count: Number(aboutCount(row)) })}</span>
        </div>
        ${
          words
            ? html`<wa-button
                size="s"
                class="efs-word-open"
                aria-label=${t('files.word.open', { path })}
                @click=${() => this.#open(place, words)}
                >${t('files.word.openShort')}</wa-button
              >`
            : nothing
        }
      </div>
      ${items}
    </section>`;
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const place = this.place.get();
    const word = place ? this.#word(place) : undefined;
    if (!place || word === undefined) return nothing;
    const notice = readerNotice(this, this.host, t);
    const refused = this.#refused.get();
    const s = this.#places.get();
    const header = html`<header class="wa-stack wa-gap-2xs efs-topic-header">
      <p class="wa-cluster wa-gap-2xs efs-quiet efs-topic-mark" data-mark="tag">
        ${appIcon('tag')} <span>${t('files.topic.mark')}</span>
      </p>
      <h3 class="efs-topic-title">${t('files.word.title', { word })}</h3>
      ${
        word.endsWith('.eth')
          ? html`<p class="efs-quiet efs-topic-not-address">${t('files.topic.notAddress', { word })}</p>`
          : nothing
      }
      ${
        s?.phase === 'page'
          ? html`<p class="efs-quiet efs-word-count">
              ${t(s.finished ? 'files.word.places' : 'files.word.placesSoFar', { count: s.rows.length })}
            </p>`
          : nothing
      }
    </header>`;
    if (notice)
      return html`<div class="wa-stack wa-gap-s efs-topic efs-word">${header} ${notice}</div>`;
    if (refused) {
      return html`<div class="wa-stack wa-gap-s efs-topic efs-word">
        ${header}
        <wa-callout variant="warning" class="efs-topic-bad-word">
          <span slot="icon">${appIcon('triangle-exclamation')}</span>
          <p>${t('files.topic.badWord', { word: refused.word, code: refused.code })}</p>
          <p class="efs-quiet" translate="no">${refused.rule}</p>
        </wa-callout>
      </div>`;
    }
    let body: unknown = nothing;
    if (s?.phase === 'loading') {
      body = html`<p class="wa-cluster wa-gap-xs" role="status">
        <wa-spinner></wa-spinner>${t('files.topic.reading')}
      </p>`;
    } else if (s?.phase === 'absent') {
      // The reader proved no word page exists: no place uses the word yet.
      body = html`<p class="efs-quiet efs-topic-empty" role="status">
        ${t('files.word.none', { word })}
      </p>`;
    } else if (s?.phase === 'invalid') {
      // A refused read (the SDK's INVALID): said with its code, never as "nothing uses it".
      body = html`<wa-callout variant="warning" class="efs-word-invalid">
        <span slot="icon">${appIcon('triangle-exclamation')}</span>
        <p>
          ${t('files.word.invalid')}
          <code translate="no" dir="ltr">${s.reason.code}${s.reason.detail ? `: ${s.reason.detail}` : ''}</code>
        </p>
      </wa-callout>`;
    } else if (s?.phase === 'unknown') {
      body = html`<efs-outcome
        .kind=${'read'}
        .code=${'UNKNOWN'}
        .translator=${this.host.translator}
        retryable
        @efs-retry=${() => this.#reload()}
      ></efs-outcome>`;
    } else if (s?.phase === 'page') {
      body = html`${
        s.rows.length === 0
          ? html`<p class="efs-quiet efs-topic-empty" role="status">
              ${t(s.finished ? 'files.word.none' : 'files.topic.noneYet', { word })}
            </p>`
          : nothing
      }
        ${s.rows.map((row) => this.#group(row, place, t))}
        ${
          s.more === 'failed'
            ? html`<p class="efs-quiet">${t('files.word.groupUnknown')}</p>`
            : s.next
              ? html`<div>
                  <wa-button
                    size="s"
                    class="efs-word-more"
                    ?loading=${s.more === 'loading'}
                    @click=${() => void this.#more()}
                    >${t('files.list.keepLooking')}</wa-button
                  >
                </div>`
              : nothing
        }`;
    }
    return html`<div class="wa-stack wa-gap-s efs-topic efs-word">
      ${header} ${viewControl(t, this.#view.get(), (view) => this.#view.set(view))} ${body}
    </div>`;
  }
}

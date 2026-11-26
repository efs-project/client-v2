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
import type {
  SegmentName,
  TagPlace,
  TagTarget,
  TopicPlace,
  TopicRow,
  TopicView,
} from '@efs/sdk/tags';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { MessageId, Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import type { EfsFolderSave } from './folder-save.ts';
import {
  languageName,
  type NameRead,
  nameOf,
  readerLangs,
  readFileNames,
  readMyLabel,
  readTopicName,
} from './names.ts';
import type { FolderNav } from './navigation.ts';
import { readerNotice } from './notice.ts';
import { readerOf } from './object-kind.ts';
import type { LinkState } from './target.ts';
import {
  aboutCount,
  badWord,
  DEFAULT_TOPIC_VIEW,
  emptyLine,
  filedBelow,
  fromPlacesPage,
  fromTopicPage,
  type PlacesState,
  pathText,
  rowWho,
  sections,
  shownPlaces,
  TOPIC_VIEWS,
  type TopicListState,
} from './topic-model.ts';
import { authorLabel, shortId } from './who.ts';

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

/** What a row's line says about who it's from (empty for an address's own rows). */
export function whoLine(
  t: Translator['t'],
  efs: Efs | undefined,
  row: Pick<TopicRow, 'decider' | 'yes' | 'statements'>,
  me: string | undefined,
  owner: string | undefined,
  /** An address view's own address: its contract principal (a Safe's home) reads as it too. */
  contracts?: readonly string[],
): string {
  const who = rowWho(row, me, owner);
  if (!who) return '';
  switch (who.kind) {
    case 'you':
      return t('files.topic.taggedByYou');
    case 'author':
      return t('files.topic.taggedBy', { author: authorLabel(efs, who.author, contracts) });
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

/**
 * Opens a listed thing by its permanent link, keeping the list beside it (`opened`). A thing only
 * the public tier vouched for opens behind the media gate.
 */
export function openThing(
  host: AppHost,
  nav: FolderNav,
  opened: { set(o: PlaceOpened | undefined): void },
  place: PlaceLink,
  row: TopicRow,
): void {
  const target = linkOf({ kind: 'object', subject: row.thing as never });
  if (row.decider.kind !== 'lens') nav.gate(row.thing);
  opened.set({ place, link: target });
  host.openLink(target);
}

/** The view control: People I trust, Everyone, Unfiltered. */
export function viewControl(
  t: Translator['t'],
  value: TopicView,
  onChange: (view: TopicView) => void,
) {
  return html`<wa-radio-group
    class="efs-topic-view"
    label=${t('files.topic.view.label')}
    orientation="horizontal"
    size="s"
    .value=${value}
    @change=${(event: Event) => {
      const next = TOPIC_VIEWS.find(
        (v) => v === (event.target as HTMLElement & { value: string }).value,
      );
      if (next && next !== value) onChange(next);
    }}
  >
    ${TOPIC_VIEWS.map((v) => html`<wa-radio value=${v}>${t(VIEW_LABEL[v])}</wa-radio>`)}
  </wa-radio-group>`;
}

/** The Lens a tag's list is read in: the link's own, else you first, then the default Lens. */
export function tagLens(efs: Efs, lens: Lens | undefined, reader: string | undefined): Lens {
  if (lens) return lens;
  return reader ? efs.lens.mineFirst(reader as never, efs.lens.default) : efs.lens.default;
}

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
    plain: { attribute: false },
  };
  declare host: AppHost;
  declare nav: FolderNav;
  /** The tag or address to list (the route's, or the one a row was opened from). */
  declare place: ReadonlySignal<PlaceLink | undefined>;
  /** Where this pane says which row it opened. */
  declare opened: { set(o: PlaceOpened | undefined): void };
  /** A one-word tag shown as its own list: "The word's page" goes back to the word's page. */
  declare plain: { set(canonical: string | undefined): void } | undefined;

  #view = state<TopicView>(DEFAULT_TOPIC_VIEW);
  #below = state(true);
  #state = state<TopicListState | undefined>(undefined);
  #count = state<CountState | undefined>(undefined);
  /** Each topic a roll-up row was filed under, by id: its words, or null if they couldn't be read. */
  #paths = state<ReadonlyMap<string, readonly string[] | null>>(new Map());
  /** The address shown, checksummed (display only; the lowercase form is what's read). */
  #checksummed = state<string | undefined>(undefined);
  /** Saves sent from this list ("Remove my tag", "Name this tag"): once complete, read again. */
  #untagging = new Set<string>();
  /** Names for listed files, by thing (fileNames): read once each. */
  #names = state<ReadonlyMap<string, NameRead>>(new Map());
  /** The tag's segments as named in the reader's languages (topicName), when read. */
  #segments = state<readonly SegmentName[] | undefined>(undefined);
  /**
   * The connected person's own name for this tag in their language (labelOf in a Lens of just
   * them): a string, null when they have none, undefined until read (or not connected).
   */
  #mine = state<string | null | undefined>(undefined);
  /** "Tags under this one": newest first (the junk rule and the Lens tiers wait on the SDK). */
  #children = state<PlacesState | undefined>(undefined);
  #showAll = state(false);
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
    // "Remove my tag" landed: read the list again (the row leaves it, or shows the next stance).
    effect(scope, () => {
      for (const p of this.host.saving.saves.get()) {
        if (!this.#untagging.has(p.sequenceId) || p.state !== 'COMPLETE') continue;
        this.#untagging.delete(p.sequenceId);
        queueMicrotask(() => this.#reload());
      }
    });
  }

  /**
   * "Remove my tag": your own tag on a row, taken back where it was filed (planUntag). The thing's
   * kind is read first (openObject), since a tag names a file or a folder by its own id.
   */
  async #untag(row: TopicRow, at: TagPlace): Promise<void> {
    const efs = verifiedEfs(this.host.reader.get());
    if (!efs) return;
    const { openObject } = await import('@efs/sdk/files');
    const object = await openObject(efs, row.thing).catch(() => undefined);
    const target: TagTarget | undefined =
      object?.status === 'FILE'
        ? object.file
        : object?.status === 'FOLDER'
          ? object.folder
          : undefined;
    if (!target) return;
    const dialog = this.querySelector<EfsFolderSave>('efs-files-folder-save.efs-topic-tag-dialog');
    dialog?.open({
      kind: 'tag',
      targets: [target],
      names: [shortId(row.thing)],
      place: at,
      stance: 'untag',
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
    return tagLens(efs, undefined, reader);
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
    // A run replaced or stopped is no longer reading (the new one, if any, says so itself).
    delete this.dataset.reading;
    if (!efs || !place || !this.#scope || this.#scope.signal.aborted) {
      this.#state.set(undefined);
      return;
    }
    const run = this.#scope.child();
    this.#run = run;
    // While this list's reads run (rows, paths, children, names): `data-reading` on the element,
    // so anything waiting for the view to settle (a test) waits for exactly this.
    this.dataset.reading = '';
    try {
      await this.#loadRun(efs, place, view, below, reader, run);
    } finally {
      if (this.#run === run) delete this.dataset.reading;
    }
  }

  async #loadRun(
    efs: Efs,
    place: PlaceLink,
    view: TopicView,
    below: boolean,
    reader: string | undefined,
    run: OwnerScope,
  ): Promise<void> {
    const { signal } = run;
    this.#state.set({ phase: 'loading' });
    this.#count.set(undefined);
    this.#children.set(undefined);
    this.#showAll.set(false);
    this.#segments.set(undefined);
    this.#mine.set(undefined);
    this.#names.set(new Map());
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
      // One after the other, so the reads keep one order (replays depend on it).
      await this.#readPaths(efs, next, signal);
      if (place.status === 'topic' && !signal.aborted)
        await this.#readChildren(efs, target, signal);
      if (!signal.aborted) await this.#readNames(efs, next, lens, signal);
      if (place.status === 'topic' && !signal.aborted) {
        const langs = readerLangs(this.host.translator.locale);
        const segments = await readTopicName(efs, place.segments, lens, langs, signal);
        if (!signal.aborted) this.#segments.set(segments);
        // Yours, for "Name this tag" (to change or remove): read only when you're connected.
        if (reader && !signal.aborted) {
          const mine = await readMyLabel(efs, place.segments, reader, this.#lang(), signal);
          if (!signal.aborted) this.#mine.set(mine);
        }
      }
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
    this.dataset.reading = '';
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
      await this.#readPaths(efs, next, run.signal);
      if (!run.signal.aborted) await this.#readNames(efs, next, lens, run.signal);
    } catch (error) {
      if (run.signal.aborted) return;
      console.error(error);
      this.#state.set({ ...s, more: 'failed' });
    } finally {
      if (this.#run === run) delete this.dataset.reading;
    }
  }

  /** "Tags under this one": a page of the tag's children (or the next, appended). */
  async #readChildren(efs: Efs, target: TopicPlace, signal: AbortSignal): Promise<void> {
    const before = this.#children.get();
    const cursor = before?.phase === 'page' ? before.next : undefined;
    if (before?.phase === 'page' && cursor) this.#children.set({ ...before, more: 'loading' });
    else this.#children.set({ phase: 'loading' });
    try {
      const { topicChildren } = await loadTags();
      const page = await topicChildren(efs, target, { ...(cursor ? { cursor } : {}), signal });
      if (signal.aborted) return;
      this.#children.set(
        fromPlacesPage(page, before?.phase === 'page' && cursor ? before : undefined),
      );
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      this.#children.set(
        before?.phase === 'page' && cursor ? { ...before, more: 'failed' } : { phase: 'unknown' },
      );
    }
  }

  #moreChildren(): void {
    const efs = verifiedEfs(this.host.reader.get());
    const place = this.place.get();
    const run = this.#run;
    if (!efs || place?.status !== 'topic' || !run) return;
    this.#showAll.set(true);
    void this.#readChildren(efs, this.#target(place), run.signal);
  }

  #childrenSection(place: Extract<PlaceLink, { status: 'topic' }>, t: Translator['t']) {
    const c = this.#children.get();
    if (!c || c.phase === 'loading') return nothing;
    if (c.phase === 'invalid') {
      return html`<section class="wa-stack wa-gap-2xs efs-topic-children" data-section="children">
        <h4 class="efs-topic-heading">${t('files.topic.children')}</h4>
        <p class="efs-quiet">
          ${t('files.topic.childrenInvalid')}
          <code translate="no" dir="ltr">${c.reason.code}</code>
        </p>
      </section>`;
    }
    if (c.phase === 'unknown') {
      return html`<section class="wa-stack wa-gap-2xs efs-topic-children" data-section="children">
        <h4 class="efs-topic-heading">${t('files.topic.children')}</h4>
        <p class="efs-quiet">${t('files.topic.childrenUnknown')}</p>
        <div>
          <wa-button size="s" @click=${() => this.#retryChildren()}>${t('outcome.retry')}</wa-button>
        </div>
      </section>`;
    }
    // Proven to have nothing under it (a tag nobody registered), or a finished empty page.
    if (c.phase === 'absent' || (c.rows.length === 0 && c.finished)) return nothing;
    const { shown, held } = shownPlaces(c.rows, this.#showAll.get());
    const open = (word: string) => {
      const words = [...place.segments, word];
      try {
        this.host.openLink(linkOf({ kind: 'topic', segments: words, words }));
      } catch (error) {
        console.error(error);
      }
    };
    return html`<section class="wa-stack wa-gap-2xs efs-topic-children" data-section="children">
      <h4 class="efs-topic-heading">${t('files.topic.children')}</h4>
      <ul class="efs-entries" role="list">
        ${shown.map((row) => {
          const label = row.word ? pathText([...place.segments, row.word]) : shortId(row.topic);
          return html`<li class="efs-entry efs-topic-child">
            ${
              row.word
                ? html`<button
                    type="button"
                    class="efs-entry-open"
                    @click=${() => row.word && open(row.word)}
                  >
                    ${appIcon('tag')} <span class="efs-entry-name" translate="no" dir="auto">${label}</span>
                  </button>`
                : html`<span class="efs-entry-open">
                    ${appIcon('tag')} <span class="efs-entry-name" translate="no" dir="ltr">${label}</span>
                  </span>`
            }
            <span class="efs-entry-meta efs-quiet">
              ${t('files.topic.childAbout', { count: Number(aboutCount(row)) })}
            </span>
          </li>`;
        })}
      </ul>
      ${
        held > 0
          ? html`<div>
              <wa-button size="s" class="efs-topic-children-all" @click=${() => this.#showAll.set(true)}
                >${
                  // "Show all N" only for a directory read to its end; otherwise more may follow.
                  c.finished
                    ? t('files.topic.childrenAll', { count: c.rows.length })
                    : t('files.topic.childrenMore')
                }</wa-button
              >
            </div>`
          : this.#showAll.get() || c.rows.length <= shown.length
            ? c.more === 'failed'
              ? html`<p class="efs-quiet">${t('files.topic.childrenUnknown')}</p>`
              : c.next
                ? html`<div>
                    <wa-button
                      size="s"
                      class="efs-topic-children-more"
                      ?loading=${c.more === 'loading'}
                      @click=${() => this.#moreChildren()}
                      >${t('files.list.keepLooking')}</wa-button
                    >
                  </div>`
                : nothing
            : nothing
      }
    </section>`;
  }

  #retryChildren(): void {
    const efs = verifiedEfs(this.host.reader.get());
    const place = this.place.get();
    const run = this.#run;
    if (!efs || place?.status !== 'topic' || !run) return;
    this.#children.set(undefined);
    void this.#readChildren(efs, this.#target(place), run.signal);
  }

  /** Names for the shown rows' files (fileNames), each read once; a row without one keeps its id. */
  async #readNames(
    efs: Efs,
    s: TopicListState,
    lens: Lens | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (s.phase !== 'page') return;
    const found = await readFileNames(efs, s.rows, this.#names.get(), lens, signal);
    if (signal.aborted || found.size === 0) return;
    this.#names.set(new Map([...this.#names.get(), ...found]));
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

  /** "Remove my tag" on a row you decided, where its place (the tag it was filed at) is known. */
  #removeMine(
    row: TopicRow,
    s: Extract<TopicListState, { phase: 'page' }>,
    place: PlaceLink,
    me: string | undefined,
    t: Translator['t'],
    id: string,
  ) {
    if (rowWho(row, me)?.kind !== 'you' || this.host.saving.hosting.shared) return nothing;
    const words = filedBelow(row, s.place)
      ? this.#paths.get().get(row.topic.toLowerCase())
      : place.status === 'topic'
        ? place.segments
        : undefined;
    const at: TagPlace | undefined =
      place.status === 'home' && !filedBelow(row, s.place)
        ? { kind: 'home', address: place.address as Address }
        : words
          ? words
          : undefined;
    if (!at) return nothing;
    return html`<span class="efs-entry-actions">
      <wa-button
        size="s"
        appearance="plain"
        class="efs-topic-untag"
        @click=${() => void this.#untag(row, at)}
        >${t('files.tag.removeMine')}<span class="wa-visually-hidden"
          >${t('files.tag.removeMineFor', { id })}</span
        ></wa-button
      >
    </span>`;
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
    // Its name when the SDK found one (tagger, creator or Lens), else its short id: never "no name".
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
      ${this.#removeMine(row, s, place, me, t, id)}
      <span class="efs-entry-meta efs-quiet">
        <span class="efs-topic-who">${whoLine(t, efs, row, me, owner, place.status === 'home' ? [place.address] : undefined)}</span>
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

  /** The language a name is given in here: the reader's first. */
  #lang(): string {
    return readerLangs(this.host.translator.locale)[0] ?? 'en';
  }

  /** "Name this tag": the person's own name for it in their language (planLabel). */
  #name(place: Extract<PlaceLink, { status: 'topic' }>): void {
    const dialog = this.querySelector<EfsFolderSave>('efs-files-folder-save.efs-topic-tag-dialog');
    const lang = this.#lang();
    const mine = this.#mine.get();
    dialog?.open({
      kind: 'label',
      place: place.segments,
      lang,
      langName: languageName(lang, this.host.translator.locale),
      tag: pathText(place.segments),
      ...(typeof mine === 'string' ? { current: mine } : {}),
    });
  }

  /** The tag's path as shown: each segment's label (topicName) where the Lens gives one. */
  #shownPath(words: readonly string[]): string {
    const named = this.#segments.get();
    return named && named.length === words.length
      ? pathText(named.map((x) => x.name))
      : pathText(words);
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
            ? t('files.topic.title', {
                // A Lens the link brought (not the reader's) never relabels the title: its words.
                path: place.lens ? pathText(place.segments) : this.#shownPath(place.segments),
              })
            : t('files.home.title', { address: shownAddress })
        }
      </h3>
      ${
        // A label shown in place of a word: the words stay beside it (they're what the link holds).
        isTopic && this.#segments.get()?.some((x) => x.source !== 'none')
          ? html`<p class="efs-quiet efs-topic-words" translate="no" dir=${place.lens ? 'auto' : 'ltr'}>
              ${place.lens ? this.#shownPath(place.segments) : pathText(place.segments)}
            </p>`
          : nothing
      }
      ${
        isTopic && place.segments.length === 1
          ? html`<div>
              <wa-button size="s" appearance="plain" class="efs-word-back" @click=${() => this.plain?.set(undefined)}
                >${t('files.word.back', { word: place.segments[0] ?? '' })}</wa-button
              >
            </div>`
          : nothing
      }
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
      ${place.status === 'topic' ? this.#naming(place, t) : nothing}
    </header>`;
  }

  /** "Name this tag", with your name for it when you have one: only when you're connected. */
  #naming(place: Extract<PlaceLink, { status: 'topic' }>, t: Translator['t']) {
    const mine = this.#mine.get();
    if (!readerOf(this.host) || this.host.saving.hosting.shared || mine === undefined) {
      return nothing;
    }
    return html`<div class="wa-cluster wa-gap-xs efs-topic-naming">
      ${
        mine
          ? html`<span class="efs-quiet efs-topic-mine"
              >${t('files.label.mine', {
                name: mine,
                lang: languageName(this.#lang(), this.host.translator.locale),
              })}</span
            >`
          : nothing
      }
      <wa-button
        size="s"
        appearance="outlined"
        class="efs-topic-name"
        @click=${() => this.#name(place)}
        ><span slot="start">${appIcon('pen-to-square')}</span>${t('files.label.button')}</wa-button
      >
    </div>`;
  }

  #controls(place: PlaceLink, t: Translator['t']) {
    return html`<div class="wa-cluster wa-gap-m efs-topic-controls">
      ${viewControl(t, this.#view.get(), (view) => this.#view.set(view))}
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
    const s = this.#state.get();
    const efs = verifiedEfs(this.host.reader.get());
    return html`<div class="wa-stack wa-gap-s efs-topic" data-place=${place.status}>
      <efs-files-folder-save
        class="efs-topic-tag-dialog"
        .host=${this.host}
        .efs=${efs}
        .lens=${efs?.lens.default}
        @efs-folder-saved=${(event: Event) =>
          this.#untagging.add((event as CustomEvent<{ sequenceId: string }>).detail.sequenceId)}
      ></efs-files-folder-save>
      ${this.#header(place, t)}
      ${
        notice ??
        html`${this.#controls(place, t)}
          ${place.status === 'topic' ? this.#childrenSection(place, t) : nothing}
          ${s ? this.#list(s, place, t) : nothing}`
      }
    </div>`;
  }
}

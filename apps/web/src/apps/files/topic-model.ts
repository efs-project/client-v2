// What a tag's (or an address's) list shows, as plain data: the pages the SDK's topicItems read,
// put together, and the rules for saying anything about them. Pure, so every rule is tested.
//
// - Only `finished` ends a list: a short or empty page with `finished: false` means "read on with
//   `next`", never "nothing more" (the SDK's page law).
// - Repeats across pages are the SDK's to remove (`dedup`); a list longer than the cursor can
//   remember says so, and the client never removes repeats itself.
// - An UNKNOWN read is never an empty list: the first page shows why, a later page keeps the rows
//   shown and offers Try again.
// - Each row is placed by who decided it (`decider`): a Lens author's rows first, then the public
//   tier's, labelled; Raw applies no rule.

import type { Reason } from '@efs/sdk';
import type {
  BroaderResult,
  Joined,
  LookupPage,
  MergedCursor,
  MergedList,
  MergedPage,
  PlaceCountRow,
  Related,
  SynonymsResult,
  TopicCursor,
  TopicItemsOpts,
  TopicPage,
  TopicRow,
  TopicView,
} from '@efs/sdk/tags';
import {
  plainVisible,
  type VisiblePart,
  type VisibleParts,
  visibleText,
  wordParts,
} from '../../ui/visible-text.ts';

/** The views, in the order the control offers them. Everyone is the default for tags (D11). */
export const TOPIC_VIEWS: readonly TopicView[] = ['mine', 'everyone', 'raw'];
export const DEFAULT_TOPIC_VIEW: TopicView = 'everyone';

/** What a tag's row is (the SDK's ThingKind, through the options it's asked by). */
type ThingKind = NonNullable<TopicItemsOpts['kinds']>[number];

/**
 * A tag's list, by what its things are (the SDK filters: a short page may read on). Files take a
 * file's versions too (a tag on one version is a tag on the file; the row says "this version");
 * Other is another app's subjects and tags. Addresses stand on their own: tagging an address, and
 * attaching to one, are first-class.
 */
export type TopicKindFilter = 'all' | 'file' | 'folder' | 'address' | 'other';

export const TOPIC_KIND_FILTERS: readonly TopicKindFilter[] = [
  'all',
  'file',
  'folder',
  'address',
  'other',
];

/** topicItems' options for a filter: its kinds, with the exact tier where subjects must be told apart. */
export function topicKindOpts(filter: TopicKindFilter): {
  readonly kinds?: readonly ThingKind[];
  readonly kindsExact?: true;
} {
  switch (filter) {
    case 'all':
      return {};
    case 'file':
      // "file" turns the exact tier on: a created subject counts only if it is a file.
      return { kinds: ['file', 'revision'] };
    case 'folder':
      return { kinds: ['folder'] };
    case 'address':
      return { kinds: ['address'] };
    case 'other':
      // Exact, so a created subject that is a file isn't counted as another app's.
      return { kinds: ['other', 'topic'], kindsExact: true };
  }
}

export type TopicListState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'page';
      /** The place's id as the SDK read it: a row filed elsewhere was filed below it. */
      readonly place: string;
      readonly rows: readonly TopicRow[];
      readonly finished: boolean;
      readonly next?: TopicCursor | MergedCursor;
      /**
       * "Include tags that mean the same" (topicItemsMerged): the merge's lists, how many of them
       * couldn't be read (always said), and whether a bound cut the synonym set ("there may be
       * more"). Absent for a tag's own list.
       */
      readonly merged?: {
        readonly lists: readonly MergedList[];
        readonly missing: number;
        readonly limited: boolean;
      };
      /** Past the cursor's memory, repeats may slip through: said, never hidden. */
      readonly dedupBounded: boolean;
      /** Things the kind filter left out, over every page read (counts.filtered). */
      readonly filtered: number;
      readonly more: 'idle' | 'loading' | 'failed';
    }
  /** Nothing decided: never an empty list. */
  | { readonly phase: 'unknown'; readonly reason: Reason }
  /** The reader refused the query. */
  | { readonly phase: 'invalid'; readonly reason: Reason }
  /**
   * A word of the tag the chain's grammar refuses (checked before any read, words as typed): its
   * position, the chain's code and the rule, as the SDK states them.
   */
  | {
      readonly phase: 'badWord';
      readonly word: string;
      readonly code: number;
      readonly rule: string;
    };

type Page = Extract<TopicListState, { phase: 'page' }>;

/**
 * The list after a merged page (topicItemsMerged): as fromTopicPage, with the merge's lists, the
 * count it couldn't read (the latest page's, which names every refused list) and its limit.
 */
export function fromMergedPage(page: MergedPage, before?: Page): TopicListState {
  if (page.status === 'PRESENT') {
    return {
      phase: 'page',
      place: page.place,
      rows: before ? [...before.rows, ...page.rows] : page.rows,
      finished: page.finished,
      ...(page.next && !page.finished ? { next: page.next } : {}),
      merged: {
        lists: page.lists,
        missing: page.missing.length,
        limited: page.synonyms.limited,
      },
      dedupBounded: (before?.dedupBounded ?? false) || page.dedup.state === 'BOUNDED',
      filtered: (before?.filtered ?? 0) + (page.counts.filtered ?? 0),
      more: 'idle',
    };
  }
  if (page.status === 'UNKNOWN') {
    return before ? { ...before, more: 'failed' } : { phase: 'unknown', reason: page.reason };
  }
  return { phase: 'invalid', reason: page.reason };
}

/** A merged listing's cursor (a tag's own list has its own, which carries no kind). */
export const isMergedCursor = (c: TopicCursor | MergedCursor): c is MergedCursor =>
  'kind' in c && c.kind === 'efs.mergedCursor';

/**
 * Where a merged row came from, as the row says it: nothing for the tag's own list; "same as
 * /autos" for a tag the Lens says is the same; for a word swap, the word it swapped in ("same
 * word: car"), found by comparing the list's words with the tag's.
 */
export function viaLine(
  via: MergedList,
  asked: readonly string[],
  words: readonly string[] | null | undefined,
):
  | { readonly kind: 'same'; readonly path: VisibleParts }
  | { readonly kind: 'word'; readonly word: string }
  | undefined {
  if (via.how === 'self') return undefined;
  if (!words) return undefined;
  if (via.how === 'swap' && words.length === asked.length) {
    const swapped = words.find((w, i) => w !== asked[i]);
    if (swapped !== undefined) return { kind: 'word', word: swapped };
  }
  return { kind: 'same', path: pathParts(words) };
}

/** The list after a page: the first page, or `before` with the next page's rows appended. */
export function fromTopicPage(page: TopicPage, before?: Page): TopicListState {
  if (page.status === 'PRESENT') {
    return {
      phase: 'page',
      place: page.place,
      rows: before ? [...before.rows, ...page.rows] : page.rows,
      finished: page.finished,
      ...(page.next && !page.finished ? { next: page.next } : {}),
      dedupBounded: (before?.dedupBounded ?? false) || page.dedup.state === 'BOUNDED',
      filtered: (before?.filtered ?? 0) + (page.counts.filtered ?? 0),
      more: 'idle',
    };
  }
  if (page.status === 'UNKNOWN') {
    return before ? { ...before, more: 'failed' } : { phase: 'unknown', reason: page.reason };
  }
  return { phase: 'invalid', reason: page.reason };
}

export interface TopicSections {
  /** Decided by someone in the Lens (Mine and Everyone). */
  readonly lens: readonly TopicRow[];
  /** Nobody in the Lens has a stance; someone says yes (Everyone only). */
  readonly public: readonly TopicRow[];
  /** No rule applied (Raw). */
  readonly raw: readonly TopicRow[];
}

/** The rows by who decided them, each section in the SDK's order (recently added first). */
export function sections(rows: readonly TopicRow[]): TopicSections {
  const lens: TopicRow[] = [];
  const pub: TopicRow[] = [];
  const raw: TopicRow[] = [];
  for (const row of rows) {
    if (row.decider.kind === 'lens') lens.push(row);
    else if (row.decider.kind === 'public') pub.push(row);
    else raw.push(row);
  }
  return { lens, public: pub, raw };
}

/**
 * What an empty list says: "none" only once the list really ended, "none yet" while there is more
 * to read. Undefined while there are rows (or nothing is decided).
 */
export function emptyLine(s: TopicListState): 'none' | 'noneYet' | undefined {
  if (s.phase !== 'page' || s.rows.length > 0) return undefined;
  // Things the filter left out: "nothing is tagged here" would be false; the filter's note says it.
  if (s.finished && s.filtered > 0) return undefined;
  return s.finished ? 'none' : 'noneYet';
}

/** The first word the grammar refuses, if any (`check` is the SDK's checkWord). */
export function badWord(
  words: readonly string[],
  check: (word: string) => { ok: true } | { ok: false; code: number; rule: string },
): Extract<TopicListState, { phase: 'badWord' }> | undefined {
  for (const word of words) {
    const r = check(word);
    if (!r.ok) return { phase: 'badWord', word, code: r.code, rule: r.rule };
  }
  return undefined;
}

/** Whether a row was filed below the place shown (a roll-up): then it says where. */
export function filedBelow(row: TopicRow, place: string): boolean {
  return row.topic.toLowerCase() !== place.toLowerCase();
}

/** The row's own words for its tier: who tagged it, or how many say yes. */
export type RowWho =
  | { readonly kind: 'you' }
  | { readonly kind: 'author'; readonly author: string }
  | { readonly kind: 'public'; readonly yes: bigint | undefined }
  | {
      readonly kind: 'raw';
      readonly yes: bigint | undefined;
      readonly statements: bigint | undefined;
    };

/**
 * Who a row is from, as the list says it. `me`: the reader's principal, when connected. `owner`:
 * an address's own principal: its own rows carry no label (every other row does, yours too).
 */
export function rowWho(
  row: Pick<TopicRow, 'decider' | 'yes' | 'statements'>,
  me: string | undefined,
  owner?: string,
): RowWho | undefined {
  const d = row.decider;
  if (d.kind === 'lens') {
    const author = d.author.toLowerCase();
    if (me && author === me.toLowerCase()) return { kind: 'you' };
    if (owner && author === owner.toLowerCase()) return undefined;
    return { kind: 'author', author: d.author };
  }
  if (d.kind === 'public') return { kind: 'public', yes: row.yes };
  return { kind: 'raw', yes: row.yes, statements: row.statements };
}

/** A topic's path as plain text, `/cars/tesla` (hidden code points as "[U+XXXX]"): attributes and the title. */
export function pathText(words: readonly string[]): string {
  return plainVisible(pathParts(words));
}

/**
 * A tag's path as shown: each word as wordParts shows it (ui/visible-text.ts), so a hidden code
 * point in a word from a link or a typed path is a pill, never applied. pathText is its plain form,
 * for attributes and the title.
 */
export function pathParts(words: readonly string[]): VisibleParts {
  const parts: VisiblePart[] = [];
  for (const word of words) parts.push('/', ...wordParts(word));
  return parts.length > 0 ? joinText(parts) : ['/'];
}

/** One tag word as shown (parts); wordText is its plain form. */
export function wordShown(word: string): VisibleParts {
  return wordParts(word);
}

/** One tag word's plain form: hidden code points as "[U+XXXX]" (attributes, the title). */
export function wordText(word: string): string {
  return visibleText(word);
}

/** Adjacent text runs joined. */
function joinText(parts: readonly VisiblePart[]): VisibleParts {
  const out: VisiblePart[] = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (typeof p === 'string' && typeof last === 'string') out[out.length - 1] = last + p;
    else out.push(p);
  }
  return out;
}

/**
 * A tag's children ("Tags under this one") or a word's places (the word page): the SDK's directory
 * pages, newest first. Only `finished` ends one; UNKNOWN is never an empty directory.
 */
export type PlacesState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'page';
      readonly rows: readonly PlaceCountRow[];
      readonly finished: boolean;
      readonly next?: PlacesCursor;
      readonly more: 'idle' | 'loading' | 'failed';
    }
  /** `reason`: the SDK's, when the read answered (BEHIND has its own copy); none when it threw. */
  | { readonly phase: 'unknown'; readonly reason?: Reason }
  /** The SDK refused the directory read: shown with its code, never as empty or as unknown. */
  | { readonly phase: 'invalid'; readonly reason: Reason }
  /** The reader proved the directory isn't there: a word nobody has used, a tag nobody registered. */
  | { readonly phase: 'absent' };

export type PlacesCursor = NonNullable<
  Extract<LookupPage<PlaceCountRow>, { status: 'PRESENT' }>['next']
>;

/** How many children a tag shows before "Show all": the client's choice (tags.md: up to 8). */
export const CHILDREN_SHOWN = 8;

export function fromPlacesPage(
  page: LookupPage<PlaceCountRow>,
  before?: Extract<PlacesState, { phase: 'page' }>,
): PlacesState {
  if (page.status === 'ABSENT_PROVEN') {
    // Proven empty: nothing more to read (a later page can't be absent once a first one wasn't).
    return before
      ? { phase: 'page', rows: before.rows, finished: true, more: 'idle' }
      : { phase: 'absent' };
  }
  if (page.status !== 'PRESENT') {
    if (before) return { ...before, more: 'failed' };
    return page.status === 'INVALID'
      ? { phase: 'invalid', reason: page.reason }
      : { phase: 'unknown', reason: page.reason };
  }
  return {
    phase: 'page',
    rows: before ? [...before.rows, ...page.rows] : page.rows,
    finished: page.finished,
    ...(page.next && !page.finished ? { next: page.next } : {}),
    more: 'idle',
  };
}

/** The rows a directory shows: the first `limit` until the person asks for all. */
export function shownPlaces<T>(
  rows: readonly T[],
  showAll: boolean,
  limit = CHILDREN_SHOWN,
): { readonly shown: readonly T[]; readonly held: number } {
  if (showAll || rows.length <= limit) return { shown: rows, held: 0 };
  return { shown: rows.slice(0, limit), held: rows.length - limit };
}

/**
 * "About N" for a place in a directory: filed exactly there plus filed strictly below it (the
 * chain's two counts), an upper bound, never a row count.
 */
export function aboutCount(row: PlaceCountRow): bigint {
  return row.positionsEver + row.positionsEverBelow;
}

/**
 * A tag related to this one, as the page lists it: its words (null when they couldn't be read), the
 * Lens author whose statement decided it, and that statement as said, by words (`said`: what its
 * author's removal names). `said` is absent when either side's words weren't read.
 */
export interface JoinRow {
  readonly id: string;
  readonly words: readonly string[] | null;
  readonly author: string;
  /** How many joins away (synonyms); 1 for "Under" and "Over". */
  readonly hops: number;
  readonly said?: { readonly subject: readonly string[]; readonly other: readonly string[] };
}

/** One word of the tag, with the words joined to its page ("Same word elsewhere"). */
export interface SynonymWord {
  readonly word: string;
  readonly synonyms: readonly JoinRow[];
}

/**
 * Synonyms as the tag page shows them: never merged with the tag's own items (a merged read isn't
 * built), each a link of its own. `more`: the walk stopped at a bound, or the index doesn't vouch
 * for every list, so a missing synonym isn't proven absent ("there may be more").
 */
export type SynonymsState =
  | {
      readonly phase: 'shown';
      readonly places: readonly JoinRow[];
      readonly words: readonly SynonymWord[];
      readonly more: boolean;
    }
  /** `reason`: the SDK's, when the read answered (BEHIND has its own copy); none when it threw. */
  | { readonly phase: 'unknown'; readonly reason?: Reason };

/** Words by topic id (lowercase), as read; null when a topic's words couldn't be read. */
export type WordsById = ReadonlyMap<string, readonly string[] | null>;

const known = (words: WordsById, id: string) => words.get(id.toLowerCase()) ?? null;

/** A statement's two sides by words, when both were read. */
function saidAs(
  said: { readonly subject: string; readonly other: string },
  words: WordsById,
): JoinRow['said'] {
  const subject = known(words, said.subject);
  const other = known(words, said.other);
  return subject && other ? { subject, other } : undefined;
}

/**
 * The synonyms read (topicSynonyms), with words for every id it names: the tag itself, each joined
 * place (topicPath), and the word pages (their words come with the read).
 */
export function fromSynonyms(result: SynonymsResult, read: WordsById): SynonymsState | undefined {
  // A tag nobody has registered has no synonyms to show (its own page says it's unused).
  if (result.status === 'ABSENT_PROVEN') return undefined;
  if (result.status !== 'PRESENT') {
    return { phase: 'unknown', ...(result.reason ? { reason: result.reason } : {}) };
  }
  const words = new Map(read);
  words.set(result.topic.id.toLowerCase(), result.topic.words);
  for (const w of result.words) {
    words.set(w.page.toLowerCase(), [w.word]);
    for (const x of w.synonyms) words.set(x.id.toLowerCase(), [x.word]);
  }
  const row = (j: Joined, own: readonly string[] | null): JoinRow => {
    const said = saidAs(j.said, words);
    return { id: j.id, words: own, author: j.author, hops: j.hops, ...(said ? { said } : {}) };
  };
  return {
    phase: 'shown',
    places: result.places.map((p) => row(p, known(words, p.id))),
    words: result.words
      .filter((w) => w.synonyms.length > 0)
      .map((w) => ({ word: w.word, synonyms: w.synonyms.map((x) => row(x, [x.word])) })),
    more: result.limited || !result.complete,
  };
}

/** "Under" (the tags this one is under) and "Over" (the tags said to be under it), one hop each. */
export type BroaderState =
  | {
      readonly phase: 'shown';
      readonly broader: readonly JoinRow[];
      readonly narrower: readonly JoinRow[];
      readonly more: boolean;
    }
  /** `reason`: the SDK's, when the read answered (BEHIND has its own copy); none when it threw. */
  | { readonly phase: 'unknown'; readonly reason?: Reason };

/** The broader read (topicBroader), with each related topic's words (topicPath) by id. */
export function fromBroader(result: BroaderResult, read: WordsById): BroaderState | undefined {
  if (result.status === 'ABSENT_PROVEN') return undefined;
  if (result.status !== 'PRESENT') {
    return { phase: 'unknown', ...(result.reason ? { reason: result.reason } : {}) };
  }
  const words = new Map(read);
  words.set(result.topic.id.toLowerCase(), result.topic.words);
  const row = (r: Related): JoinRow => {
    const said = saidAs(r.said, words);
    return {
      id: r.id,
      words: known(words, r.id),
      author: r.author,
      hops: 1,
      ...(said ? { said } : {}),
    };
  };
  return {
    phase: 'shown',
    broader: result.broader.map(row),
    narrower: result.narrower.map(row),
    more: result.limited || !result.complete,
  };
}

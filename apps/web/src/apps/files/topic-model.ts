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
  LookupPage,
  PlaceCountRow,
  TopicCursor,
  TopicPage,
  TopicRow,
  TopicView,
} from '@efs/sdk/tags';

/** The views, in the order the control offers them. Everyone is the default for tags (D11). */
export const TOPIC_VIEWS: readonly TopicView[] = ['mine', 'everyone', 'raw'];
export const DEFAULT_TOPIC_VIEW: TopicView = 'everyone';

export type TopicListState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'page';
      /** The place's id as the SDK read it: a row filed elsewhere was filed below it. */
      readonly place: string;
      readonly rows: readonly TopicRow[];
      readonly finished: boolean;
      readonly next?: TopicCursor;
      /** Past the cursor's memory, repeats may slip through: said, never hidden. */
      readonly dedupBounded: boolean;
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
export function rowWho(row: TopicRow, me: string | undefined, owner?: string): RowWho | undefined {
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

/** A topic's path as shown: `/cars/tesla`. Each word is shown as stored (no fold here). */
export function pathText(words: readonly string[]): string {
  return `/${words.join('/')}`;
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
  | { readonly phase: 'unknown' }
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
      : { phase: 'unknown' };
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

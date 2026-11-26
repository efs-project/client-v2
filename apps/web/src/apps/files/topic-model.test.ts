import type {
  BroaderResult,
  LookupPage,
  MergedPage,
  PlaceCountRow,
  SynonymsResult,
  TopicPage,
  TopicRow,
} from '@efs/sdk/tags';
import { describe, expect, it } from 'vitest';
import {
  aboutCount,
  badWord,
  badWordReason,
  CHILDREN_SHOWN,
  emptyLine,
  filedBelow,
  fromBroader,
  fromMergedPage,
  fromPlacesPage,
  fromSynonyms,
  fromTopicPage,
  isMergedCursor,
  pathText,
  rowWho,
  sections,
  shownPlaces,
  type TopicListState,
  topicKindOpts,
  viaLine,
  wordText,
} from './topic-model.ts';

const PLACE = `0x${'aa'.repeat(32)}`;
const BELOW = `0x${'bb'.repeat(32)}`;
const ALICE = `0x${'0'.repeat(24)}${'a1'.repeat(20)}`;
const ME = `0x${'0'.repeat(24)}${'6e'.repeat(20)}`;

const row = (n: number, decider: TopicRow['decider'], topic = PLACE): TopicRow =>
  ({
    thing: `0x${n.toString(16).padStart(64, '0')}`,
    topic,
    position: `0x${'cc'.repeat(32)}`,
    number: 0,
    decider,
    yes: 3n,
    statements: 4n,
    entry: BigInt(n),
  }) as TopicRow;

const page = (
  rows: TopicRow[],
  o: { finished?: boolean; bounded?: boolean; filtered?: number } = {},
): TopicPage =>
  ({
    kind: 'efs.topicPage',
    status: 'PRESENT',
    view: 'everyone',
    place: PLACE,
    rows,
    finished: o.finished ?? false,
    scan: o.finished ? 'EXHAUSTED' : 'LIMIT',
    ...(o.finished ? {} : { next: { v: 1, query: '0x', next: '0x', seen: [], bounded: false } }),
    coverage: 'PARTIAL',
    dedup: { state: o.bounded ? 'BOUNDED' : 'COMPLETE', dropped: 0 },
    counts: o.filtered === undefined ? {} : { filtered: o.filtered },
  }) as unknown as TopicPage;

const unknown = { kind: 'efs.topicPage', status: 'UNKNOWN', reason: { code: 'RPC_ERROR' } };

describe('fromTopicPage: the page laws', () => {
  it('only `finished` ends a list: a short page keeps its cursor, and pages append', () => {
    const first = fromTopicPage(page([row(1, { kind: 'public' })]));
    expect(first).toMatchObject({ phase: 'page', finished: false, more: 'idle' });
    if (first.phase !== 'page') throw new Error('page');
    expect(first.next).toBeDefined();
    const second = fromTopicPage(page([row(2, { kind: 'public' })], { finished: true }), first);
    expect(second).toMatchObject({ phase: 'page', finished: true });
    if (second.phase !== 'page') throw new Error('page');
    expect(second.rows.map((r) => r.entry)).toEqual([1n, 2n]);
    expect(second.next).toBeUndefined();
  });

  it('an empty page that is not the end is "none yet", never "none"', () => {
    expect(emptyLine(fromTopicPage(page([])))).toBe('noneYet');
    expect(emptyLine(fromTopicPage(page([], { finished: true })))).toBe('none');
    expect(emptyLine(fromTopicPage(page([row(1, { kind: 'public' })], { finished: true })))).toBe(
      undefined,
    );
    expect(emptyLine({ phase: 'loading' })).toBeUndefined();
  });

  it('UNKNOWN is never an empty list: first page shows why; a later page keeps the rows', () => {
    expect(fromTopicPage(unknown as unknown as TopicPage)).toMatchObject({ phase: 'unknown' });
    const first = fromTopicPage(page([row(1, { kind: 'public' })])) as Extract<
      TopicListState,
      { phase: 'page' }
    >;
    const after = fromTopicPage(unknown as unknown as TopicPage, first);
    expect(after).toMatchObject({ phase: 'page', more: 'failed' });
    if (after.phase !== 'page') throw new Error('page');
    expect(after.rows).toHaveLength(1);
  });

  it('a bounded de-duplication is remembered for the rest of the list', () => {
    const first = fromTopicPage(page([], { bounded: true })) as Extract<
      TopicListState,
      { phase: 'page' }
    >;
    expect(first.dedupBounded).toBe(true);
    const next = fromTopicPage(page([]), first);
    expect(next).toMatchObject({ dedupBounded: true });
  });
});

describe('sections and who: rows by who decided them', () => {
  it("lens rows first, then the public tier's; Raw rows apply no rule", () => {
    const s = sections([
      row(1, { kind: 'public' }),
      row(2, { kind: 'lens', index: 0, author: ALICE as never, number: 0 }),
      row(3, { kind: 'none' }),
    ]);
    expect(s.lens.map((r) => r.entry)).toEqual([2n]);
    expect(s.public.map((r) => r.entry)).toEqual([1n]);
    expect(s.raw.map((r) => r.entry)).toEqual([3n]);
  });

  it('a lens row names its tagger ("you" for the reader); a public row says how many say yes', () => {
    const lensRow = row(1, { kind: 'lens', index: 0, author: ME as never, number: 0 });
    expect(rowWho(lensRow, ME.toUpperCase().replace('0X', '0x'))).toEqual({ kind: 'you' });
    expect(rowWho(lensRow, undefined)).toEqual({ kind: 'author', author: ME });
    expect(rowWho(row(2, { kind: 'public' }), ME)).toEqual({ kind: 'public', yes: 3n });
    // At an address, its own rows carry no label; the reader's own still say "you".
    const owners = row(4, { kind: 'lens', index: 1, author: ALICE as never, number: 0 });
    expect(rowWho(owners, ME, ALICE)).toBeUndefined();
    expect(rowWho(lensRow, ME, ME)).toEqual({ kind: 'you' });
    expect(rowWho(row(3, { kind: 'none' }), ME)).toEqual({
      kind: 'raw',
      yes: 3n,
      statements: 4n,
    });
  });

  it('a roll-up row filed below the place says so; one filed here does not', () => {
    expect(filedBelow(row(1, { kind: 'public' }, BELOW), PLACE)).toBe(true);
    expect(filedBelow(row(1, { kind: 'public' }, PLACE.toUpperCase()), PLACE)).toBe(false);
  });

  it('a word the grammar refuses is named with its code and rule, before any read', () => {
    const check = (w: string) =>
      w === 'Cars' ? { ok: false as const, code: 3, rule: 'A-Z' } : { ok: true as const };
    expect(badWord(['cars', 'tesla'], check)).toBeUndefined();
    expect(badWord(['Cars', 'tesla'], check)).toEqual({
      phase: 'badWord',
      word: 'Cars',
      code: 3,
      rule: 'A-Z',
    });
  });

  it('a path reads as /word/word', () => {
    expect(pathText(['cars', 'tesla'])).toBe('/cars/tesla');
  });
});

describe('directories: children and a word page', () => {
  const place = (n: number, ever = 1n, below = 0n) =>
    ({
      topic: `0x${n.toString(16).padStart(64, '0')}`,
      word: `w${n}`,
      registeredAt: BigInt(n),
      positionsEver: ever,
      positionsEverBelow: below,
      filings: ever,
      filingsBelow: below,
    }) as PlaceCountRow;
  const dir = (rows: PlaceCountRow[], finished: boolean) =>
    ({
      kind: 'efs.lookupPage',
      status: 'PRESENT',
      rows,
      finished,
      ...(finished ? {} : { next: { v: 1, query: '0x', next: '0x' } }),
      skipped: { notOwnFold: 0 },
    }) as unknown as LookupPage<PlaceCountRow>;

  it('appends pages; only `finished` ends one; UNKNOWN is never an empty directory', () => {
    const first = fromPlacesPage(dir([place(1)], false));
    expect(first).toMatchObject({ phase: 'page', finished: false });
    if (first.phase !== 'page') throw new Error('page');
    expect(first.next).toBeDefined();
    const all = fromPlacesPage(dir([place(2)], true), first);
    expect(all).toMatchObject({ phase: 'page', finished: true });
    if (all.phase !== 'page') throw new Error('page');
    expect(all.rows.map((r) => r.word)).toEqual(['w1', 'w2']);
    const failed = { kind: 'efs.lookupPage', status: 'UNKNOWN' } as never;
    expect(fromPlacesPage(failed)).toEqual({ phase: 'unknown' });
    // The reader's proof the directory isn't there: a word nobody has used.
    const absent = { kind: 'efs.lookupPage', status: 'ABSENT_PROVEN' } as never;
    expect(fromPlacesPage(absent)).toEqual({ phase: 'absent' });
    const refused = { kind: 'efs.lookupPage', status: 'INVALID', reason: { code: 'X' } } as never;
    expect(fromPlacesPage(refused)).toEqual({ phase: 'invalid', reason: { code: 'X' } });
    expect(fromPlacesPage(failed, first as never)).toMatchObject({ phase: 'page', more: 'failed' });
  });

  it('shows the first 8 until "Show all"; "about N" is exact plus below', () => {
    const rows = Array.from({ length: 11 }, (_, i) => place(i));
    expect(shownPlaces(rows, false)).toMatchObject({ held: 3 });
    expect(shownPlaces(rows, false).shown).toHaveLength(CHILDREN_SHOWN);
    expect(shownPlaces(rows, true)).toEqual({ shown: rows, held: 0 });
    expect(shownPlaces(rows.slice(0, 3), false).held).toBe(0);
    expect(aboutCount(place(1, 2n, 3n))).toBe(5n);
  });
});

describe('names are keyed by the row they were read for (file and tagger)', () => {
  it("a name read for one tagger's row is never shown on another's row of the same file", async () => {
    const { nameKey, nameOf } = await import('./names.ts');
    const file = `0x${'f0'.repeat(32)}`;
    const byAlice = { thing: file, decider: { kind: 'lens', index: 0, author: ALICE, number: 0 } };
    const pub = { thing: file.toUpperCase().replace('0X', '0x'), decider: { kind: 'public' } };
    expect(nameKey(byAlice as never)).not.toBe(nameKey(pub as never));
    const names = new Map([
      [nameKey(byAlice as never), { name: { text: "alice's name" } } as never],
    ]);
    expect(nameOf(names, byAlice as never)).toBe("alice's name");
    expect(nameOf(names, pub as never)).toBeUndefined();
  });
});

describe('synonyms and "Under": shown as links, never merged; honest about where the search stopped', () => {
  const A = `0x${'aa'.repeat(32)}`;
  const B = `0x${'bb'.repeat(32)}`;
  const W1 = `0x${'c1'.repeat(32)}`;
  const W2 = `0x${'c2'.repeat(32)}`;
  const ME = `0x${'00'.repeat(12)}${'66'.repeat(20)}`;
  const present = (o: Partial<Extract<SynonymsResult, { status: 'PRESENT' }>>): SynonymsResult =>
    ({
      kind: 'efs.synonyms',
      status: 'PRESENT',
      topic: { words: ['cars', 'tesla'], id: A },
      places: [],
      words: [],
      limited: false,
      complete: true,
      ...o,
    }) as unknown as SynonymsResult;

  it('each row carries its words, who said it, and the statement as said by words (for its removal)', () => {
    const s = fromSynonyms(
      present({
        // Said from the other side: "/auto/tesla is the same as /cars/tesla".
        places: [
          { id: B, kind: 'path', hops: 1, author: ME, said: { subject: B, other: A } },
        ] as never,
        words: [
          { word: 'cars', page: W1, synonyms: [] },
          {
            word: 'tesla',
            page: W1,
            synonyms: [
              {
                id: W2,
                kind: 'word',
                hops: 1,
                author: ME,
                word: 'tsla',
                said: { subject: W1, other: W2 },
              },
            ],
          },
        ] as never,
      }),
      new Map([[B, ['auto', 'tesla']]]),
    );
    expect(s).toEqual({
      phase: 'shown',
      places: [
        {
          id: B,
          words: ['auto', 'tesla'],
          author: ME,
          hops: 1,
          said: { subject: ['auto', 'tesla'], other: ['cars', 'tesla'] },
        },
      ],
      words: [
        {
          word: 'tesla',
          synonyms: [
            {
              id: W2,
              words: ['tsla'],
              author: ME,
              hops: 1,
              said: { subject: ['tesla'], other: ['tsla'] },
            },
          ],
        },
      ],
      more: false,
    });
  });

  it("a statement whose sides couldn't both be read has no said (so no Remove)", () => {
    const C = `0x${'dd'.repeat(32)}`;
    const s = fromSynonyms(
      present({
        places: [
          { id: B, kind: 'path', hops: 2, author: ME, said: { subject: B, other: C } },
        ] as never,
      }),
      new Map<string, readonly string[] | null>([
        [B, ['auto', 'tesla']],
        [C, null],
      ]),
    );
    expect(s?.phase === 'shown' ? s.places[0]?.said : 'not shown').toBeUndefined();
  });

  it('"there may be more" whenever a bound stopped the walk or the index does not vouch', () => {
    expect(fromSynonyms(present({ limited: true, complete: false }), new Map())).toMatchObject({
      more: true,
    });
    expect(fromSynonyms(present({ limited: false, complete: false }), new Map())).toMatchObject({
      more: true,
    });
    expect(fromSynonyms(present({}), new Map())).toMatchObject({ more: false });
  });

  it('an unregistered tag shows nothing; a read the network cannot vouch for is unknown, never "none"', () => {
    const absent = { kind: 'efs.synonyms', status: 'ABSENT_PROVEN' } as unknown as SynonymsResult;
    const unknown = { kind: 'efs.synonyms', status: 'UNKNOWN' } as unknown as SynonymsResult;
    expect(fromSynonyms(absent, new Map())).toBeUndefined();
    expect(fromSynonyms(unknown, new Map())).toEqual({ phase: 'unknown' });
  });

  it('"Under" and "Over": one hop each, with words and said; the same honesty about limits', () => {
    const V = `0x${'ee'.repeat(32)}`;
    const result = {
      kind: 'efs.broader',
      status: 'PRESENT',
      topic: { words: ['cars', 'tesla'], id: A },
      broader: [{ id: V, kind: 'word', author: ME, said: { subject: A, other: V } }],
      narrower: [],
      limited: false,
      complete: false,
    } as unknown as BroaderResult;
    expect(fromBroader(result, new Map([[V, ['vehicles']]]))).toEqual({
      phase: 'shown',
      broader: [
        {
          id: V,
          words: ['vehicles'],
          author: ME,
          hops: 1,
          said: { subject: ['cars', 'tesla'], other: ['vehicles'] },
        },
      ],
      narrower: [],
      more: true,
    });
    const unknown = { kind: 'efs.broader', status: 'UNKNOWN' } as unknown as BroaderResult;
    expect(fromBroader(unknown, new Map())).toEqual({ phase: 'unknown' });
  });
});

describe('the kind filter: the SDK filters, and the page says what it left out', () => {
  it('maps each choice to its kinds: files take versions, other is exact, addresses stand alone', () => {
    expect(topicKindOpts('all')).toEqual({});
    expect(topicKindOpts('file')).toEqual({ kinds: ['file', 'revision'] });
    expect(topicKindOpts('folder')).toEqual({ kinds: ['folder'] });
    expect(topicKindOpts('address')).toEqual({ kinds: ['address'] });
    expect(topicKindOpts('other')).toEqual({ kinds: ['other', 'topic'], kindsExact: true });
  });

  it('counts what the filter left out over every page, and never calls a filtered list empty', () => {
    const first = fromTopicPage(page([], { finished: false, filtered: 2 }));
    expect(first.phase === 'page' && first.filtered).toBe(2);
    expect(emptyLine(first)).toBe('noneYet');
    const both = fromTopicPage(page([], { finished: true, filtered: 3 }), first as never);
    expect(both.phase === 'page' && both.filtered).toBe(5);
    // Finished with things left out: "nothing is tagged here" would be false.
    expect(emptyLine(both)).toBeUndefined();
    expect(emptyLine(fromTopicPage(page([], { finished: true })))).toBe('none');
  });
});

describe('"Include tags that mean the same": a merged page, where each row came from, and its limits', () => {
  const merged = (o: Partial<Extract<MergedPage, { status: 'PRESENT' }>>): MergedPage =>
    ({
      kind: 'efs.mergedTopicPage',
      status: 'PRESENT',
      view: 'everyone',
      place: PLACE,
      rows: [],
      finished: true,
      lists: [{ place: PLACE, how: 'self', hops: 0 }],
      missing: [],
      complete: true,
      coverage: 'COMPLETE',
      synonyms: { limited: false, complete: true },
      dedup: { state: 'COMPLETE', dropped: 0 },
      counts: { filtered: 0 },
      ...o,
    }) as unknown as MergedPage;

  it("keeps the merge's lists, counts the ones it couldn't read, and says when a bound cut the set", () => {
    const s = fromMergedPage(
      merged({
        missing: [{ place: BELOW, how: 'same', hops: 1, status: 'UNKNOWN' }] as never,
        synonyms: { limited: true, complete: false },
        finished: false,
        next: { v: 1, kind: 'efs.mergedCursor' } as never,
      }),
    );
    expect(s.phase === 'page' && s.merged).toEqual({
      lists: [{ place: PLACE, how: 'self', hops: 0 }],
      missing: 1,
      limited: true,
    });
    expect(s.phase === 'page' && s.next && isMergedCursor(s.next)).toBe(true);
    // A tag's own cursor carries no kind: never mistaken for a merged one.
    expect(
      isMergedCursor({ v: 1, query: '0x', next: '0x', seen: [], bounded: false } as never),
    ).toBe(false);
  });

  it('says where a row came from: nothing for the tag itself, "same as" a joined tag, "same word" for a swap', () => {
    const asked = ['cars', 'tesla'];
    expect(
      viaLine({ place: PLACE as `0x${string}`, how: 'self', hops: 0 }, asked, asked),
    ).toBeUndefined();
    expect(
      viaLine({ place: BELOW as `0x${string}`, how: 'same', hops: 1 }, asked, ['autos', 'tesla']),
    ).toEqual({
      kind: 'same',
      path: ['/autos/tesla'],
    });
    expect(
      viaLine({ place: BELOW as `0x${string}`, how: 'swap', hops: 1 }, asked, ['cars', 'tsla']),
    ).toEqual({
      kind: 'word',
      word: 'tsla',
    });
    // Words not read: nothing is claimed.
    expect(
      viaLine({ place: BELOW as `0x${string}`, how: 'same', hops: 1 }, asked, null),
    ).toBeUndefined();
  });
});

describe('tag words as shown (wordText, pathText)', () => {
  it('shows what a word must not hold, never applies it: a bidi override, a zero-width joiner', () => {
    expect(wordText('a\u202Eb')).toBe('a[U+202E]b');
    expect(pathText(['cars', 'a\u202Eb\u200Dc'])).toBe('/cars/a[U+202E]b[U+200D]c');
    expect(pathText(['cars', 'tesla'])).toBe('/cars/tesla');
  });
});

describe("a refused word's reason: parseLink's detail, in the person's words (sdk-v2 59bb9fb)", () => {
  it('names each reason the default fold can reach, and never calls a capital or a space a symbol', async () => {
    const { parseLink } = await import('@efs/sdk/links');
    const { loadTranslator } = await import('../../ui/i18n.ts');
    const { t } = await loadTranslator('en');
    const reason = (link: string) => {
      const parsed = parseLink(link);
      if (parsed.status !== 'INVALID' || parsed.rule !== 'bad-word') return parsed.status;
      const id = badWordReason(parsed.detail);
      return id ? t(id) : `unnamed: ${parsed.detail}`;
    };
    // The fold changes only an all-ASCII word, so a capital or a space left beside other text
    // is "unfolded", never forbidden-ascii.
    const unfolded = "a capital letter or a space, in a word that isn't all plain letters";
    expect(reason('École%20Normale')).toBe(unfolded);
    expect(reason('école%20normale')).toBe(unfolded);
    expect(reason('Straße')).toBe(unfolded);
    // Punctuation and symbols other than - _ and . (~ included), whatever else the word holds.
    const symbol = 'a symbol other than - _ or .';
    for (const link of ['c%2B%2B', 'q%26a', "don't", 'ab~c', 'caf%C3%A9+'])
      expect(reason(link)).toBe(symbol);
    expect(reason('inc.')).toBe('it ends with a dot');
    expect(reason('-x')).toBe('it starts with a hyphen');
    // What the fold makes of an all-ASCII word is a word: no reason at all.
    expect(reason('Cars%20Tesla')).toBe('OK');
  });
  it('a detail the list does not name has no words (shown as given)', () => {
    expect(badWordReason('constructor')).toBeUndefined();
    expect(badWordReason('code-12')).toBeUndefined();
    expect(badWordReason(undefined)).toBeUndefined();
  });
});

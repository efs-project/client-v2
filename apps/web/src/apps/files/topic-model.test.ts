import type { LookupPage, PlaceCountRow, TopicPage, TopicRow } from '@efs/sdk/tags';
import { describe, expect, it } from 'vitest';
import {
  aboutCount,
  badWord,
  CHILDREN_SHOWN,
  emptyLine,
  filedBelow,
  fromPlacesPage,
  fromTopicPage,
  pathText,
  rowWho,
  sections,
  shownPlaces,
  type TopicListState,
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

const page = (rows: TopicRow[], o: { finished?: boolean; bounded?: boolean } = {}): TopicPage =>
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
    counts: {},
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

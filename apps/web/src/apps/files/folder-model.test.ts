import type { Efs, Reason } from '@efs/sdk';
import type { FolderCoverage, FolderPage, FolderRef, FolderRow } from '@efs/sdk/files';
import { describe, expect, it, vi } from 'vitest';
import {
  continueListing,
  type FolderReads,
  type ListingState,
  listingNotice,
  startListing,
} from './folder-model.ts';

const efs = {} as Efs;
const folder: FolderRef = { kind: 'folder', directory: `0x${'d1'.repeat(32)}` as never };
const listed: FolderRef = {
  ...folder,
  subject: `0x${'5a'.repeat(32)}` as never,
  owner: `0x${'0a'.repeat(32)}` as never,
};
const row = (name: string): FolderRow =>
  ({
    name,
    kind: 'file',
    author: listed.owner,
    admission: 1n,
    position: '0x',
    target: null,
  }) as never;
const cursor = { v: 1, query: '0x01', continuation: '0x02' } as never;
const reason = (code: string, retry: Reason['retry']): Reason => ({ code, retry }) as never;

const present = (
  rows: FolderRow[],
  coverage: FolderCoverage,
  o: { next?: unknown; hidden?: number; filtered?: number } = {},
): FolderPage =>
  ({
    kind: 'efs.folderPage',
    status: 'PRESENT',
    folder: listed,
    rows,
    skipped: { hidden: o.hidden ?? 0, filtered: o.filtered ?? 0 },
    coverage,
    ...(o.next ? { next: o.next } : {}),
    basis: {},
    evidence: {},
  }) as never;
const refused = (status: 'ABSENT_PROVEN' | 'UNKNOWN' | 'INVALID', r: Reason): FolderPage =>
  ({ kind: 'efs.folderPage', status, folder, reason: r, evidence: {} }) as never;

const readsOf = (...pages: FolderPage[]) => {
  const listFolder = vi.fn();
  for (const page of pages) listFolder.mockResolvedValueOnce(page);
  return { listFolder } satisfies FolderReads;
};
const signal = () => new AbortController().signal;
const pageOf = (s: ListingState | undefined) => {
  if (s?.phase !== 'page') throw new Error(`not a page: ${s?.phase}`);
  return s;
};

describe('startListing', () => {
  it('a COMPLETE scan with no rows is the only "empty"', async () => {
    const s = await startListing(
      readsOf(present([], { state: 'COMPLETE' })),
      efs,
      folder,
      {},
      signal(),
    );
    expect(listingNotice(s as ListingState)).toEqual({ id: 'files.list.empty' });
  });

  it('PARTIAL INDEX_PARTIAL never reads as empty, with or without rows', async () => {
    for (const rows of [[], [row('a.txt')]]) {
      const s = await startListing(
        readsOf(present(rows, { state: 'PARTIAL', why: 'INDEX_PARTIAL' })),
        efs,
        folder,
        {},
        signal(),
      );
      expect(listingNotice(s as ListingState)).toEqual({ id: 'files.list.indexPartial' });
    }
  });

  it('an empty PARTIAL page with a next says how far it looked, and offers Keep looking', async () => {
    const s = pageOf(
      await startListing(
        readsOf(
          present([], { state: 'PARTIAL', why: 'MORE_PAGES' }, { next: cursor, filtered: 50 }),
        ),
        efs,
        folder,
        { kinds: ['folder'] },
        signal(),
      ),
    );
    expect(s.next).toBe(cursor);
    expect(listingNotice(s)).toEqual({ id: 'files.list.partialEmpty', count: 50 });
  });

  it('a page whose coverage the index could not vouch for says so', async () => {
    const s = await startListing(
      readsOf(
        present([row('a.txt')], { state: 'UNKNOWN', reason: reason('INDEX_STALE', 'transient') }),
      ),
      efs,
      folder,
      {},
      signal(),
    );
    expect(listingNotice(s as ListingState)).toEqual({ id: 'files.list.coverageUnknown' });
  });

  it('ABSENT_PROVEN is "not there", UNKNOWN and INVALID keep their reasons; none is a page', async () => {
    const r = reason('NOT_YET_DECIDABLE', 'never');
    expect(
      await startListing(readsOf(refused('ABSENT_PROVEN', r)), efs, folder, {}, signal()),
    ).toEqual({
      phase: 'absent',
      reason: r,
    });
    const u = reason('RPC_UNAVAILABLE', 'transient');
    expect(await startListing(readsOf(refused('UNKNOWN', u)), efs, folder, {}, signal())).toEqual({
      phase: 'unknown',
      reason: u,
    });
    expect(
      (await startListing(readsOf(refused('INVALID', r)), efs, folder, {}, signal()))?.phase,
    ).toBe('invalid');
  });

  it('asks for sizes, passes the lens and kinds, and keeps the folder the SDK read (owner, subject)', async () => {
    const reads = readsOf(present([row('a.txt')], { state: 'COMPLETE' }));
    const lens = { principals: [] } as never;
    const s = pageOf(await startListing(reads, efs, folder, { lens, kinds: ['file'] }, signal()));
    expect(reads.listFolder.mock.calls[0]?.[2]).toMatchObject({
      lens,
      kinds: ['file'],
      withSize: true,
    });
    expect(s.folder).toEqual(listed);
  });

  it('an aborted read shows nothing', async () => {
    const c = new AbortController();
    const reads = readsOf(present([], { state: 'COMPLETE' }));
    const pending = startListing(reads, efs, folder, {}, c.signal);
    c.abort();
    expect(await pending).toBeUndefined();
  });
});

describe('continueListing', () => {
  const first = async (reads: FolderReads) =>
    pageOf(await startListing(reads, efs, folder, {}, signal()));

  it('Keep looking appends rows and sums what was skipped', async () => {
    const reads = readsOf(
      present([row('a.txt')], { state: 'PARTIAL', why: 'MORE_PAGES' }, { next: cursor, hidden: 1 }),
      present([row('b.txt')], { state: 'PARTIAL', why: 'RESUMED' }, { hidden: 2, filtered: 3 }),
    );
    const s = pageOf(await continueListing(reads, efs, await first(reads), {}, signal()));
    expect(s.rows.map((r) => r.name)).toEqual(['a.txt', 'b.txt']);
    expect([s.hidden, s.filtered]).toEqual([3, 3]);
    expect(reads.listFolder.mock.calls[1]?.[2]).toMatchObject({ cursor });
    expect(listingNotice(s)).toBeUndefined();
  });

  it('a stale cursor lists again from the start, replacing the rows (never two bases mixed)', async () => {
    const reads = readsOf(
      present([row('a.txt')], { state: 'PARTIAL', why: 'MORE_PAGES' }, { next: cursor }),
      refused('UNKNOWN', reason('BASIS_STALE', 'after-replan')),
      present([row('a.txt'), row('c.txt')], { state: 'COMPLETE' }),
    );
    const s = pageOf(await continueListing(reads, efs, await first(reads), {}, signal()));
    expect(s.rows.map((r) => r.name)).toEqual(['a.txt', 'c.txt']);
    expect(reads.listFolder.mock.calls[2]?.[2]).not.toHaveProperty('cursor');
  });

  it('another failure keeps the rows shown and says why', async () => {
    const r = reason('RPC_UNAVAILABLE', 'transient');
    const reads = readsOf(
      present([row('a.txt')], { state: 'PARTIAL', why: 'MORE_PAGES' }, { next: cursor }),
      refused('UNKNOWN', r),
    );
    const s = pageOf(await continueListing(reads, efs, await first(reads), {}, signal()));
    expect(s.rows.map((x) => x.name)).toEqual(['a.txt']);
    expect(s.more).toEqual({ status: 'failed', reason: r });
    expect(s.next).toBe(cursor);
  });

  it('a weaker coverage on an earlier page is kept: the warning never disappears on Keep looking', async () => {
    const unvouched = reason('INDEX_STALE', 'transient');
    const reads = readsOf(
      present([row('a.txt')], { state: 'UNKNOWN', reason: unvouched }, { next: cursor }),
      present([row('b.txt')], { state: 'PARTIAL', why: 'RESUMED' }),
    );
    const s = pageOf(await continueListing(reads, efs, await first(reads), {}, signal()));
    expect(s.coverage).toEqual({ state: 'UNKNOWN', reason: unvouched });
    expect(listingNotice(s)).toEqual({ id: 'files.list.coverageUnknown' });
    const partial = readsOf(
      present([row('a.txt')], { state: 'PARTIAL', why: 'INDEX_PARTIAL' }, { next: cursor }),
      present([row('b.txt')], { state: 'PARTIAL', why: 'RESUMED' }),
    );
    const t = pageOf(await continueListing(partial, efs, await first(partial), {}, signal()));
    expect(listingNotice(t)).toEqual({ id: 'files.list.indexPartial' });
  });

  it('a resumed listing that ended with no rows at all is "none found", never "empty"', async () => {
    const reads = readsOf(
      present([], { state: 'PARTIAL', why: 'MORE_PAGES' }, { next: cursor, filtered: 4 }),
      present([], { state: 'PARTIAL', why: 'RESUMED' }, { filtered: 2 }),
    );
    const s = pageOf(await continueListing(reads, efs, await first(reads), {}, signal()));
    expect(listingNotice(s)).toEqual({ id: 'files.list.noneFound' });
  });
});

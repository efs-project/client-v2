import type { FolderCoverage, RemovedPage, RemovedRow } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import { fromRemovedPage, removedNotice } from './removed-model.ts';

const FOLDER = { kind: 'folder', directory: `0x${'d1'.repeat(32)}` } as const;
const row = (name: string): RemovedRow =>
  ({ name, state: 'RELEASED', target: { kind: 'file', subject: '0x' } }) as unknown as RemovedRow;
const page = (rows: readonly RemovedRow[], coverage: FolderCoverage, next?: boolean): RemovedPage =>
  ({
    kind: 'efs.removedPage',
    status: 'PRESENT',
    folder: FOLDER,
    rows,
    coverage,
    ...(next ? { next: { v: 1, query: '0x', from: '50' } } : {}),
  }) as unknown as RemovedPage;
const COMPLETE = { state: 'COMPLETE' } as const;
const MORE = { state: 'PARTIAL', why: 'MORE_PAGES' } as const;
const RESUMED = { state: 'PARTIAL', why: 'RESUMED' } as const;
const INDEX_PARTIAL = { state: 'PARTIAL', why: 'INDEX_PARTIAL' } as const;
const UNKNOWN = { state: 'UNKNOWN', reason: { code: 'NOT_YET_DECIDABLE' } } as never;

describe('fromRemovedPage', () => {
  it('anything but PRESENT is unavailable, never an empty list', () => {
    for (const status of ['UNKNOWN', 'ABSENT_PROVEN', 'INVALID'] as const) {
      expect(fromRemovedPage({ status } as unknown as RemovedPage)).toEqual({
        phase: 'unavailable',
      });
    }
  });
  it('appends a continued page, and coverage only gets weaker', () => {
    const first = fromRemovedPage(page([row('a')], MORE, true));
    if (first.phase !== 'page') throw new Error('expected a page');
    expect(first.next).toBeDefined();
    const second = fromRemovedPage(page([row('b')], COMPLETE), first);
    expect(second).toMatchObject({ phase: 'page', coverage: MORE });
    expect(second.phase === 'page' && second.rows.map((r) => r.name)).toEqual(['a', 'b']);
    expect(second.phase === 'page' && second.next).toBeUndefined();
  });
});

describe('removedNotice', () => {
  const notice = (p: RemovedPage) => {
    const s = fromRemovedPage(p);
    return s.phase === 'page' ? removedNotice(s) : 'unavailable';
  };
  it('says "none" only when the whole list was read (COMPLETE)', () => {
    expect(notice(page([], COMPLETE))).toBe('files.removed.none');
    expect(notice(page([], MORE, true))).toBe('files.removed.noneYet');
    expect(notice(page([], RESUMED))).toBe('files.removed.noneFound');
    expect(notice(page([], INDEX_PARTIAL))).toBe('files.removed.noneFound');
  });
  it("rows are said to be possibly incomplete when the network can't vouch", () => {
    expect(notice(page([row('a')], COMPLETE))).toBeUndefined();
    expect(notice(page([row('a')], MORE, true))).toBeUndefined();
    expect(notice(page([row('a')], INDEX_PARTIAL))).toBe('files.list.indexPartial');
    expect(notice(page([row('a')], UNKNOWN))).toBe('files.removed.unconfirmed');
  });
});

import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import type { ListingState } from './folder-model.ts';
import { trailKeys, treeKey, treeView } from './tree-model.ts';

const folder = (n: string): FolderRef => ({
  kind: 'folder',
  directory: `0x${n.repeat(64)}` as `0x${string}`,
});
const folderRow = (name: string, target = folder('f')) =>
  ({ name, kind: 'folder', author: '0x', target }) as never;
const fileRow = (name: string) =>
  ({ name, kind: 'file', author: '0x', target: { kind: 'file', subject: '0x' } }) as never;
const page = (rows: unknown[], coverage: object, extra: object = {}): ListingState =>
  ({
    phase: 'page',
    folder: folder('a'),
    rows,
    hidden: 0,
    filtered: 0,
    coverage,
    more: { status: 'idle' },
    ...extra,
  }) as unknown as ListingState;
const COMPLETE = { state: 'COMPLETE' };

describe('treeView: a node says what it knows, never an empty node that may not be', () => {
  it('not read yet: it loads when opened (lazy)', () => {
    expect(treeView(undefined)).toEqual({ folders: [], tail: { kind: 'none' }, lazy: true });
    expect(treeView({ phase: 'loading' })).toMatchObject({ tail: { kind: 'loading' } });
  });
  it('lists folders only; a complete read with none is a leaf', () => {
    const v = treeView(page([folderRow('docs'), fileRow('a.txt')], COMPLETE));
    expect(v.folders.map((f) => f.name)).toEqual(['docs']);
    expect(v.tail).toEqual({ kind: 'none' });
    expect(treeView(page([fileRow('a.txt')], COMPLETE))).toEqual({
      folders: [],
      tail: { kind: 'none' },
      lazy: false,
      leaf: true,
    });
  });
  it('more to read says "more"; a failed continuation offers it again', () => {
    const next = { next: { v: 1 } };
    expect(treeView(page([], { state: 'PARTIAL', why: 'MORE_PAGES' }, next)).tail).toEqual({
      kind: 'more',
      loading: false,
    });
    expect(
      treeView(
        page([], { state: 'PARTIAL', why: 'MORE_PAGES' }, { ...next, more: { status: 'failed' } }),
      ).tail,
    ).toEqual({ kind: 'more-failed' });
  });
  it("a read the network can't vouch for says so, rows or not", () => {
    expect(treeView(page([], { state: 'PARTIAL', why: 'INDEX_PARTIAL' })).tail).toEqual({
      kind: 'partial',
    });
    expect(treeView(page([folderRow('x')], { state: 'UNKNOWN' })).tail).toEqual({
      kind: 'partial',
    });
    expect(treeView(page([], { state: 'PARTIAL', why: 'RESUMED' })).leaf).toBeUndefined();
  });
  it('a node that could not be listed offers Try again (UNKNOWN) or says why', () => {
    expect(treeView({ phase: 'unknown', reason: {} } as never).tail).toEqual({
      kind: 'failed',
      code: 'UNKNOWN',
    });
    expect(treeView({ phase: 'absent', reason: {} } as never).tail).toEqual({
      kind: 'failed',
      code: 'ABSENT_PROVEN',
    });
  });
});

describe('treeKey and trailKeys', () => {
  it('a node is keyed by the names from the root; the root is ""', () => {
    expect(treeKey([])).toBe('');
    expect(treeKey(['a', 'b'])).not.toBe(treeKey(['a/b']));
  });
  it("the trail's ancestors and itself, from the root; none for a folder opened by its link", () => {
    const steps = [
      { folder: folder('a'), name: 'docs' },
      { folder: folder('b'), name: 'notes' },
    ];
    expect(trailKeys(steps)).toEqual([treeKey([]), treeKey(['docs']), treeKey(['docs', 'notes'])]);
    expect(trailKeys([{ folder: folder('a'), name: '' }])).toBeUndefined();
  });
});

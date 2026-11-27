import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import type { ListingState } from './folder-model.ts';
import { linkedKey, trailKeys, treeKey, treeView } from './tree-model.ts';

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
  it("the trail's ancestors and itself, from the root", () => {
    const steps = [
      { folder: folder('a'), name: 'docs' },
      { folder: folder('b'), name: 'notes' },
    ];
    expect(trailKeys(steps)).toEqual([treeKey([]), treeKey(['docs']), treeKey(['docs', 'notes'])]);
  });
  it('a trail from a folder opened by its link starts at its own node, never at a root key', () => {
    const a = folder('a');
    const own = linkedKey(a.directory);
    expect(trailKeys([{ folder: a, name: '' }])).toEqual([own]);
    expect(
      trailKeys([
        { folder: a, name: '' },
        { folder: folder('b'), name: 'notes' },
      ]),
    ).toEqual([own, own + treeKey(['notes'])]);
    // Never the same key as a folder under the root, and the id's case doesn't matter.
    expect(own.startsWith('/')).toBe(false);
    expect(own).not.toBe('');
    expect(linkedKey(a.directory.toUpperCase())).toBe(own);
    // A name missing past the start: no keys.
    expect(
      trailKeys([
        { folder: a, name: 'x' },
        { folder: folder('b'), name: '' },
      ]),
    ).toBeUndefined();
  });
});

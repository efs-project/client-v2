import type { FolderRef, FolderRow } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import type { ListingState } from './folder-model.ts';
import { cannotMoveHere, cannotOpen, pickerNotice } from './picker-model.ts';

const folder = (n: string): FolderRef => ({
  kind: 'folder',
  directory: `0x${n.repeat(64)}` as `0x${string}`,
});
const row = (target: FolderRef): FolderRow =>
  ({ name: 'x', kind: 'folder', author: '0x', target }) as unknown as FolderRow;
const page = (rows: number, coverage: object, extra: object = {}): ListingState =>
  ({
    phase: 'page',
    folder: folder('a'),
    rows: Array.from({ length: rows }, () => row(folder('b'))),
    hidden: 0,
    filtered: 0,
    coverage,
    more: { status: 'idle' },
    ...extra,
  }) as unknown as ListingState;

describe('the folder picker', () => {
  it("can't open a folder being moved (any in the selection), so nothing inside one can be picked", () => {
    expect(cannotOpen(row(folder('b')), [folder('B')])).toBe('files.move.moving');
    expect(cannotOpen(row(folder('c')), [folder('b'), folder('C')])).toBe('files.move.moving');
    expect(cannotOpen(row(folder('c')), [folder('b')])).toBeUndefined();
    expect(cannotOpen(row(folder('b')), [])).toBeUndefined();
  });
  it("can't move an entry to the folder it's already in", () => {
    expect(cannotMoveHere(folder('a'), folder('A'))).toBe('files.move.same');
    expect(cannotMoveHere(folder('c'), folder('a'))).toBeUndefined();
  });
  it('an entry at an address can move into any folder: an address is never the same folder', () => {
    const home = { kind: 'home' as const, address: `0x${'ab'.repeat(20)}` as `0x${string}` };
    expect(cannotMoveHere(folder('a'), home)).toBeUndefined();
  });
  it('says "no folders in here" only for a complete read; otherwise as the listing does', () => {
    expect(pickerNotice(page(0, { state: 'COMPLETE' }))).toEqual({ id: 'files.move.noFolders' });
    expect(pickerNotice(page(0, { state: 'COMPLETE' }, { filtered: 3 }))).toEqual({
      id: 'files.move.noFolders',
    });
    expect(pickerNotice(page(0, { state: 'PARTIAL', why: 'RESUMED' }))).toEqual({
      id: 'files.list.noneFound',
    });
    expect(pickerNotice(page(1, { state: 'COMPLETE' }))).toBeUndefined();
  });
});

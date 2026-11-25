import type { SequenceProgress } from '@efs/sdk/actions';
import type { FolderRow } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import { pendingCreates, showsEffect, touchesFolder } from './listing-sync.ts';

const DIR = `0x${'d1'.repeat(32)}`;
const OTHER = `0x${'d2'.repeat(32)}`;
const ME = `0x${'0a'.repeat(32)}`;
const YOU = `0x${'0b'.repeat(32)}`;
const row = (name: string, author = ME) => ({ name, author }) as unknown as FolderRow;
const create = (name: string, folder = DIR) =>
  ({ kind: 'files.createFolder', folder, name, directory: '0x', subject: '0x' }) as never;
const remove = (name: string) =>
  ({ kind: 'files.remove', hide: false, entries: [{ folder: DIR, name, target: '0x' }] }) as never;
const move = (name: string, toFolder: string, toName: string) =>
  ({ kind: 'files.move', moves: [{ folder: DIR, name, toFolder, toName, target: '0x' }] }) as never;

describe('touchesFolder', () => {
  it('names the folder at either end of a move, case-insensitively', () => {
    expect(touchesFolder(create('a', DIR.toUpperCase()), DIR)).toBe(true);
    expect(touchesFolder(create('a', OTHER), DIR)).toBe(false);
    expect(touchesFolder(move('a', OTHER, 'b'), OTHER)).toBe(true);
    expect(touchesFolder({ kind: 'files.edit' } as never, DIR)).toBe(false);
    expect(touchesFolder(undefined, DIR)).toBe(false);
  });
});

describe('showsEffect: did the endpoint answer from after the save?', () => {
  it('a create shows once my entry is listed', () => {
    expect(showsEffect(create('new'), DIR, [], ME)).toBe(false);
    expect(showsEffect(create('new'), DIR, [row('new', YOU)], ME)).toBe(false);
    expect(showsEffect(create('new'), DIR, [row('new')], ME)).toBe(true);
  });
  it("a removal shows once my entry is gone (someone else's may show through)", () => {
    expect(showsEffect(remove('x'), DIR, [row('x')], ME)).toBe(false);
    expect(showsEffect(remove('x'), DIR, [row('x', YOU)], ME)).toBe(true);
    expect(showsEffect(remove('x'), DIR, [], ME)).toBe(true);
  });
  it("a rename in place shows once the new name is mine and the old one isn't", () => {
    const rename = move('a', DIR, 'b');
    expect(showsEffect(rename, DIR, [row('a')], ME)).toBe(false);
    expect(showsEffect(rename, DIR, [row('a'), row('b')], ME)).toBe(false);
    expect(showsEffect(rename, DIR, [row('b')], ME)).toBe(true);
  });
  it('effects elsewhere, or of an unknown kind, have nothing to wait for here', () => {
    expect(showsEffect(create('new', OTHER), DIR, [], ME)).toBe(true);
    expect(showsEffect({ kind: 'files.somethingNew' } as never, DIR, [], ME)).toBe(true);
  });
});

describe('pendingCreates', () => {
  const p = (effect: unknown, state = 'IN_FLIGHT') =>
    ({ sequenceId: `0x${'01'.repeat(32)}`, state, effect }) as unknown as SequenceProgress;
  const unsettled = (x: SequenceProgress) => x.state !== 'COMPLETE';
  it('lists names still being created here, once each, until the listing shows them', () => {
    const saves = [
      p(create('a')),
      p(create('a')),
      p(create('b', OTHER)),
      p(create('c'), 'COMPLETE'),
    ];
    expect(pendingCreates(saves, DIR, [], unsettled)).toEqual([{ name: 'a', kind: 'folder' }]);
    expect(pendingCreates(saves, DIR, [row('a')], unsettled)).toEqual([]);
  });
});

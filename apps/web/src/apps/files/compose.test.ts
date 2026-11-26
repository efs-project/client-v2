import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import { createComposer, newFileKey } from './compose.ts';

const folder = (n: string): FolderRef => ({
  kind: 'folder',
  directory: `0x${n.repeat(64)}` as `0x${string}`,
});
const REALM = { kind: 'alias', id: 'testnet' } as const;

describe('newFileKey: an unsaved new file, kept by its folder and name', () => {
  it('is per realm, folder (any case) and exact name, and never a route', () => {
    const a = newFileKey(REALM, folder('a'), 'notes.txt');
    expect(a).toBe(newFileKey(REALM, folder('A'), 'notes.txt'));
    expect(a).not.toBe(newFileKey(REALM, folder('a'), 'Notes.txt'));
    expect(a).not.toBe(newFileKey({ kind: 'alias', id: 'other' }, folder('a'), 'notes.txt'));
    expect(a.startsWith('#/')).toBe(false);
  });
});

describe('the composer', () => {
  it('holds one new file at a time, where it was started', () => {
    const c = createComposer();
    expect(c.current.get()).toBeUndefined();
    const f = {
      folder: folder('a'),
      key: '0xa',
      folderName: 'docs',
      name: 'n.txt',
      route: '~efs/o/0xa',
    };
    c.start(f);
    expect(c.current.get()).toEqual(f);
    c.end();
    expect(c.current.get()).toBeUndefined();
  });
});

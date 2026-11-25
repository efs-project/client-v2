import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import { createFolderNav, viewPath } from './navigation.ts';

const folder = (n: string): FolderRef => ({
  kind: 'folder',
  directory: `0x${n.repeat(64)}` as `0x${string}`,
});
const ROOT = folder('0');

describe('viewPath: the path to the folder on screen, for a folder restore or move', () => {
  it('is the trail of names from the root; empty at the root', () => {
    const nav = createFolderNav();
    expect(viewPath(nav.path.get(), ROOT)).toEqual({ from: ROOT, segments: [] });
    nav.open({ folder: folder('a'), name: 'docs' });
    nav.open({ folder: folder('b'), name: 'notes' });
    expect(viewPath(nav.path.get(), ROOT)).toEqual({ from: ROOT, segments: ['docs', 'notes'] });
    nav.back(1);
    expect(viewPath(nav.path.get(), ROOT)).toEqual({ from: ROOT, segments: ['docs'] });
  });

  it('is unknown for a folder opened by its link, and anything opened below it', () => {
    const nav = createFolderNav();
    nav.resetTo({ folder: folder('a'), name: '' });
    expect(viewPath(nav.path.get(), ROOT)).toBeUndefined();
    nav.open({ folder: folder('b'), name: 'notes' });
    expect(viewPath(nav.path.get(), ROOT)).toBeUndefined();
    nav.back(0);
    expect(viewPath(nav.path.get(), ROOT)).toEqual({ from: ROOT, segments: [] });
  });
});

describe('arrive: the trail follows the URL when it changes', () => {
  it('back along the trail to a folder on it; a folder off it starts its own; the root ends it', () => {
    const nav = createFolderNav();
    nav.open({ folder: folder('a'), name: 'docs' });
    nav.open({ folder: folder('b'), name: 'notes' });
    nav.arrive(folder('b'));
    expect(nav.path.get().map((s) => s.name)).toEqual(['docs', 'notes']);
    nav.arrive(folder('A'));
    expect(nav.path.get().map((s) => s.name)).toEqual(['docs']);
    nav.arrive(folder('c'));
    expect(nav.path.get()).toEqual([{ folder: folder('c'), name: '' }]);
    nav.arrive(undefined);
    expect(nav.path.get()).toEqual([]);
  });
});

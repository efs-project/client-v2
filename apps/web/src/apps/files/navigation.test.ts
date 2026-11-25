import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import { createFolderNav, parentKey, sameParent, viewPath } from './navigation.ts';

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

describe('goTo: a folder chosen in the tree', () => {
  it('sets the whole trail, and the URL arriving there changes nothing', () => {
    const nav = createFolderNav();
    const steps = [
      { folder: folder('a'), name: 'docs' },
      { folder: folder('b'), name: 'notes' },
    ];
    nav.goTo(steps);
    expect(nav.browsing.get()).toBe(true);
    expect(nav.path.get()).toEqual(steps);
    nav.arrive(folder('b'));
    expect(nav.path.get()).toEqual(steps);
  });
});

describe('base: a trail that starts at an address', () => {
  const home = { kind: 'home' as const, address: `0x${'ab'.repeat(20)}` as `0x${string}` };
  it('an address arrived at starts the trail there; folders below keep it; the root ends it', () => {
    const nav = createFolderNav();
    nav.open({ folder: folder('a'), name: 'docs' });
    nav.arriveHome(home);
    expect(nav.base.get()).toBe(home);
    expect(nav.path.get()).toEqual([]);
    expect(nav.browsing.get()).toBe(true);
    nav.open({ folder: folder('b'), name: 'photos' });
    expect(nav.base.get()).toBe(home);
    expect(viewPath(nav.path.get(), nav.base.get() ?? ROOT)).toEqual({
      from: home,
      segments: ['photos'],
    });
    nav.arrive(undefined);
    expect(nav.base.get()).toBeUndefined();
    expect(nav.path.get()).toEqual([]);
  });

  it('a path from an address sets both; a folder opened by its own link drops the address', () => {
    const nav = createFolderNav();
    nav.goTo([{ folder: folder('b'), name: 'photos' }], home);
    expect(nav.base.get()).toBe(home);
    nav.goTo([{ folder: folder('a'), name: 'docs' }]);
    expect(nav.base.get()).toBeUndefined();
    nav.goTo([], home);
    nav.arrive(folder('c'));
    expect(nav.base.get()).toBeUndefined();
    expect(nav.path.get()).toEqual([{ folder: folder('c'), name: '' }]);
  });

  it('the same place, by kind and id, whatever the case', () => {
    expect(sameParent(folder('a'), { ...folder('A') })).toBe(true);
    expect(sameParent(folder('a'), home)).toBe(false);
    const shouted = { ...home, address: home.address.toUpperCase() as `0x${string}` };
    expect(sameParent(home, shouted)).toBe(true);
    expect(parentKey(home)).toBe(`home:0x${'ab'.repeat(20)}`);
    expect(parentKey(folder('A'))).toBe(`0x${'a'.repeat(64)}`);
  });
});

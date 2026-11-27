import type { Efs, Lens } from '@efs/sdk';
import type { EntryLookup, FolderNamesResult, FolderRef } from '@efs/sdk/files';
import { describe, expect, it, vi } from 'vitest';
import {
  type DownReads,
  followsDown,
  rootSteps,
  type TrailReads,
  type TrailWalk,
  walkTrail,
} from './folder-trail.ts';

const id = (c: string) => `0x${c.repeat(64)}`;
const ROOT = id('0');
const ME = id('e');
const SOMEONE = id('5');
const CREATOR = id('c');
const efs = {} as Efs;
const lens = { principals: [] } as unknown as Lens;
const folder = (c: string): FolderRef => ({ kind: 'folder', directory: id(c) as never });

type Row = {
  name?: {
    text: string;
    author: string;
    parent: { kind: 'folder'; directory: string } | { kind: 'home'; address: string };
  };
  complete?: boolean;
  creator?: string | null;
};

/** folderNames answering from a table by folder id; anything else is UNKNOWN. */
function reads(table: Record<string, Row | 'unknown' | 'throw'>): TrailReads & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async folderNames(_efs, folders) {
      const f = folders[0]?.folder ?? '';
      asked.push(f);
      const row = table[f];
      if (row === 'throw') throw new Error('network');
      if (!row || row === 'unknown') {
        return {
          kind: 'efs.folderNames',
          status: 'UNKNOWN',
          reason: { code: 'BEHIND', retry: 'transient' },
          evidence: { attempts: [], requests: 0 },
        } as unknown as FolderNamesResult;
      }
      return {
        kind: 'efs.folderNames',
        status: 'PRESENT',
        rows: [
          {
            folder: f,
            name: row.name ?? null,
            creator: row.creator === undefined ? CREATOR : row.creator,
            complete: row.complete ?? true,
          },
        ],
        evidence: { attempts: [], requests: 0 },
      } as unknown as FolderNamesResult;
    },
  };
}

const inFolder = (text: string, c: string, author = ME) => ({
  name: { text, author, parent: { kind: 'folder' as const, directory: id(c) } },
});
const opts = (over: object = {}) => ({
  root: ROOT,
  reader: ME as never,
  lensFor: () => lens,
  signal: new AbortController().signal,
  ...over,
});
const names = (w: TrailWalk | undefined) => w?.folders.map((f) => f.name?.text ?? null);

describe('walkTrail: the path above a folder opened by its link', () => {
  it('reaches the root: topmost first, ending with the start; whose name and whether settled', async () => {
    const r = reads({
      [id('x')]: inFolder('Guides', 'a', SOMEONE),
      [id('a')]: { ...inFolder('Docs', '0'), complete: false },
    });
    const levels: (string | null)[][] = [];
    const walk = await walkTrail(
      r,
      efs,
      folder('x'),
      opts({ onLevel: (w: TrailWalk) => levels.push(names(w) ?? []) }),
    );
    expect(walk?.top).toEqual({ kind: 'root' });
    expect(names(walk)).toEqual(['Docs', 'Guides']);
    // The reader's own name needs no "named by"; another author's does. A partial scan isn't final.
    expect(walk?.folders[0]?.name).toEqual({ text: 'Docs', by: undefined, settled: false });
    expect(walk?.folders[1]?.name).toEqual({ text: 'Guides', by: SOMEONE, settled: true });
    // Each folder carries its creator, from the read.
    expect(walk?.folders[1]?.folder.owner).toBe(CREATOR);
    // The breadcrumb grows as each level is read.
    expect(levels).toEqual([['Guides']]);
    expect(r.asked).toEqual([id('x'), id('a')]);
  });

  it('with no reader, every name is someone else\'s ("named by")', async () => {
    const r = reads({ [id('x')]: inFolder('Guides', '0', ME) });
    const walk = await walkTrail(r, efs, folder('x'), opts({ reader: undefined }));
    expect(walk?.folders[0]?.name?.by).toBe(ME);
  });

  it('ends at an address (a home)', async () => {
    const r = reads({
      [id('x')]: {
        name: {
          text: 'Photos',
          author: ME,
          parent: { kind: 'home', address: `0x${'AB'.repeat(20)}` },
        },
      },
    });
    const walk = await walkTrail(r, efs, folder('x'), opts());
    expect(walk?.top).toEqual({ kind: 'home', address: `0x${'ab'.repeat(20)}` });
    expect(names(walk)).toEqual(['Photos']);
  });

  it('a folder nobody names: shown by its id, and what is above it is not known (never "none")', async () => {
    const r = reads({ [id('x')]: inFolder('Guides', 'a'), [id('a')]: {} });
    const walk = await walkTrail(r, efs, folder('x'), opts());
    expect(walk?.top).toEqual({ kind: 'unknown' });
    expect(names(walk)).toEqual([null, 'Guides']);
    expect(walk?.folders[0]?.folder.directory).toBe(id('a'));
  });

  it('a loop: a name sits in a folder already on the path, the start included', async () => {
    const loop = await walkTrail(
      reads({
        [id('x')]: inFolder('A', 'a'),
        [id('a')]: inFolder('B', 'b'),
        [id('b')]: inFolder('C', 'a'),
      }),
      efs,
      folder('x'),
      opts(),
    );
    expect(loop?.top).toEqual({ kind: 'loop' });
    expect(names(loop)).toEqual(['C', 'B', 'A']);
    const back = await walkTrail(
      reads({ [id('x')]: inFolder('A', 'a'), [id('a')]: inFolder('B', 'x') }),
      efs,
      folder('x'),
      opts(),
    );
    expect(back?.top).toEqual({ kind: 'loop' });
  });

  it('stops at the cap: deeper is not known, and nothing past it is read', async () => {
    const table: Record<string, Row> = {};
    const chain = 'xabcdefghij'.split('');
    chain.forEach((c, i) => {
      table[id(c)] = inFolder(`F${i}`, chain[i + 1] ?? '1');
    });
    const r = reads(table);
    const walk = await walkTrail(r, efs, folder('x'), opts({ max: 3 }));
    expect(walk?.top).toEqual({ kind: 'unknown' });
    expect(walk?.folders).toHaveLength(3);
    expect(r.asked).toHaveLength(3);
  });

  it("a read that couldn't be made: failed with its reason, never a stop that looks like an answer", async () => {
    const unknown = await walkTrail(
      reads({ [id('x')]: inFolder('Guides', 'a'), [id('a')]: 'unknown' }),
      efs,
      folder('x'),
      opts(),
    );
    expect(unknown?.top).toMatchObject({ kind: 'failed', reason: { code: 'BEHIND' } });
    expect(names(unknown)).toEqual([null, 'Guides']);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = await walkTrail(reads({ [id('x')]: 'throw' }), efs, folder('x'), opts());
    spy.mockRestore();
    expect(thrown?.top?.kind).toBe('failed');
    expect(names(thrown)).toEqual([null]);
  });

  it('an aborted walk resolves with nothing', async () => {
    const run = new AbortController();
    const r = reads({ [id('x')]: inFolder('Guides', 'a'), [id('a')]: inFolder('Docs', '0') });
    const slow: TrailReads = {
      async folderNames(e, f, o) {
        run.abort();
        return r.folderNames(e, f, o);
      },
    };
    expect(await walkTrail(slow, efs, folder('x'), opts({ signal: run.signal }))).toBeUndefined();
  });
});

describe('rootSteps and followsDown: a root trail only when the names lead back down', () => {
  const walk: TrailWalk = {
    folders: [
      { folder: folder('a'), name: { text: 'Docs', by: undefined, settled: true } },
      { folder: folder('x'), name: { text: 'Guides', by: SOMEONE as never, settled: true } },
    ],
    top: { kind: 'root' },
  };
  const root: FolderRef = { kind: 'folder', directory: ROOT as never, owner: CREATOR as never };

  /** lookupEntry answering by "parent/name" with the selected target's folder. */
  function down(
    table: Record<string, string | 'absent' | 'unknown'>,
  ): DownReads & { lenses: string[] } {
    const lenses: string[] = [];
    return {
      lenses,
      async lookupEntry(_efs, entry, o) {
        const parent = (entry.folder as FolderRef).directory;
        lenses.push(`${parent}|${(o.lens as unknown as { tag: string }).tag}`);
        const at = table[`${parent}/${entry.name}`];
        if (at === 'unknown')
          return {
            kind: 'efs.entry',
            status: 'UNKNOWN',
            reason: { code: 'BEHIND' },
          } as unknown as EntryLookup;
        if (!at || at === 'absent')
          return { kind: 'efs.entry', status: 'ABSENT_PROVEN' } as unknown as EntryLookup;
        return {
          kind: 'efs.entry',
          status: 'PRESENT',
          selected: { target: { kind: 'folder', directory: at } },
        } as unknown as EntryLookup;
      },
    };
  }
  const lensFor = (f: FolderRef) => ({ tag: f.directory.slice(2, 4) }) as unknown as Lens;
  const signal = new AbortController().signal;

  it('rootSteps: the names from the root, only for a walk that reached it named at each level', () => {
    expect(rootSteps(walk)?.map((s) => s.name)).toEqual(['Docs', 'Guides']);
    expect(rootSteps({ ...walk, top: { kind: 'unknown' } })).toBeUndefined();
    expect(
      rootSteps({ folders: [{ folder: folder('x'), name: undefined }], top: { kind: 'root' } }),
    ).toBeUndefined();
  });

  it("follows: each name, in its folder's place Lens, selects the walked folder", async () => {
    const steps = rootSteps(walk) ?? [];
    const d = down({ [`${ROOT}/Docs`]: id('a'), [`${id('a')}/Guides`]: id('x') });
    expect(await followsDown(d, efs, root, steps, lensFor, signal)).toBe('follows');
    // Each lookup is in its own folder's Lens, as the tree lists it.
    expect(d.lenses).toEqual([`${ROOT}|00`, `${id('a')}|aa`]);
  });

  it("elsewhere: another author's Guides under Docs wins the Lens's choice (PM, 2026-11-27)", async () => {
    const steps = rootSteps(walk) ?? [];
    const d = down({ [`${ROOT}/Docs`]: id('a'), [`${id('a')}/Guides`]: id('9') });
    expect(await followsDown(d, efs, root, steps, lensFor, signal)).toBe('elsewhere');
    expect(
      await followsDown(down({ [`${ROOT}/Docs`]: 'absent' }), efs, root, steps, lensFor, signal),
    ).toBe('elsewhere');
  });

  it("a lookup that couldn't be made is failed, not elsewhere", async () => {
    const steps = rootSteps(walk) ?? [];
    const d = down({ [`${ROOT}/Docs`]: 'unknown' });
    expect(await followsDown(d, efs, root, steps, lensFor, signal)).toEqual({
      failed: { code: 'BEHIND' },
    });
  });
});

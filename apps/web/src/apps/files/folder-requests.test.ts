import type { Efs, Lens } from '@efs/sdk';
import type { EfsWriter } from '@efs/sdk/actions';
import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it, vi } from 'vitest';
import { saveHold } from '../../shell/save-hold.ts';
import {
  type FolderPlanners,
  folderHold,
  nameRuleMessage,
  placesOf,
  planRequest,
  refusalMessage,
  withoutIndices,
} from './folder-requests.ts';

const DIR = `0x${'D1'.repeat(32)}`;
const folder = { kind: 'folder', directory: DIR } as FolderRef;
const efs = {} as Efs;
const writer = {} as EfsWriter;
const lens = { principals: [] } as unknown as Lens;
const signal = new AbortController().signal;

describe('placesOf', () => {
  it('lower-cases the folder id and keeps the name exactly', () => {
    expect(placesOf({ kind: 'createFolder', folder, name: 'Notes' })).toEqual([
      { folder: DIR.toLowerCase(), name: 'Notes' },
    ]);
  });
  it('a rename holds its old name and its new one', () => {
    expect(
      placesOf({ kind: 'rename', from: { folder, name: 'a.txt' }, to: 'b.txt' })?.map(
        (p) => p.name,
      ),
    ).toEqual(['a.txt', 'b.txt']);
  });
  it('an upload holds the name it creates', () => {
    expect(
      placesOf({
        kind: 'createFile',
        folder,
        name: 'pic.png',
        content: new Uint8Array(1),
        mediaType: 'image/png',
      }),
    ).toEqual([{ folder: DIR.toLowerCase(), name: 'pic.png' }]);
  });
  it('a move holds each old place and the same name at the new folder', () => {
    const to = { kind: 'folder', directory: `0x${'E2'.repeat(32)}` } as FolderRef;
    expect(
      placesOf({
        kind: 'move',
        moves: [
          { from: { folder, name: 'a.txt' }, isFolder: false },
          { from: { folder, name: 'b' }, isFolder: true },
        ],
        to,
      }),
    ).toEqual([
      { folder: DIR.toLowerCase(), name: 'a.txt' },
      { folder: to.directory.toLowerCase(), name: 'a.txt' },
      { folder: DIR.toLowerCase(), name: 'b' },
      { folder: to.directory.toLowerCase(), name: 'b' },
    ]);
  });
  it('a parent that is an address has no key yet: the places are undefined (held fail-closed)', () => {
    const home = { kind: 'home' as const, address: `0x${'ab'.repeat(20)}` as never };
    expect(placesOf({ kind: 'remove', entries: [{ folder: home, name: 'a' }], hide: false })).toBe(
      undefined,
    );
    expect(placesOf({ kind: 'createFolder', folder, name: 'x' })).toHaveLength(1);
  });
  it('remove and restore hold every entry they name', () => {
    const entries = [
      { folder, name: 'a' },
      { folder, name: 'b' },
    ];
    expect(placesOf({ kind: 'remove', entries, hide: false })).toHaveLength(2);
    expect(placesOf({ kind: 'restore', entries })).toHaveLength(2);
    // A tag is a statement at a tag (or an address), never a folder entry: it holds no name.
    expect(placesOf({ kind: 'tag', place: ['cars'], targets: [], stance: 'tag' })).toEqual([]);
    expect(placesOf({ kind: 'unhide', entries })).toEqual([
      { folder: folder.directory.toLowerCase(), name: 'a' },
      { folder: folder.directory.toLowerCase(), name: 'b' },
    ]);
  });
});

describe('planRequest', () => {
  const planners = () => ({
    planCreateFile: vi.fn(async () => ({ status: 'PLANNED' })),
    planCreateFolder: vi.fn(async () => ({ status: 'PLANNED' })),
    planMoveEntries: vi.fn(async () => ({ status: 'PLANNED' })),
    planRemoveEntries: vi.fn(async () => ({ status: 'PLANNED' })),
    planRestoreEntries: vi.fn(async () => ({ status: 'PLANNED' })),
    planUnhideEntries: vi.fn(async () => ({ status: 'PLANNED' })),
    planTag: vi.fn(async () => ({ status: 'PLANNED' })),
    planDeny: vi.fn(async () => ({ status: 'PLANNED' })),
    planUntag: vi.fn(async () => ({ status: 'PLANNED' })),
  });

  it('a tag goes to planTag, "Not this" to planDeny, Remove my tag to planUntag; no Lens decides it', async () => {
    const p = planners();
    const targets = [{ kind: 'file' as const, subject: `0x${'5a'.repeat(32)}` as never }];
    const place = ['cars', 'tesla'];
    const run = (stance: 'tag' | 'deny' | 'untag', number?: number) =>
      planRequest(
        p as unknown as FolderPlanners,
        efs,
        writer,
        { kind: 'tag', place, targets, stance, ...(number !== undefined ? { number } : {}) },
        lens,
        signal,
      );
    await run('tag');
    expect((p.planTag.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({
      topic: place,
      targets,
    });
    await run('deny');
    expect((p.planDeny.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({
      topic: place,
      targets,
    });
    await run('tag', 7);
    expect((p.planTag.mock.calls[1] as unknown[] | undefined)?.[2]).toEqual({
      topic: place,
      targets,
      number: 7,
    });
    // Remove my tag carries no number: it returns to saying nothing.
    await run('untag', 3);
    expect((p.planUntag.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({
      topic: place,
      targets,
    });
    expect(p.planRemoveEntries).not.toHaveBeenCalled();
  });

  it("Unblock releases the person's own blocks through planUnhideEntries, in the view's Lens", async () => {
    const p = planners();
    const entries = [{ folder, name: 'a' }];
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      { kind: 'unhide', entries },
      lens,
      signal,
    );
    expect((p.planUnhideEntries.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({
      entries,
      lens,
    });
    expect(p.planRestoreEntries).not.toHaveBeenCalled();
  });

  it("a rename is a move with only a new name, in the view's Lens", async () => {
    const p = planners();
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      {
        kind: 'rename',
        from: { folder, name: 'a.txt' },
        to: 'b.txt',
      },
      lens,
      signal,
    );
    expect(p.planMoveEntries).toHaveBeenCalledWith(
      efs,
      writer,
      { moves: [{ from: { folder, name: 'a.txt' }, to: { name: 'b.txt' } }], lens },
      { signal },
    );
  });

  it("an upload plans a new file with its bytes and media type, in the view's Lens", async () => {
    const p = planners();
    const content = new Uint8Array([1, 2, 3]);
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      { kind: 'createFile', folder, name: 'x.bin', content, mediaType: '' },
      lens,
      signal,
    );
    expect(p.planCreateFile).toHaveBeenCalledWith(
      efs,
      writer,
      { folder, name: 'x.bin', content, mediaType: '', lens },
      { signal },
    );
  });

  it('a move is one plan for the whole selection; via goes with the folders only', async () => {
    const p = planners();
    const to = { kind: 'folder', directory: `0x${'E2'.repeat(32)}` } as FolderRef;
    const via = { from: folder, segments: ['team', 'plans'] };
    const a = { folder, name: 'a' };
    const b = { folder, name: 'b' };
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      {
        kind: 'move',
        moves: [
          { from: a, isFolder: false },
          { from: b, isFolder: true },
        ],
        to,
        via,
      },
      lens,
      signal,
    );
    expect(p.planMoveEntries).toHaveBeenCalledTimes(1);
    expect((p.planMoveEntries.mock.calls[0] as unknown[])[2]).toEqual({
      moves: [
        { from: a, to: { folder: to } },
        { from: b, to: { folder: to, via } },
      ],
      lens,
    });
  });

  it('remove releases unless asked to hide; hide is passed only when true', async () => {
    const p = planners();
    const entries = [{ folder, name: 'a' }];
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      { kind: 'remove', entries, hide: false },
      lens,
      signal,
    );
    expect((p.planRemoveEntries.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({
      entries,
      lens,
    });
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      { kind: 'remove', entries, hide: true },
      lens,
      signal,
    );
    expect((p.planRemoveEntries.mock.calls[1] as unknown[] | undefined)?.[2]).toEqual({
      entries,
      hide: true,
      lens,
    });
  });
});

describe('withoutIndices: "Leave these out and review the rest"', () => {
  const entries = [
    { folder, name: 'a' },
    { folder, name: 'b' },
    { folder, name: 'c' },
  ];
  it('drops the refused items by their index, keeping the rest in order', () => {
    expect(withoutIndices({ kind: 'remove', entries, hide: false }, [0, 2])).toEqual({
      kind: 'remove',
      entries: [{ folder, name: 'b' }],
      hide: false,
    });
    const to = { kind: 'folder', directory: `0x${'E2'.repeat(32)}` } as FolderRef;
    const moves = entries.map((from) => ({ from, isFolder: false }));
    expect(withoutIndices({ kind: 'move', moves, to }, [1])).toEqual({
      kind: 'move',
      moves: [moves[0], moves[2]],
      to,
    });
  });
  it('drops refused tag targets, keeping the rest in order', () => {
    const targets = ['1', '2', '3'].map((n) => ({
      kind: 'file' as const,
      subject: `0x${n.repeat(64)}` as never,
    }));
    expect(withoutIndices({ kind: 'tag', place: ['cars'], targets, stance: 'tag' }, [1])).toEqual({
      kind: 'tag',
      place: ['cars'],
      targets: [targets[0], targets[2]],
      stance: 'tag',
    });
  });
  it('drops refused unblocks too', () => {
    expect(withoutIndices({ kind: 'unhide', entries }, [1])).toEqual({
      kind: 'unhide',
      entries: [entries[0], entries[2]],
    });
  });
  it('nothing left, or a request that is not a selection: nothing to review', () => {
    expect(withoutIndices({ kind: 'remove', entries, hide: false }, [0, 1, 2])).toBeUndefined();
    expect(withoutIndices({ kind: 'createFolder', folder, name: 'x' }, [0])).toBeUndefined();
  });
});

describe('copy', () => {
  it('each refusal code has its own words; an unknown code is shown raw', () => {
    expect(refusalMessage('NAME_TAKEN_MINE')).toBe('files.name.takenMine');
    expect(refusalMessage('PATH_CHANGED')).toBe('files.refused.pathChanged');
    expect(refusalMessage('NOT_REMOVED')).toBe('files.refused.notRemoved');
    // The tag release's restore and unhide refusals.
    expect(refusalMessage('NEVER_BOUND')).toBe('files.refused.neverBound');
    expect(refusalMessage('HISTORY_UNKNOWN')).toBe('files.refused.historyUnknown');
    expect(refusalMessage('NOT_HIDDEN')).toBe('files.refused.notHidden');
    // The tag planners' refusals.
    expect(refusalMessage('TARGET_ABSENT')).toBe('files.refused.targetAbsent');
    expect(refusalMessage('UNCHANGED')).toBe('files.refused.tagUnchanged');
    expect(refusalMessage('NOT_STATED')).toBe('files.refused.notStated');
    expect(refusalMessage('SOMETHING_NEW')).toBe('files.refused.unknown');
    expect(refusalMessage('toString')).toBe('files.refused.unknown');
  });
  it('each checkName rule maps to a message', () => {
    expect(nameRuleMessage('trailing-whitespace')).toBe('files.name.rule.space');
    expect(nameRuleMessage('too-long')).toBe('files.name.rule.tooLong');
    expect(nameRuleMessage('reserved-prefix')).toBe('files.name.rule.reserved');
  });
});

describe('folderHold: the send rule', () => {
  const A = `0x${'aa'.repeat(20)}`;
  const B = `0x${'bb'.repeat(20)}`;
  const places = [{ folder: DIR.toLowerCase(), name: 'x' }];
  const unsettledAt = (account: string, name: string) =>
    ({
      sequenceId: `0x${'01'.repeat(32)}`,
      account,
      state: 'PARTIAL',
      total: 2,
      committed: 1,
      effect: { kind: 'files.create', folder: DIR, name, file: '0x', revision: '0x' },
    }) as never;
  const base = {
    availability: { status: 'READY', account: A } as const,
    signer: A,
    unconfirmed: [],
    saves: [],
    places,
  };

  it("holds on the signer: a wallet switched to another account can never send A's plan", () => {
    // A has an unsettled save at x; the wallet now shows B; the plan was made for (and signs as) A.
    const r = folderHold(
      { ...base, availability: { status: 'READY', account: B }, saves: [unsettledAt(A, 'x')] },
      saveHold,
    );
    expect(r.hold).toEqual({ kind: 'account', signer: A, connected: B });
  });

  it('checks the unconfirmed pause first, before the wallet', () => {
    const r = folderHold(
      { ...base, availability: { status: 'NO_WALLET' }, unconfirmed: [{ places }] },
      saveHold,
    );
    expect(r.hold).toEqual({ kind: 'paused' });
    expect(folderHold({ ...base, unconfirmed: [{}] }, saveHold).hold).toEqual({ kind: 'paused' });
    // An unconfirmed edit of a file doesn't pause a folder save.
    expect(folderHold({ ...base, unconfirmed: [{ file: '0x01' }] }, saveHold).hold).toBeUndefined();
  });

  it('places that cannot be keyed are held fail-closed: by any unconfirmed or unsettled save', () => {
    const unknown = { ...base, places: undefined };
    expect(folderHold(unknown, saveHold).hold).toBeUndefined();
    expect(folderHold({ ...unknown, unconfirmed: [{ file: '0x01' }] }, saveHold).hold).toEqual({
      kind: 'paused',
    });
    expect(folderHold({ ...unknown, saves: [unsettledAt(A, 'y')] }, saveHold).hold).toEqual({
      kind: 'held',
    });
  });

  it('needs a READY wallet', () => {
    expect(folderHold({ ...base, availability: { status: 'NO_WALLET' } }, saveHold).hold).toEqual({
      kind: 'wallet',
    });
  });

  it("holds per (folder, name) on the signer's saves only", () => {
    expect(folderHold({ ...base, saves: [unsettledAt(A, 'x')] }, saveHold).hold).toEqual({
      kind: 'held',
    });
    expect(folderHold({ ...base, saves: [unsettledAt(A, 'y')] }, saveHold).hold).toBeUndefined();
    expect(folderHold({ ...base, saves: [unsettledAt(B, 'x')] }, saveHold).hold).toBeUndefined();
  });
});

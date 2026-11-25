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
      placesOf({ kind: 'rename', from: { folder, name: 'a.txt' }, to: 'b.txt' }).map((p) => p.name),
    ).toEqual(['a.txt', 'b.txt']);
  });
  it('a move holds its old place and the same name at its new folder', () => {
    const to = { kind: 'folder', directory: `0x${'E2'.repeat(32)}` } as FolderRef;
    expect(placesOf({ kind: 'move', from: { folder, name: 'a.txt' }, to })).toEqual([
      { folder: DIR.toLowerCase(), name: 'a.txt' },
      { folder: to.directory.toLowerCase(), name: 'a.txt' },
    ]);
  });
  it('remove and restore hold every entry they name', () => {
    const entries = [
      { folder, name: 'a' },
      { folder, name: 'b' },
    ];
    expect(placesOf({ kind: 'remove', entries, hide: false })).toHaveLength(2);
    expect(placesOf({ kind: 'restore', entries })).toHaveLength(2);
  });
});

describe('planRequest', () => {
  const planners = () => ({
    planCreateFolder: vi.fn(async () => ({ status: 'PLANNED' })),
    planMoveEntries: vi.fn(async () => ({ status: 'PLANNED' })),
    planRemoveEntries: vi.fn(async () => ({ status: 'PLANNED' })),
    planRestoreEntries: vi.fn(async () => ({ status: 'PLANNED' })),
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

  it('a move names the destination folder; via only when given (a folder move)', async () => {
    const p = planners();
    const to = { kind: 'folder', directory: `0x${'E2'.repeat(32)}` } as FolderRef;
    const via = { from: folder, segments: ['team', 'plans'] };
    const from = { folder, name: 'a' };
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      { kind: 'move', from, to },
      lens,
      signal,
    );
    await planRequest(
      p as unknown as FolderPlanners,
      efs,
      writer,
      { kind: 'move', from, to, via },
      lens,
      signal,
    );
    expect(p.planMoveEntries.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      { moves: [{ from, to: { folder: to } }], lens },
      { moves: [{ from, to: { folder: to, via } }], lens },
    ]);
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

describe('copy', () => {
  it('each refusal code has its own words; an unknown code is shown raw', () => {
    expect(refusalMessage('NAME_TAKEN_MINE')).toBe('files.name.takenMine');
    expect(refusalMessage('PATH_CHANGED')).toBe('files.refused.pathChanged');
    expect(refusalMessage('NOT_REMOVED')).toBe('files.refused.notRemoved');
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

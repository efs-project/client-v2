import type { Efs, Lens } from '@efs/sdk';
import type { EfsWriter } from '@efs/sdk/actions';
import type { FolderRef } from '@efs/sdk/files';
import { describe, expect, it, vi } from 'vitest';
import {
  type FolderPlanners,
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

import type { Efs } from '@efs/sdk';
import type { FolderRef } from '@efs/sdk/files';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScope, type OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { state } from '../../state/signals.ts';
import { trailState } from './folder-trail-state.ts';
import { createFolderNav } from './navigation.ts';

const id = (c: string) => `0x${c.repeat(64)}`;
const ROOT = id('0');
const X = id('a');

/** The SDK reads the walk loads lazily, answered by each test. */
const sdk = vi.hoisted(() => ({
  folderNames: vi.fn(),
  lookupEntry: vi.fn(),
}));
vi.mock('@efs/sdk/files', () => sdk);

const behind = {
  kind: 'efs.folderNames',
  status: 'UNKNOWN',
  reason: { code: 'BEHIND', retry: 'transient' },
  evidence: { attempts: [], requests: 0 },
};
const named = {
  kind: 'efs.folderNames',
  status: 'PRESENT',
  rows: [
    {
      folder: X,
      name: { text: 'Guides', author: id('5'), parent: { kind: 'folder', directory: ROOT } },
      creator: id('5'),
      complete: true,
    },
  ],
  evidence: { attempts: [], requests: 0 },
};
const selected = {
  kind: 'efs.entry',
  status: 'PRESENT',
  selected: { target: { kind: 'folder', directory: X } },
};

/**
 * An Efs with the parts the walk touches, and the catch-up listeners it was given. `caughtUp`
 * fires them as the SDK does: each once (one-shot), then forgotten.
 */
function fakeEfs() {
  const listeners: (() => void)[] = [];
  const caughtUp = () => {
    for (const l of listeners.splice(0)) l();
  };
  const lens = { principals: [] };
  const efs = {
    deployment: { root: { directoryRecordId: ROOT, principalId: id('1') } },
    lens: { default: lens, place: () => lens, principalOf: (a: string) => a },
    onCaughtUp(listener: () => void) {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
  } as unknown as Efs;
  return { efs, listeners, caughtUp };
}

function fakeHost(efs: Efs): AppHost {
  return {
    reader: state({ status: 'PINNED', efs, pin: { status: 'VERIFIED' } }),
    saving: { availability: state({ status: 'OFF' }), saves: state([]) },
  } as unknown as AppHost;
}

const folder: FolderRef = { kind: 'folder', directory: X as never };

describe('trailState: a link-opened folder walks once, and a BEHIND walk once more on catch-up', () => {
  let scope: OwnerScope;
  beforeEach(() => {
    scope = createScope();
    sdk.folderNames.mockReset();
    sdk.lookupEntry.mockReset();
  });
  afterEach(() => scope.dispose());

  it('a walk that reaches the root and leads back down becomes the trail from the root', async () => {
    sdk.folderNames.mockResolvedValue(named);
    sdk.lookupEntry.mockResolvedValue(selected);
    const { efs } = fakeEfs();
    const nav = createFolderNav();
    trailState(fakeHost(efs), nav, scope);
    nav.resetTo({ folder, name: '' });
    await vi.waitFor(() => expect(nav.path.get()[0]?.name).toBe('Guides'));
    expect(nav.path.get()[0]?.named).toEqual({ text: 'Guides', by: id('5'), settled: true });
  });

  it('BEHIND: waits for the catch-up, walks once more by itself, and never twice on its own', async () => {
    sdk.folderNames.mockResolvedValue(behind);
    const { efs, listeners, caughtUp } = fakeEfs();
    const nav = createFolderNav();
    const trail = trailState(fakeHost(efs), nav, scope);
    nav.resetTo({ folder, name: '' });
    await vi.waitFor(() => expect(trail.shown.get()?.walk.top?.kind).toBe('failed'));
    expect(listeners).toHaveLength(1);
    expect(sdk.folderNames).toHaveBeenCalledTimes(1);

    // Still behind when the catch-up fires: one walk by itself, then no more waiting.
    caughtUp();
    await vi.waitFor(() => expect(sdk.folderNames).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(trail.shown.get()?.walk.top?.kind).toBe('failed'));
    expect(listeners).toHaveLength(0);

    // Try again (the person) restores the allowance: BEHIND again waits again; then it catches up.
    trail.retry();
    await vi.waitFor(() => expect(sdk.folderNames).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(listeners).toHaveLength(1));
    sdk.folderNames.mockResolvedValue(named);
    sdk.lookupEntry.mockResolvedValue(selected);
    caughtUp();
    await vi.waitFor(() => expect(nav.path.get()[0]?.name).toBe('Guides'));
  });

  it('leaving the folder drops the wait', async () => {
    sdk.folderNames.mockResolvedValue(behind);
    const { efs, listeners } = fakeEfs();
    const nav = createFolderNav();
    trailState(fakeHost(efs), nav, scope);
    nav.resetTo({ folder, name: '' });
    await vi.waitFor(() => expect(listeners).toHaveLength(1));
    nav.back(0);
    await vi.waitFor(() => expect(listeners).toHaveLength(0));
  });
});

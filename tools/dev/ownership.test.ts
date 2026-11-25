import { describe, expect, it } from 'vitest';
import { DEV_SCRIPT, isSameProcess, processFacts } from './ownership.ts';

const recorded = { pid: 4242, startTime: 'Tue Nov 25 05:18:35 2026' };
const ours = { startTime: 'Tue Nov 25 05:18:35 2026', command: `node ${DEV_SCRIPT} start` };

describe('isSameProcess', () => {
  it('is ours only when both the start time and the dev command match', () => {
    expect(isSameProcess(recorded, ours)).toBe(true);
  });

  it('a reused pid (another start time) is not ours, even running the same dev command', () => {
    // Another worktree's `pnpm dev` that happens to get the recorded pid.
    expect(isSameProcess(recorded, { ...ours, startTime: 'Tue Nov 25 06:02:11 2026' })).toBe(false);
  });

  it('another program with the recorded start time is not ours', () => {
    expect(isSameProcess(recorded, { ...ours, command: 'anvil --port 8588' })).toBe(false);
  });

  it('a dead pid, or a record without a start time, is never ours', () => {
    expect(isSameProcess(recorded, undefined)).toBe(false);
    expect(isSameProcess({ ...recorded, startTime: '' }, ours)).toBe(false);
  });

  it('reads the facts of a live process, and nothing for a dead one', () => {
    const me = processFacts(process.pid);
    expect(me?.startTime).toMatch(/\d{4}$/);
    expect(me?.command.length).toBeGreaterThan(0);
    expect(processFacts(2 ** 22 + 12345)).toBeUndefined();
  });
});

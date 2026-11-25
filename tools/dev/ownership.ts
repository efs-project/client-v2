// Whether a recorded pid is still this worktree's `pnpm dev`, before anything signals it. A pid
// can be reused, and every worktree's dev process runs the same relative command, so the command
// alone proves nothing: the process's start time must match the one recorded when it started.
// (The same pid + start time + command rule the fixture's `down` uses.)

import { execFileSync } from 'node:child_process';

/** What `ps` says about a running process. */
export interface ProcessFacts {
  /** `ps -o lstart=`: when the process started, to the second. */
  readonly startTime: string;
  readonly command: string;
}

/** What `pnpm dev` recorded about itself in state.json. */
export interface RecordedProcess {
  readonly pid: number;
  readonly startTime: string;
}

/** The dev command's script, as it appears in the process's command line. */
export const DEV_SCRIPT = 'tools/dev/dev.ts';

/** The facts for a live pid, or undefined when it isn't running (or ps can't say). */
export function processFacts(pid: number): ProcessFacts | undefined {
  try {
    process.kill(pid, 0);
  } catch {
    return undefined;
  }
  try {
    const ps = (field: string) =>
      execFileSync('ps', ['-p', String(pid), '-o', `${field}=`], { encoding: 'utf8' }).trim();
    const startTime = ps('lstart');
    const command = ps('command');
    return startTime && command ? { startTime, command } : undefined;
  } catch {
    return undefined;
  }
}

/** Both must hold: the same start time (not a reused pid) and the dev command. */
export function isSameProcess(recorded: RecordedProcess, facts: ProcessFacts | undefined): boolean {
  return (
    facts !== undefined &&
    recorded.startTime.trim() !== '' &&
    facts.startTime.trim() === recorded.startTime.trim() &&
    facts.command.includes(DEV_SCRIPT)
  );
}

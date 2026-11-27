// A tag dialog's path field reads 300 ms after typing (a debounced lookup), so a test that types
// into it and moves on races that read: a replay then misses it on a slow run (CI 45944700804,
// PM 2026-11-27). Every fill goes through tests/e2e/tag-path.ts's fillTagPath, which waits for the
// picker; no other test file names the field's selector, so a new test can't type into it raw.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../build/paths.ts';

/** The debounced inputs, by the selector a test would reach them with. */
const DEBOUNCED = /efs-tag-path/;

describe('e2e fills of debounced inputs go through their helper', () => {
  it('no test file outside tests/e2e/tag-path.ts names the tag path field', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'tests/e2e'],
      { cwd: ROOT },
    )
      .toString()
      .split('\0')
      .filter((f) => f.endsWith('.ts') && f !== 'tests/e2e/tag-path.ts');
    const found: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(`${ROOT}${file}`, 'utf8');
      } catch {
        continue;
      }
      for (const [i, line] of text.split('\n').entries()) {
        if (DEBOUNCED.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(found).toEqual([]);
  });
});

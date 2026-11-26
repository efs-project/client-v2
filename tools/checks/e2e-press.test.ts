// Every e2e click goes through press() (tests/e2e/press.ts, PM 2026-11-26): Playwright counts a
// disabled or loading wa-button as enabled and clicks it, and the button drops the click, so a
// raw click can pass a test for the wrong reason. A test that must press a disabled button on
// purpose (a person's second press) clicks raw on a line marked `press-raw:` with the reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../build/paths.ts';

const RAW_CLICK =
  /\.(click|dblclick|tap)\(|\bmouse\.(click|dblclick)\(|dispatchEvent\(\s*['"`]click/;

describe('e2e clicks go through press()', () => {
  it('no raw click in tests/e2e outside press.ts, unless marked press-raw:', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'tests/e2e'],
      { cwd: ROOT },
    )
      .toString()
      .split('\0')
      .filter((f) => f.endsWith('.ts') && f !== 'tests/e2e/press.ts');
    const found: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(`${ROOT}${file}`, 'utf8');
      } catch {
        continue;
      }
      for (const [i, line] of text.split('\n').entries()) {
        if (RAW_CLICK.test(line) && !line.includes('press-raw:')) {
          found.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

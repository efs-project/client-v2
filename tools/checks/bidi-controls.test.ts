// No raw bidi control in any tracked text file (PM, 2026-11-26). A raw override or isolate makes
// code read differently from what runs ("Trojan Source", CVE-2021-42574), and review tools flag it.
// Tests and generated catalogues write them as \u escapes instead. This also catches the next
// time a tool decodes an escape into the raw character.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../build/paths.ts';

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
/** Not text: never read. */
const BINARY = /\.(tgz|png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|pdf|zip|wasm|mp3|mp4|webm)$/i;

describe('no raw bidi controls in the repository text files (tracked or new)', () => {
  it('every text file writes U+202A–202E, U+2066–2069, U+200E/F and U+061C as \\u escapes', () => {
    // Tracked files and new ones not yet added (not ignored): a new file is checked before its
    // first commit, not after (this file was, once, by its own rule).
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: ROOT,
      },
    )
      .toString()
      .split('\0')
      .filter((f) => f !== '' && !BINARY.test(f));
    const found: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(`${ROOT}${file}`, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (const [i, line] of lines.entries()) {
        const m = BIDI_CONTROLS.exec(line);
        if (m) {
          const cp = (m[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
          found.push(`${file}:${i + 1}: U+${cp}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

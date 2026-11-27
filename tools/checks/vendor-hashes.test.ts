// Every vendored tarball is the one vendor/README.md records (PM, 2026-11-27). Until the EFS SDK has
// a public release, vendor/ holds its packed tarballs, and the README's table says where each came
// from and its sha256. This check replaces hashing them by hand at every pin:
// - every vendor/*.tgz has a row, and its sha256 is the row's;
// - every row names a tarball that is there;
// - the lockfile's integrity for each vendored tarball is that file's own sha512.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../build/paths.ts';

const VENDOR = `${ROOT}vendor/`;

/**
 * The README table's rows, file → sha256: a row's first cell names the tarball (`` `x.tgz` ``) and
 * its last cell holds the hash (`` `<64 hex>` ``). A row naming a tarball with no hash maps to ''.
 */
export function tableOf(readme: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of readme.split('\n')) {
    const file = /^\|\s*`([^`]+\.tgz)`\s*\|/.exec(line)?.[1];
    if (!file) continue;
    const hash = /\|\s*`([0-9a-f]{64})`\s*\|\s*$/.exec(line)?.[1];
    rows.set(file, hash ?? '');
  }
  return rows;
}

/** The lockfile's integrity for each `file:vendor/…` tarball, file → sha512 (base64, prefixed). */
export function lockedOf(lock: string): Map<string, string> {
  const locked = new Map<string, string>();
  const re = /integrity: (sha512-[A-Za-z0-9+/=]+), tarball: file:vendor\/([^}\s,]+)/g;
  for (const m of lock.matchAll(re)) locked.set(m[2] as string, m[1] as string);
  return locked;
}

const digest = (bytes: Buffer, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64') =>
  createHash(algorithm).update(bytes).digest(encoding);

describe('the table and the lockfile readers', () => {
  it('reads a row by its first and last cells, and a row with no hash as empty', () => {
    const hash = 'ab'.repeat(32);
    const rows = tableOf(
      [
        '| File | Source | sha256 |',
        '|---|---|---|',
        `| \`a-1.tgz\` | from \`x\`, with \`code\` | \`${hash}\` |`,
        '| `b-2.tgz` | no hash here | n/a |',
        '| plain | not a tarball | x |',
      ].join('\n'),
    );
    expect([...rows]).toEqual([
      ['a-1.tgz', hash],
      ['b-2.tgz', ''],
    ]);
    expect([
      ...lockedOf(
        "  '@x/y@file:vendor/a-1.tgz':\n    resolution: {integrity: sha512-AB+/cd==, tarball: file:vendor/a-1.tgz}",
      ),
    ]).toEqual([['a-1.tgz', 'sha512-AB+/cd==']]);
  });
});

describe('vendor/: every tarball is the one the README records', () => {
  const table = tableOf(readFileSync(`${VENDOR}README.md`, 'utf8'));
  const tarballs = readdirSync(VENDOR).filter((f) => f.endsWith('.tgz'));
  const locked = lockedOf(readFileSync(`${ROOT}pnpm-lock.yaml`, 'utf8'));

  it('has at least one tarball and one row (the check is reading something)', () => {
    expect(tarballs.length).toBeGreaterThan(0);
    expect(table.size).toBeGreaterThan(0);
  });

  it("every vendor/*.tgz has a row, and its sha256 is the row's", () => {
    const wrong = tarballs.flatMap((file) => {
      const recorded = table.get(file);
      if (recorded === undefined) return [`${file}: no row in vendor/README.md`];
      if (recorded === '') return [`${file}: its row has no sha256`];
      const actual = digest(readFileSync(`${VENDOR}${file}`), 'sha256', 'hex');
      return actual === recorded ? [] : [`${file}: sha256 ${actual}, the README says ${recorded}`];
    });
    expect(wrong).toEqual([]);
  });

  it('every row names a tarball that is in vendor/', () => {
    expect([...table.keys()].filter((file) => !tarballs.includes(file))).toEqual([]);
  });

  it("the lockfile's integrity for each vendored tarball is that file's own sha512", () => {
    const wrong = tarballs.flatMap((file) => {
      const integrity = locked.get(file);
      if (integrity === undefined) return [`${file}: not in pnpm-lock.yaml`];
      const actual = `sha512-${digest(readFileSync(`${VENDOR}${file}`), 'sha512', 'base64')}`;
      return actual === integrity ? [] : [`${file}: ${actual}, the lockfile says ${integrity}`];
    });
    expect(wrong).toEqual([]);
    // No lockfile entry for a tarball that isn't there.
    expect([...locked.keys()].filter((file) => !tarballs.includes(file))).toEqual([]);
  });
});

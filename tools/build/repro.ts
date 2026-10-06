// Builds twice from the same tree and fails unless every shipped byte is identical.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './check-runtime.ts';
import { DIST, ROOT } from './paths.ts';

function build(): void {
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  run(process.execPath, ['tools/build/check-messages.ts']);
  run(join(ROOT, 'node_modules/.bin/vite'), ['build', 'apps/web', '--logLevel', 'warn']);
  run(process.execPath, ['tools/build/postbuild.ts']);
}

function digests(dir: string, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      for (const [k, v] of digests(path, `${prefix}${entry.name}/`)) out.set(k, v);
    else
      out.set(
        `${prefix}${entry.name}`,
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      );
  }
  return out;
}

build();
const first = mkdtempSync(join(tmpdir(), 'efs-repro-'));
cpSync(DIST, first, { recursive: true });
build();
const a = digests(first);
const b = digests(DIST);
rmSync(first, { recursive: true, force: true });
const differences = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
if (differences.length > 0) {
  console.error(`builds differ:\n  ${differences.join('\n  ')}`);
  process.exit(1);
}
console.log(`reproducible: ${b.size} files identical across two builds`);

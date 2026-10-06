// Writes release.json (plan §7.4). Only deterministic inputs go in, so two builds of one
// commit produce identical bytes. Its sha256 is the release identity.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertBuildRuntime } from './build-runtime.ts';
import { DIST, EVIDENCE, ROOT } from './paths.ts';

const EXCLUDED = ['release.json', 'efs.config.json'];
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const version = (pkg: string) =>
  (
    JSON.parse(readFileSync(`${ROOT}node_modules/${pkg}/package.json`, 'utf8')) as {
      version: string;
    }
  ).version;

function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}${e.name}/`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

function role(path: string): string {
  if (path === 'index.html') return 'entry';
  if (path === 'boot-probe.js') return 'probe';
  if (path === 'THIRD_PARTY_LICENSES.txt') return 'licenses';
  if (path.endsWith('.js')) return 'script';
  if (path.endsWith('.css')) return 'style';
  return 'asset';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function writeReleaseManifest(): string {
  assertBuildRuntime(readFileSync(`${ROOT}.node-version`, 'utf8').trim(), process.versions.node);
  const root = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as {
    packageManager: string;
  };
  const manifest = {
    schema: 'efs-client-release/0-experimental',
    name: 'efs-web-client',
    source: {
      repository: 'efs-project/client-v2',
      commit: git('rev-parse', 'HEAD'),
      tree: git('rev-parse', 'HEAD^{tree}'),
      dirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
    },
    inputs: { lockfileSha256: sha256(readFileSync(`${ROOT}pnpm-lock.yaml`)) },
    toolchain: {
      node: process.versions.node,
      packageManager: root.packageManager,
      vite: version('vite'),
      typescript: version('typescript'),
    },
    recipe: { command: 'pnpm build' },
    profile: { delivery: 'static-core', base: 'relative' },
    excluded: EXCLUDED,
    files: files(DIST)
      .filter((f) => !EXCLUDED.includes(f))
      .sort()
      .map((path) => {
        const bytes = readFileSync(`${DIST}${path}`);
        return { path, role: role(path), sha256: sha256(bytes), size: bytes.length };
      }),
  };
  const text = `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
  writeFileSync(`${DIST}release.json`, text);
  const identity = sha256(text);
  writeFileSync(`${EVIDENCE}release-id.txt`, `${identity}\n`);
  return identity;
}

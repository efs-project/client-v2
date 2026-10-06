// Startup-set and import-graph gate over the built output (plan §4.4).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { DIST, EVIDENCE, packageOf, WEB } from './paths.ts';
import type { Provenance } from './provenance.ts';

const FORBIDDEN_PACKAGES = [
  /^lit$/,
  /^lit-html$/,
  /^lit-element$/,
  /^@lit\//,
  /^@lit-labs\//,
  /^@awesome\.me\//,
  /^viem$/,
  /^ethers$/,
  /^ox$/,
  /^abitype$/,
];
// First-party paths that must only ever load after an explicit action (plan §1.2).
const FORBIDDEN_PATHS = [
  /\/apps\/web\/src\/features\/[^/]+\/write\//,
  /\/apps\/web\/src\/shell\/action-review\//,
  /\/apps\/web\/src\/platform\/(storage|wallet)\//,
];
const STARTUP_BUDGET_BYTES = 250 * 1024; // provisional, mvp-and-acceptance; recorded, not gated

export interface GraphReport {
  startupFiles: string[];
  startupBrotliBytes: number;
  errors: string[];
}

function htmlReferences(html: string): { scripts: string[]; styles: string[]; preloads: string[] } {
  const attr = (re: RegExp) => [...html.matchAll(re)].map((m) => (m[1] ?? '').replace(/^\.\//, ''));
  return {
    scripts: attr(/<script[^>]*\bsrc="([^"]+)"/g),
    styles: attr(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
    preloads: attr(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
  };
}

function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

export function checkGraph(): GraphReport {
  const errors: string[] = [];
  const provenance = JSON.parse(readFileSync(`${EVIDENCE}provenance.json`, 'utf8')) as Provenance;
  const chunks = new Map(provenance.chunks.map((c) => [c.fileName, c]));
  const html = readFileSync(`${DIST}index.html`, 'utf8');
  const refs = htmlReferences(html);

  // Every emitted script must be accounted for by provenance (or be the classic probe).
  for (const file of listFiles(DIST).filter((f) => f.endsWith('.js'))) {
    if (!chunks.has(file) && file !== 'boot-probe.js') errors.push(`unaccounted script ${file}`);
  }

  // Startup set: HTML-referenced module scripts and preloads, plus their static imports.
  const startup = new Set<string>();
  const queue = [...refs.scripts, ...refs.preloads].filter((f) => chunks.has(f));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (startup.has(file)) continue;
    startup.add(file);
    for (const dep of chunks.get(file)?.imports ?? []) queue.push(dep);
  }

  for (const file of startup) {
    for (const id of chunks.get(file)?.modules ?? []) {
      const pkg = packageOf(id);
      if (pkg && FORBIDDEN_PACKAGES.some((re) => re.test(pkg))) {
        errors.push(`startup chunk ${file} contains forbidden package ${pkg}`);
      }
      if (FORBIDDEN_PATHS.some((re) => re.test(id)))
        errors.push(`startup chunk ${file} contains ${id}`);
      if (/^\0?node:/.test(id) || (!pkg && id.startsWith('/') && !id.startsWith(WEB))) {
        errors.push(`startup chunk ${file} contains out-of-app module ${id}`);
      }
    }
  }

  const signalChunks = provenance.chunks.filter((c) =>
    c.modules.some((id) => packageOf(id) === 'signal-polyfill'),
  );
  if (signalChunks.length !== 1) {
    errors.push(`signal-polyfill must be in exactly one chunk; found ${signalChunks.length}`);
  }

  for (const chunk of provenance.chunks) {
    const code = readFileSync(`${DIST}${chunk.fileName}`, 'utf8');
    if (/\bimport\(\s*(?!["'`])/.test(code))
      errors.push(`non-literal import() in ${chunk.fileName}`);
  }

  const startupFiles = ['index.html', ...refs.scripts, ...refs.styles, ...refs.preloads]
    .filter((f, i, all) => all.indexOf(f) === i)
    .sort();
  const startupBrotliBytes = startupFiles.reduce(
    (sum, f) => sum + brotliCompressSync(readFileSync(`${DIST}${f}`)).length,
    0,
  );
  writeFileSync(
    `${EVIDENCE}startup.json`,
    `${JSON.stringify({ startupFiles, startupBrotliBytes, budgetBytes: STARTUP_BUDGET_BYTES }, null, 2)}\n`,
  );
  if (startupBrotliBytes > STARTUP_BUDGET_BYTES) {
    console.warn(`warning: startup set ${startupBrotliBytes} B exceeds provisional budget`);
  }
  return { startupFiles, startupBrotliBytes, errors };
}

/** Source maps must not name modules the provenance record doesn't know about. */
export function crossCheckSourceMaps(): string[] {
  const errors: string[] = [];
  const provenance = JSON.parse(readFileSync(`${EVIDENCE}provenance.json`, 'utf8')) as Provenance;
  for (const chunk of provenance.chunks) {
    const mapPath = `${DIST}${chunk.fileName}.map`;
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources: string[] };
    const known = new Set(chunk.modules.map((id) => id.replace(/^\0/, '')));
    for (const source of map.sources) {
      const absolute = resolve(dirname(mapPath), source);
      if (!known.has(absolute) && !source.startsWith('\0') && !source.includes('vite/')) {
        errors.push(`${chunk.fileName}.map names ${source} not in provenance`);
      }
    }
  }
  return errors;
}

// Startup-set and import-graph gate over the built output (plan §4.4).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { DIST, EVIDENCE, packageOf, WEB } from './paths.ts';
import type { Provenance } from './provenance.ts';

// Lit, Signals and Web Awesome render the shell, so they are startup code (slice A, owner ruling
// 2026-11-24: Web Awesome is the one component library). Ethereum libraries never are.
const FORBIDDEN_PACKAGES = [/^viem$/, /^ethers$/, /^ox$/, /^abitype$/];
/**
 * The SDK may appear in startup only as its link and route grammar (@efs/sdk/links: pure string
 * code). Its core (client, chain and byte I/O, viem/ox internals) loads lazily with the reader.
 * Each file is named exactly, never a directory or a glob, so an SDK change that pulls hashing or
 * chain code into the grammar still fails here. Since sdk-v2 c8ed37a the grammar checks home names
 * (files-name/2) and path segments itself: names/name, names/segment and their one helper,
 * core/platform (globalThis wrappers, nothing at import time). PM-checked, 2026-11-25. Since
 * sdk-v2 e229ea3 parseLink folds each word by default (the interim fold, PM D15): names/fold, pure
 * string code with no imports (its constants, its functions and three Unicode-property regexes;
 * nothing read or fetched at import time), 3.8 KB. Added 2026-11-26, PM-approved. Since sdk-v2
 * 754f6d2 parseLink runs the chain's word grammar (checkWord) on each folded word: names/word (its
 * rules, imports only core/platform and the constants) and generated/constants (data only: the
 * refused-scalar table and the word limits, among the protocol's other constants), 8.9 KB
 * unminified together. Added 2026-11-26, for the PM's check.
 */
const STARTUP_SDK_MODULES =
  /\/dist\/(links\/index|names\/links|names\/fold|names\/word|generated\/constants|core\/errors|names\/name|names\/segment|core\/platform)\.js$/;
// First-party paths that must only ever load after an explicit action (plan §1.2).
const FORBIDDEN_PATHS = [
  /\/apps\/web\/src\/features\/[^/]+\/write\//,
  /\/apps\/web\/src\/shell\/action-review\//,
  /\/apps\/web\/src\/platform\/(storage|wallet)\//,
];
// Brotli bytes for everything the first paint needs: HTML, startup scripts and styles, and the icon
// sprite the shell renders immediately. Gated since slice A (provisional value from the plan, §4.4).
const STARTUP_BUDGET_BYTES = 250 * 1024;
/** Same-origin files the first render fetches that are not referenced from index.html. */
const FIRST_RENDER_ASSETS = ['icons/efs-icons.svg'];

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
      if (pkg === '@efs/sdk' && !STARTUP_SDK_MODULES.test(id)) {
        errors.push(`startup chunk ${file} contains SDK core module ${id}`);
      }
      if (FORBIDDEN_PATHS.some((re) => re.test(id)))
        errors.push(`startup chunk ${file} contains ${id}`);
      if (/^\0?node:/.test(id) || (!pkg && id.startsWith('/') && !id.startsWith(WEB))) {
        errors.push(`startup chunk ${file} contains out-of-app module ${id}`);
      }
    }
  }

  // An app's entry chunk may statically import only startup chunks. Measured in WebKit: once a
  // lazy chunk with a preloaded dependency has failed, WebKit keeps the failure across reloads,
  // so the shell's "Try again" (a reload) could never recover that app.
  for (const chunk of provenance.chunks) {
    const isAppEntry = chunk.modules.some((id) =>
      /\/apps\/web\/src\/apps\/[^/]+\/entry\.ts$/.test(id),
    );
    if (!isAppEntry) continue;
    for (const dep of chunk.imports) {
      if (!startup.has(dep)) {
        errors.push(`app entry ${chunk.fileName} statically imports non-startup chunk ${dep}`);
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

  const startupFiles = [
    'index.html',
    ...refs.scripts,
    ...refs.styles,
    ...refs.preloads,
    ...startup,
    ...FIRST_RENDER_ASSETS,
  ]
    .filter((f, i, all) => all.indexOf(f) === i)
    .sort();
  const perFile = Object.fromEntries(
    startupFiles.map((f) => [f, brotliCompressSync(readFileSync(`${DIST}${f}`)).length]),
  );
  const startupBrotliBytes = Object.values(perFile).reduce((sum, n) => sum + n, 0);
  writeFileSync(
    `${EVIDENCE}startup.json`,
    `${JSON.stringify({ startupFiles: perFile, startupBrotliBytes, budgetBytes: STARTUP_BUDGET_BYTES }, null, 2)}\n`,
  );
  if (startupBrotliBytes > STARTUP_BUDGET_BYTES) {
    errors.push(
      `startup set is ${startupBrotliBytes} B (brotli), over the ${STARTUP_BUDGET_BYTES} B budget`,
    );
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

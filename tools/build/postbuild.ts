// Runs after `vite build`. Every check fails the build (plan §4.4).
import { mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { checkBootProbe } from './boot-probe.ts';
import { checkGraph, crossCheckSourceMaps } from './check-graph.ts';
import { writeLicenses } from './licenses.ts';
import { DIST, EVIDENCE } from './paths.ts';
import { writeReleaseManifest } from './release-manifest.ts';
import { scanLeaks } from './scan-leaks.ts';

function fail(step: string, errors: string[]): void {
  if (errors.length === 0) return;
  console.error(`${step} failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

fail('source-map cross-check', crossCheckSourceMaps());
fail('classic boot probe', checkBootProbe(readFileSync(`${DIST}boot-probe.js`, 'utf8')));

// Source maps are release evidence, not deployed files.
mkdirSync(`${EVIDENCE}sourcemaps/assets`, { recursive: true });
for (const file of readdirSync(`${DIST}assets`)) {
  if (file.endsWith('.map'))
    renameSync(`${DIST}assets/${file}`, `${EVIDENCE}sourcemaps/assets/${file}`);
}

const graph = checkGraph();
fail('check-graph', graph.errors);
fail('scan-leaks', scanLeaks());
fail('licenses', writeLicenses());
const identity = writeReleaseManifest();

console.log(`startup set: ${graph.startupFiles.join(', ')}`);
console.log(`startup brotli bytes: ${graph.startupBrotliBytes}`);
console.log(`release identity (sha256 of release.json): ${identity}`);

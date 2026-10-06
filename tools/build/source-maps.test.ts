import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { moveSourceMaps } from './source-maps.ts';

it('replaces obsolete source maps on a changed-hash rebuild and preserves sibling evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'efs-source-maps-'));
  const dist = join(root, 'dist');
  const evidence = join(root, 'dist-evidence');
  const maps = join(evidence, 'sourcemaps');
  try {
    mkdirSync(join(dist, 'assets'), { recursive: true });
    mkdirSync(join(maps, 'assets'), { recursive: true });
    mkdirSync(join(maps, 'removed'), { recursive: true });
    writeFileSync(join(maps, 'assets', 'old-A.js.map'), 'obsolete hash');
    writeFileSync(join(maps, 'removed', 'old-chunk.js.map'), 'removed chunk');
    writeFileSync(join(maps, 'assets', 'current-B.js.map'), 'previous bytes');
    const current = ['current-B.js', 'retained-C.js'];
    const provenance = JSON.stringify({ chunks: current.map((fileName) => ({ fileName })) });
    writeFileSync(join(evidence, 'provenance.json'), provenance);
    writeFileSync(join(evidence, 'unrelated.txt'), 'keep sibling evidence');
    for (const file of current) {
      writeFileSync(join(dist, 'assets', file), 'deployed code');
      writeFileSync(join(dist, 'assets', `${file}.map`), `current map for ${file}`);
    }

    moveSourceMaps(dist, evidence);

    expect(readdirSync(maps)).toEqual(['assets']);
    expect(readdirSync(join(maps, 'assets')).sort()).toEqual(current.map((f) => `${f}.map`));
    for (const file of current)
      expect(readFileSync(join(maps, 'assets', `${file}.map`), 'utf8')).toBe(
        `current map for ${file}`,
      );
    expect(readdirSync(join(dist, 'assets')).sort()).toEqual(current);
    expect(readFileSync(join(evidence, 'provenance.json'), 'utf8')).toBe(provenance);
    expect(readFileSync(join(evidence, 'unrelated.txt'), 'utf8')).toBe('keep sibling evidence');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

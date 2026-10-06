import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Move current emitted source maps into the build's undeployed evidence. */
export function moveSourceMaps(dist: string, evidence: string): void {
  const sourceMaps = join(evidence, 'sourcemaps');
  const destination = join(sourceMaps, 'assets');
  // Replace only the build-owned maps; Vite has already written current provenance.
  rmSync(sourceMaps, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(join(dist, 'assets'))) {
    if (file.endsWith('.map')) renameSync(join(dist, 'assets', file), join(destination, file));
  }
}

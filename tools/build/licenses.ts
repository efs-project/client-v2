// Writes THIRD_PARTY_LICENSES.txt for every package that contributed code to the build.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { DIST, EVIDENCE, packageDirOf, packageOf, ROOT } from './paths.ts';
import type { Provenance } from './provenance.ts';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);

/**
 * Packages whose files ship as build-time assets rather than code, so provenance can't see them.
 * Each license expression must be listed here explicitly with what we ship from it.
 */
const ASSET_PACKAGES = [
  {
    name: '@fortawesome/fontawesome-free',
    license: '(CC-BY-4.0 AND OFL-1.1 AND MIT)',
    ships: 'icon SVGs in icons/efs-icons.svg (tools/build/icons.ts), under CC BY 4.0',
  },
] as const;

const fromTools = createRequire(`${ROOT}tools/package.json`);

export function writeLicenses(): string[] {
  const errors: string[] = [];
  const provenance = JSON.parse(readFileSync(`${EVIDENCE}provenance.json`, 'utf8')) as Provenance;
  const packages = new Map<string, string>();
  for (const chunk of provenance.chunks) {
    for (const id of chunk.modules) {
      const name = packageOf(id);
      const dir = packageDirOf(id);
      if (name && dir) packages.set(name, dir);
    }
  }
  const sections = [
    'EFS web client',
    'Original EFS software is licensed under the MIT License below. This license covers the',
    'software only; it does not license content you read or publish through EFS. The',
    'third-party components that follow keep their own licenses.',
    '',
    readFileSync(`${ROOT}LICENSE`, 'utf8').trim(),
  ];
  for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const meta = JSON.parse(readFileSync(`${dir}package.json`, 'utf8')) as {
      version: string;
      license?: string;
    };
    const license = meta.license ?? 'UNKNOWN';
    if (!ALLOWED.has(license)) errors.push(`${name}: license ${license} is not on the allowlist`);
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    if (!file || !existsSync(`${dir}${file}`)) errors.push(`${name}: no license file in package`);
    const notice = readdirSync(dir).find((f) => /^notice(\.|$)/i.test(f));
    sections.push(
      '',
      '-'.repeat(72),
      `${name}@${meta.version} (${license})`,
      '',
      file ? readFileSync(`${dir}${file}`, 'utf8').trim() : '(license text missing)',
      ...(notice ? ['', 'NOTICE:', readFileSync(`${dir}${notice}`, 'utf8').trim()] : []),
    );
  }
  for (const asset of ASSET_PACKAGES) {
    const dir = `${dirname(fromTools.resolve(`${asset.name}/package.json`))}/`;
    const meta = JSON.parse(readFileSync(`${dir}package.json`, 'utf8')) as {
      version: string;
      license?: string;
    };
    if (meta.license !== asset.license) {
      errors.push(`${asset.name}: license changed to ${meta.license}; review ASSET_PACKAGES`);
    }
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    if (!file) errors.push(`${asset.name}: no license file in package`);
    sections.push(
      '',
      '-'.repeat(72),
      `${asset.name}@${meta.version} (${meta.license}) - assets: ${asset.ships}`,
      '',
      file ? readFileSync(`${dir}${file}`, 'utf8').trim() : '(license text missing)',
    );
  }
  writeFileSync(`${DIST}THIRD_PARTY_LICENSES.txt`, `${sections.join('\n')}\n`);
  return errors;
}

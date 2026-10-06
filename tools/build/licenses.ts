// Writes THIRD_PARTY_LICENSES.txt for every package that contributed code to the build.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  writeFileSync(`${DIST}THIRD_PARTY_LICENSES.txt`, `${sections.join('\n')}\n`);
  return errors;
}

// Fails if any shipped file carries development authority or dev-environment markers.
import { readdirSync, readFileSync } from 'node:fs';
import { DIST } from './paths.ts';

const PATTERNS: Array<[string, RegExp]> = [
  ['anvil default mnemonic', /test test test test test test test test test test test junk/],
  ['anvil default key #0', /ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80/i],
  ['anvil default key #1', /59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d/i],
  ['dev chain admin methods', /\b(anvil|evm|hardhat)_[a-zA-Z]+/],
  ['local dev RPC endpoint', /(127\.0\.0\.1|localhost):85\d\d/],
  ['dev environment flag', /EFS_DEV/],
  ['fixture package', /efs-contracts-fixture|@efs\/contracts-fixture/],
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}${e.name}/`) : [`${dir}${e.name}`],
  );
}

export function scanLeaks(): string[] {
  const errors: string[] = [];
  for (const path of files(DIST)) {
    const text = readFileSync(path, 'latin1');
    for (const [label, re] of PATTERNS) {
      if (re.test(text)) errors.push(`${path.slice(DIST.length)}: ${label}`);
    }
  }
  return errors;
}

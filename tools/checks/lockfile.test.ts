// One reactive core per realm: two copies of the Signals polyfill (or of Lit's runtime)
// split the dependency graph, so watchers in one copy never see changes made through the other.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../build/paths.ts';

const SINGLE_VERSION = [
  'signal-polyfill',
  'lit',
  'lit-html',
  'lit-element',
  '@lit/reactive-element',
];

function versionsOf(lock: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`^  '?${escaped}@([^:('\\s]+)'?:`, 'gm');
  return [...new Set([...lock.matchAll(re)].map((m) => m[1] as string))];
}

describe('lockfile', () => {
  const lock = readFileSync(`${ROOT}pnpm-lock.yaml`, 'utf8');
  for (const name of SINGLE_VERSION) {
    it(`has exactly one version of ${name}`, () => {
      expect(versionsOf(lock, name)).toHaveLength(1);
    });
  }
});

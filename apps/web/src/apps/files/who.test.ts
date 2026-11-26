import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createEfs } from '@efs/sdk';
import { describe, expect, it } from 'vitest';
import { defaultCurators } from '../../shell/dev-accounts-ui.ts';
import { curatorsOf, listText } from './who.ts';

// The SDK's recorded fixture deployment: its default Lens is the seed author, anvil #0.
const deployment = JSON.parse(
  readFileSync(
    `${dirname(createRequire(import.meta.url).resolve('@efs/sdk/package.json'))}/fixtures/rpc/deployment.json`,
    'utf8',
  ),
);
const efs = createEfs({ rpcs: ['https://rpc.example.net/'], deployment });
const SATOSHI = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const HAL = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const NAMES = new Map([
  [SATOSHI, 'Satoshi Nakamoto'],
  [HAL, 'Hal Finney'],
]);

describe('curatorsOf (whose names, synonyms and hidden tags apply, PM D16)', () => {
  it('names the Lens actually read with, in order: you first, then the default curator', () => {
    const asHal = efs.lens.mineFirst(HAL as never, efs.lens.default);
    expect(curatorsOf(efs, asHal, HAL, NAMES, 'you')).toEqual(['you', 'Satoshi Nakamoto']);
    // Satoshi is the default curator: "you" once, never twice.
    const asSatoshi = efs.lens.mineFirst(SATOSHI as never, efs.lens.default);
    expect(curatorsOf(efs, asSatoshi, SATOSHI, NAMES, 'you')).toEqual(['you']);
    // A guest: the default Lens alone.
    expect(curatorsOf(efs, efs.lens.default, undefined, NAMES, 'you')).toEqual([
      'Satoshi Nakamoto',
    ]);
  });

  it('without a name for an address, its short address; a link with its own Lens keeps that order', () => {
    expect(curatorsOf(efs, efs.lens.default, undefined, new Map(), 'you')).toEqual(['0xf39F…2266']);
    const shared = efs.lens.from([HAL as never, SATOSHI as never]);
    expect(curatorsOf(efs, shared, SATOSHI, NAMES, 'you')).toEqual(['Hal Finney', 'you']);
  });

  it('reads as a list in the locale', () => {
    expect(listText('en', ['you', 'Satoshi Nakamoto'])).toBe('you, Satoshi Nakamoto');
  });
});

describe("defaultCurators (the persona chooser's note)", () => {
  it("is the deployment's default Lens, not a position in the persona list", () => {
    expect([...defaultCurators(efs)]).toEqual([SATOSHI]);
    expect(defaultCurators(undefined).size).toBe(0);
  });
});

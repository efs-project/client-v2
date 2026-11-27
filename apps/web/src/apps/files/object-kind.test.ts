import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createEfs } from '@efs/sdk';
import { describe, expect, it } from 'vitest';
import { describeOutcome, LENS_TOO_WIDE } from '../../ui/outcome.ts';
import { ownPlace } from './object-kind.ts';

// The SDK's recorded fixture deployment (its default Lens is the seed author).
const deployment = JSON.parse(
  readFileSync(
    `${dirname(createRequire(import.meta.url).resolve('@efs/sdk/package.json'))}/fixtures/rpc/deployment.json`,
    'utf8',
  ),
);
const efs = createEfs({ rpcs: ['https://rpc.example.net/'], deployment });
const address = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const READER = address(0xaaaa);
const CREATOR = address(0xbbbb);

describe("ownPlace: a file's own place (you, then its creator, then that Lens)", () => {
  it('is the SDK place Lens while it fits in 64 accounts', () => {
    const own = ownPlace(efs, { reader: READER, owner: CREATOR, base: efs.lens.default });
    if (own === LENS_TOO_WIDE) throw new Error('expected a Lens');
    expect(own.principals.length).toBeLessThanOrEqual(64);
    expect(own.principals[0]?.toLowerCase()).toBe(
      efs.lens.principalOf(READER as never).toLowerCase(),
    );
  });

  it('a base of 63 or 64 that the reader and creator push past 64 is LENS_TOO_WIDE, never a throw', () => {
    for (const size of [63, 64]) {
      const base = efs.lens.from(Array.from({ length: size }, (_, i) => address(i + 1)) as never);
      expect(base.principals).toHaveLength(size);
      expect(ownPlace(efs, { reader: READER, owner: CREATOR, base })).toBe(LENS_TOO_WIDE);
    }
    // It says so, as an outcome nobody can retry away.
    const view = describeOutcome('read', 'INVALID', LENS_TOO_WIDE);
    expect(view).toMatchObject({ message: 'outcome.lensTooWide', tone: 'warning' });
    expect(view.retry).toBeUndefined();
  });

  it('any other fault is thrown on, never read as a Lens too wide', () => {
    const broken = {
      lens: {
        place: () => {
          throw Object.assign(new Error('boom'), { name: 'EfsFault', code: 'MISUSE' });
        },
      },
    } as never;
    expect(() => ownPlace(broken, { owner: CREATOR, base: efs.lens.default })).toThrow('boom');
  });
});

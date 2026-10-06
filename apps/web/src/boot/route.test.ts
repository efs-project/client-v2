import { describe, expect, it } from 'vitest';
import { parseRoute } from './route.ts';

describe('parseRoute', () => {
  it('treats a missing or non-route fragment as no route', () => {
    expect(parseRoute(new URL('https://x.test/'))).toEqual({ kind: 'none' });
    expect(parseRoute(new URL('https://x.test/#efs-main'))).toEqual({ kind: 'none' });
  });

  it('keeps an EFS-style fragment as unsupported raw text without interpreting it', () => {
    expect(parseRoute(new URL('https://x.test/#/files/a/b'))).toEqual({
      kind: 'unsupported',
      raw: '/files/a/b',
      truncated: false,
    });
  });

  it('bounds hostile route length', () => {
    const route = parseRoute(new URL(`https://x.test/#/${'a'.repeat(10_000)}`));
    expect(route.kind === 'unsupported' && route.raw.length).toBe(2048);
    expect(route.kind === 'unsupported' && route.truncated).toBe(true);
  });
});

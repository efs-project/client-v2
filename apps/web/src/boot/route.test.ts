import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from './route.ts';

const at = (hash: string) => parseRoute(new URL(`https://x.test/${hash}`));

describe('parseRoute', () => {
  it('treats no route, a bare slash and in-page anchors as the default app', () => {
    expect(at('')).toEqual({ kind: 'default' });
    expect(at('#/')).toEqual({ kind: 'default' });
    expect(at('#efs-main')).toEqual({ kind: 'default' });
  });

  it('names the app and hands it the rest untouched', () => {
    expect(at('#/files/some%20dir/a.txt')).toEqual({
      kind: 'app',
      app: 'files',
      rest: 'some%20dir/a.txt',
      truncated: false,
    });
    expect(at('#/settings')).toEqual({ kind: 'app', app: 'settings', rest: '', truncated: false });
  });

  it('reports a malformed app id instead of guessing', () => {
    expect(at('#/Files/x').kind).toBe('malformed');
    expect(at('#/../etc').kind).toBe('malformed');
  });

  it('bounds hostile route length', () => {
    const route = at(`#/files/${'a'.repeat(10_000)}`);
    expect(route.kind === 'app' && route.truncated).toBe(true);
    expect(route.kind === 'app' && route.rest.length).toBeLessThanOrEqual(2048);
  });
});

describe('formatRoute', () => {
  it('round-trips', () => {
    expect(formatRoute('files')).toBe('#/files');
    expect(at(formatRoute('files', 'a/b'))).toMatchObject({ app: 'files', rest: 'a/b' });
  });
});

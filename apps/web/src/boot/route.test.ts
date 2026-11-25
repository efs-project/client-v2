import { describe, expect, it } from 'vitest';
import { formatRealmRoute, formatRoute, MAX_ROUTE_CHARS, parseRoute } from './route.ts';

const at = (hash: string) => parseRoute(new URL(`https://x.test/${hash}`));
const LEDGER = `0x${'aB'.repeat(20)}`;

describe('parseRoute', () => {
  it('treats no route, a bare slash and in-page anchors as the default', () => {
    expect(at('')).toEqual({ kind: 'default' });
    expect(at('#/')).toEqual({ kind: 'default' });
    expect(at('#efs-main')).toEqual({ kind: 'default' });
  });

  it('names the app and hands it the rest untouched', () => {
    expect(at('#/files/some%20dir/a.txt')).toEqual({
      kind: 'app',
      app: 'files',
      rest: 'some%20dir/a.txt',
    });
    expect(at('#/settings')).toEqual({ kind: 'app', app: 'settings', rest: '' });
  });

  it('parses realm links by alias, passing the SDK link through untouched', () => {
    expect(at('#/r/sepolia/~efs/o/0xabc?lens=0x1,0x2')).toMatchObject({
      kind: 'realm',
      realm: { kind: 'alias', id: 'sepolia' },
      link: '~efs/o/0xabc?lens=0x1,0x2',
    });
    expect(at('#/r/local-1/')).toMatchObject({
      kind: 'realm',
      realm: { kind: 'alias', id: 'local-1' },
      link: '',
      canonical: '#/r/local-1/',
    });
  });

  it('parses the full realm form eip155:<chainId>/0x<ledger>, normalizing the address', () => {
    expect(at(`#/r/eip155:31337/${LEDGER}/~efs/v/0x01`)).toEqual({
      kind: 'realm',
      realm: { kind: 'full', chainId: 31337, ledger: LEDGER.toLowerCase() },
      link: '~efs/v/0x01',
      canonical: `#/r/eip155:31337/${LEDGER.toLowerCase()}/~efs/v/0x01`,
    });
    expect(at('#/r/cosmos:1/x').kind).toBe('malformed');
    expect(at('#/r/eip155:31337/0x1234/x').kind).toBe('malformed');
    expect(at('#/r/eip155:0/0x1/x').kind).toBe('malformed');
  });

  it('reserves single-letter first segments for link forms and keeps app ids dot-free', () => {
    expect(at('#/o/0xabc').kind).toBe('malformed');
    expect(at('#/x').kind).toBe('malformed');
    expect(at('#/alice.eth/photos').kind).toBe('malformed');
    expect(at('#/Files/x').kind).toBe('malformed');
    expect(at('#/../etc').kind).toBe('malformed');
    expect(at('#/r/Sepolia/x').kind).toBe('malformed');
  });

  it('refuses an over-long route visibly instead of truncating it', () => {
    expect(at(`#/r/sepolia/${'a'.repeat(MAX_ROUTE_CHARS)}`)).toMatchObject({ kind: 'too-long' });
    expect(
      at(`#/r/sepolia/~efs/o/0x1?lens=${'0x'.padEnd(66, 'a').concat(',').repeat(64)}`).kind,
    ).toBe('realm');
  });
});

describe('formatRoute / formatRealmRoute', () => {
  it('round-trips', () => {
    expect(formatRoute('files')).toBe('#/files');
    expect(at(formatRoute('files', 'a/b'))).toMatchObject({ app: 'files', rest: 'a/b' });
    const full = { kind: 'full', chainId: 1, ledger: LEDGER.toLowerCase() } as const;
    expect(at(formatRealmRoute(full, '~efs/o/0x1'))).toMatchObject({
      kind: 'realm',
      realm: full,
      link: '~efs/o/0x1',
    });
    expect(formatRealmRoute({ kind: 'alias', id: 'sepolia' })).toBe('#/r/sepolia/');
  });
});

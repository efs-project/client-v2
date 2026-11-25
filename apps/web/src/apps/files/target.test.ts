import { link } from '@efs/sdk';
import { describe, expect, it } from 'vitest';
import { linkState } from './target.ts';

const SUBJECT = `0x${'ab'.repeat(32)}` as const;
const RECORD = `0x${'cd'.repeat(32)}` as const;
const realm = { kind: 'alias', id: 'sepolia' } as const;
const at = (l: string) => linkState({ kind: 'realm', realm, link: l });

describe('linkState', () => {
  it('has no target outside a realm link or at a realm root', () => {
    expect(linkState({ kind: 'app', rest: 'x' })).toEqual({ status: 'none' });
    expect(at('')).toEqual({ status: 'none' });
  });

  it('opens object links as files and revision links exactly, via the SDK grammar', () => {
    expect(at(link({ kind: 'object', subject: SUBJECT }))).toMatchObject({
      status: 'target',
      target: { kind: 'file', subject: SUBJECT },
    });
    expect(at(link({ kind: 'revision', recordId: RECORD }))).toMatchObject({
      status: 'target',
      target: { kind: 'revision', recordId: RECORD },
    });
  });

  it("carries the sharer's Lens and reports the canonical form", () => {
    const account = `0x${'12'.repeat(20)}`;
    // Uppercase hex is accepted, and the canonical form is lowercase.
    const state = at(
      `${link({ kind: 'object', subject: SUBJECT }).toUpperCase().replace('~EFS/O/0X', '~efs/o/0x')}?lens=${account}`,
    );
    expect(state).toMatchObject({ status: 'target' });
    if (state.status !== 'target') throw new Error('expected a target');
    expect(state.lens?.principals).toHaveLength(1);
    expect(state.canonical).toContain(SUBJECT);
  });

  it('reports invalid links, and address and topic links, instead of guessing', () => {
    expect(at('~efs/o/0x1234')).toMatchObject({ status: 'invalid' });
    expect(at('~efs/o/0x1?lens=alice.eth')).toMatchObject({ status: 'invalid' });
    // A bare path is a topic; a first segment of 0x + 40 hex is an address (home).
    expect(at('cars/tesla')).toEqual({
      status: 'topic',
      segments: ['cars', 'tesla'],
      canonical: 'cars/tesla',
    });
    expect(at(`0x${'ab'.repeat(20)}/photos/cat.jpg`)).toEqual({
      status: 'home',
      address: `0x${'ab'.repeat(20)}`,
      names: ['photos', 'cat.jpg'],
      canonical: `0x${'ab'.repeat(20)}/photos/cat.jpg`,
    });
    // Words go to the SDK as typed (no fold yet): the read checks them against the grammar.
    expect(at('Cars')).toMatchObject({ status: 'topic', segments: ['Cars'] });
    // A bare address is a home with no names; the sharer's Lens travels with it.
    const home = at(`0x${'AB'.repeat(20)}?lens=0x${'12'.repeat(20)}`);
    if (home.status !== 'home') throw new Error('expected a home');
    expect(home.address).toBe(`0x${'ab'.repeat(20)}`);
    expect(home.names).toEqual([]);
    expect(home.lens?.principals).toHaveLength(1);
    // Anything else starting with ~ is the system's, and refused.
    expect(at('~other/x')).toMatchObject({ status: 'invalid' });
    // ~root and ~home are reserved names, never a link of their own.
    expect(at('~root')).toEqual({ status: 'invalid', rule: 'reserved-name' });
    expect(at('~root/docs')).toEqual({ status: 'invalid', rule: 'reserved-name' });
    expect(at('~home')).toEqual({ status: 'invalid', rule: 'reserved-name' });
    expect(at(`~home/0x${'ab'.repeat(20)}`)).toEqual({ status: 'invalid', rule: 'reserved-name' });
  });

  it('opens a path from a folder by its id as a path, never as the folder itself', () => {
    const state = at(`${link({ kind: 'object', subject: RECORD })}/docs/read%20me.md`);
    expect(state).toEqual({
      status: 'path',
      link: { kind: 'path', folder: RECORD, names: ['docs', 'read me.md'] },
      canonical: `~efs/o/${RECORD}/docs/read%20me.md`,
    });
    // One trailing "/" is ignored; its names keep their case; a name breaking files-name/2 refuses.
    expect(at(`~efs/o/${RECORD}/Docs/`)).toMatchObject({
      status: 'path',
      link: { names: ['Docs'] },
    });
    expect(at(`~efs/o/${RECORD}/~efs`)).toMatchObject({ status: 'invalid', rule: 'bad-name' });
    // The sharer's Lens travels with the path.
    const shared = at(`~efs/o/${RECORD}/a.txt?lens=0x${'12'.repeat(20)}`);
    if (shared.status !== 'path') throw new Error('expected a path');
    expect(shared.link.lens?.principals).toHaveLength(1);
  });
});

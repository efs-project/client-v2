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
    expect(at('cars/tesla')).toEqual({ status: 'path', kind: 'topic' });
    expect(at(`0x${'ab'.repeat(20)}/photos/cat.jpg`)).toEqual({ status: 'path', kind: 'home' });
    // Anything else starting with ~ is the system's, and refused.
    expect(at('~other/x')).toMatchObject({ status: 'invalid' });
  });
});

import type { RevisionRef } from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../boot/route.ts';
import { createDraftStore, draftKey } from './drafts.ts';

const base: RevisionRef = { kind: 'revision', recordId: `0x${'0e'.repeat(32)}` as never };

describe('createDraftStore', () => {
  it('keeps one draft per file and counts the files with one', () => {
    const drafts = createDraftStore();
    expect(drafts.count.get()).toBe(0);
    drafts.keep('#/r/testnet/a', { text: 'one', base });
    drafts.keep('#/r/testnet/a', { text: 'two', base });
    drafts.keep('#/r/testnet/b', { text: 'other', base });
    expect(drafts.get('#/r/testnet/a')?.text).toBe('two');
    expect(drafts.count.get()).toBe(2);
    drafts.drop('#/r/testnet/a');
    drafts.drop('#/r/testnet/a');
    expect(drafts.get('#/r/testnet/a')).toBeUndefined();
    expect(drafts.count.get()).toBe(1);
  });
});

describe('draftKey', () => {
  it("is the file's canonical route: the one the shell writes and the banner navigates to", () => {
    const ledger = `0x${'AB'.repeat(20)}`;
    for (const hash of ['#/r/testnet/~efs/o/0x01', `#/r/eip155:11155111/${ledger}/~efs/o/0x01`]) {
      const route = parseRoute(new URL(`https://efs.example/${hash}`));
      if (route.kind !== 'realm') throw new Error(`not a realm route: ${hash}`);
      expect(draftKey(route.realm, route.link)).toBe(route.canonical);
    }
  });
});

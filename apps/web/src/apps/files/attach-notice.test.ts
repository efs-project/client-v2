import { describe, expect, it } from 'vitest';
import { attachesElsewhere } from './attach-notice.ts';

const ME = `0x${'00'.repeat(12)}${'aa'.repeat(20)}`;
const OTHER = `0x${'00'.repeat(12)}${'bb'.repeat(20)}`;
const at = (owner?: string) => ({
  kind: 'home' as const,
  address: `0x${'bb'.repeat(20)}` as never,
  ...(owner ? { owner: owner as never } : {}),
});

describe("attachesElsewhere: the notice before writing at someone else's address", () => {
  it("is said at another person's address", () => {
    expect(attachesElsewhere(at(OTHER), ME)).toBe(true);
  });
  it('is not said at your own address, whatever the case of the ids', () => {
    expect(attachesElsewhere(at(ME.toUpperCase().replace('0X', '0x')), ME)).toBe(false);
  });
  it('is said when no read has seen the address owner: never assumed away', () => {
    expect(attachesElsewhere(at(), ME)).toBe(true);
  });
  it('is never said in a folder', () => {
    expect(
      attachesElsewhere({ kind: 'folder', directory: `0x${'d1'.repeat(32)}` as never }, ME),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { approvalsLine } from './approvals.ts';

const t = (id: string, args: Record<string, unknown> = {}) => `${id}${JSON.stringify(args)}`;

describe('approvalsLine: the count from review.prompts only', () => {
  it('one approval says so', () => {
    expect(approvalsLine(t as never, { sequential: 1, atomicBatch: 1 })).toBe(
      'review.promptsOne{}',
    );
  });
  it('one per part; a batch count is said only when a batching wallet would ask fewer times', () => {
    expect(approvalsLine(t as never, { sequential: 3, atomicBatch: 3 })).toBe(
      'review.promptsMany{"count":3}',
    );
    expect(approvalsLine(t as never, { sequential: 4, atomicBatch: 2 })).toBe(
      'review.promptsBatch{"count":4,"batch":2}',
    );
  });
});

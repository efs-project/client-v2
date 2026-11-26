import type { ThingTagsPage } from '@efs/sdk/tags';
import { describe, expect, it } from 'vitest';
import { fromThingTags } from './file-tags.ts';

const page = (o: { rows?: number; finished?: boolean; denied?: number } = {}): ThingTagsPage =>
  ({
    kind: 'efs.thingTagsPage',
    status: 'PRESENT',
    view: 'everyone',
    thing: '0x01',
    rows: Array.from({ length: o.rows ?? 0 }, (_, i) => ({
      topic: `0x${String(i).padStart(64, '0')}`,
      decider: { kind: 'public' },
    })),
    finished: o.finished ?? false,
    scan: o.finished ? 'EXHAUSTED' : 'LIMIT',
    ...(o.finished ? {} : { next: { v: 1, query: '0x', next: '0x', seen: [], bounded: false } }),
    dedup: { state: 'COMPLETE', dropped: 0 },
    counts: { deniedByLens: o.denied ?? 0 },
  }) as unknown as ThingTagsPage;

describe("a file's tags (lensTagsOf): the page laws", () => {
  it('appends pages; only `finished` ends the list; places left out by the Lens are summed', () => {
    const first = fromThingTags(page({ rows: 2, denied: 1 }));
    expect(first).toMatchObject({ phase: 'page', finished: false, denied: 1 });
    if (first.phase !== 'page') throw new Error('page');
    expect(first.next).toBeDefined();
    const all = fromThingTags(page({ rows: 1, finished: true, denied: 2 }), first);
    expect(all).toMatchObject({ phase: 'page', finished: true, denied: 3 });
    if (all.phase !== 'page') throw new Error('page');
    expect(all.rows).toHaveLength(3);
    expect(all.next).toBeUndefined();
  });

  it('UNKNOWN is never "no tags": a first page says why; a later one keeps the rows', () => {
    const failed = { kind: 'efs.thingTagsPage', status: 'UNKNOWN' } as unknown as ThingTagsPage;
    expect(fromThingTags(failed)).toEqual({ phase: 'unknown' });
    const first = fromThingTags(page({ rows: 1 }));
    if (first.phase !== 'page') throw new Error('page');
    expect(fromThingTags(failed, first)).toMatchObject({ phase: 'page', more: 'failed' });
  });
});

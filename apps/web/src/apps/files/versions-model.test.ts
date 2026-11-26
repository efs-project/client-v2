import type { Lens } from '@efs/sdk';
import type {
  FileVersion,
  FileVersionsCursor,
  FileVersionsOpts,
  FileVersionsResult,
  LensVersion,
  VersionsDecision,
} from '@efs/sdk/files';
import { describe, expect, it } from 'vitest';
import {
  decisionLine,
  nobodyElse,
  type ReadState,
  type ReadVersions,
  readMore,
  readVersions,
  VERSIONS_CALLS_PER_CLICK,
  versionsCount,
} from './versions-model.ts';

const id = (b: string) => `0x${b.repeat(32)}`;
const A = id('a1');
const B = id('b2');
const C = id('c3');
const D = id('d4');
const P1 = id('e5');
const P2 = id('f6');
const FILE = id('99');
const REV = (b: string) => id(b);
const efs = {} as never;
const LENS = { principals: [A, B] } as unknown as Lens;

const present = (author: string, creator = false): FileVersion =>
  ({ author, state: 'PRESENT', revision: REV('0b'), creator }) as never;
const lensRow = (author: string, lensIndex: number): LensVersion =>
  ({ ...present(author), lensIndex }) as never;
const cursor = (before: number): FileVersionsCursor =>
  ({ kind: 'efs.fileVersionsCursor', file: FILE, before }) as never;

/** A real-shaped PRESENT answer (basis and evidence aren't read by the view). */
const page = (o: {
  rows?: readonly FileVersion[];
  next?: FileVersionsCursor;
  live?: number;
  changed?: boolean;
  decision?: VersionsDecision;
  lens?: readonly LensVersion[];
  creator?: FileVersion;
}): FileVersionsResult =>
  ({
    kind: 'efs.fileVersions',
    status: 'PRESENT',
    file: FILE,
    decision: o.decision ?? { kind: 'version', author: A, revision: REV('0a'), lensIndex: 0 },
    lens: o.lens ?? [lensRow(A, 0)],
    ...(o.creator ? { creator: o.creator } : {}),
    public: {
      status: 'PRESENT',
      rows: o.rows ?? [],
      total: 99,
      live: o.live ?? 4,
      count: 1000,
      scanned: 150,
      changed: o.changed ?? false,
      ...(o.next ? { next: o.next } : {}),
    },
    basis: {},
    evidence: {},
  }) as never;

/** A reader that answers in order and records each call's options. */
function reader(answers: readonly FileVersionsResult[]) {
  const calls: FileVersionsOpts[] = [];
  const read: ReadVersions = async (_efs, target, o) => {
    expect(target).toEqual({ kind: 'file', subject: FILE });
    calls.push(o);
    const a = answers[calls.length - 1];
    if (!a) throw new Error(`unexpected call ${calls.length}`);
    return a;
  };
  return { read, calls };
}

describe('readVersions: the first click', () => {
  it('leads with the decision, keeps the tiers apart, and counts only `live`', async () => {
    const r = reader([
      page({
        lens: [lensRow(A, 0), lensRow(B, 1)],
        creator: present(C, true),
        rows: [present(P1), present(P2)],
        live: 5,
      }),
    ]);
    const s = await readVersions(r.read, efs, FILE, { lens: LENS });
    expect(r.calls).toHaveLength(1);
    // The Lens the file was opened under is the one read with.
    expect(r.calls[0]?.lens).toBe(LENS);
    expect(r.calls[0]?.cursor).toBeUndefined();
    expect(s).toMatchObject({
      phase: 'read',
      decision: { kind: 'version', author: A },
      lens: [{ author: A }, { author: B }],
      creator: { author: C, creator: true },
      public: { status: 'present', rows: [{ author: P1 }, { author: P2 }], live: 5, more: 'idle' },
    });
    // No `next`: the end of the list. Neither `count` nor `total` is kept.
    if (s.phase !== 'read' || s.public.status !== 'present') throw new Error('expected rows');
    expect(s.public.next).toBeUndefined();
    expect(s.public.unchecked).toBe(false);
    expect(Object.keys(s.public)).not.toContain('count');
    expect(Object.keys(s.public)).not.toContain('total');
    expect(versionsCount(s)).toBe(5);
  });

  it('an empty page with `next` reads on, at most the budget per click, then says more remains', async () => {
    const r = reader([
      page({ next: cursor(300) }),
      page({ next: cursor(150) }),
      page({ next: cursor(1) }),
    ]);
    const s = await readVersions(r.read, efs, FILE, { lens: LENS });
    expect(VERSIONS_CALLS_PER_CLICK).toBe(3);
    expect(r.calls).toHaveLength(3);
    expect(r.calls.map((c) => c.cursor)).toEqual([undefined, cursor(300), cursor(150)]);
    expect(s).toMatchObject({
      phase: 'read',
      public: { status: 'present', rows: [], next: cursor(1), unchecked: true, more: 'idle' },
    });
  });

  it('stops as soon as a page has rows', async () => {
    const r = reader([
      page({ next: cursor(300) }),
      page({ rows: [present(P1)], next: cursor(150) }),
    ]);
    const s = await readVersions(r.read, efs, FILE);
    expect(r.calls).toHaveLength(2);
    expect(s).toMatchObject({
      public: { rows: [{ author: P1 }], next: cursor(150), unchecked: false },
    });
  });

  it('a public tier the index does not vouch for keeps the exact decision and Lens tiers', async () => {
    const unvouched = {
      ...(page({ creator: present(C, true) }) as object),
      public: { status: 'UNKNOWN', reason: { code: 'COVERAGE_PARTIAL' } },
    } as never;
    const s = await readVersions(reader([unvouched]).read, efs, FILE);
    expect(s).toMatchObject({
      phase: 'read',
      decision: { kind: 'version', author: A },
      lens: [{ author: A }],
      creator: { author: C },
      public: { status: 'unknown', reason: { code: 'COVERAGE_PARTIAL' } },
    });
    // No number when the list is UNKNOWN.
    expect(versionsCount(s)).toBeUndefined();
  });

  it('a read that fails is unknown (with its reason); a subject never created is absent', async () => {
    const behind = { kind: 'efs.fileVersions', status: 'UNKNOWN', reason: { code: 'BEHIND' } };
    expect(await readVersions(reader([behind as never]).read, efs, FILE)).toEqual({
      phase: 'unknown',
      reason: { code: 'BEHIND' },
    });
    const absent = { kind: 'efs.fileVersions', status: 'ABSENT_PROVEN', file: FILE };
    expect(await readVersions(reader([absent as never]).read, efs, FILE)).toEqual({
      phase: 'absent',
    });
  });

  it('a later page that fails keeps what was read, and Try again carries on from there', async () => {
    const failed = {
      kind: 'efs.fileVersions',
      status: 'UNKNOWN',
      reason: { code: 'RPC_UNAVAILABLE' },
    };
    const s = await readVersions(
      reader([page({ next: cursor(300) }), failed as never]).read,
      efs,
      FILE,
    );
    expect(s).toMatchObject({
      phase: 'read',
      public: { status: 'present', rows: [], next: cursor(300), unchecked: false, more: 'failed' },
    });
  });
});

describe('readMore: Load more', () => {
  const first = async (answers: readonly FileVersionsResult[]) =>
    (await readVersions(reader(answers).read, efs, FILE)) as ReadState;

  it('appends rows, keeps the first page tiers and count, and follows `next`', async () => {
    const before = await first([page({ rows: [present(P1)], next: cursor(150), live: 4 })]);
    const r = reader([
      page({
        rows: [present(P2)],
        live: 9,
        decision: { kind: 'none' },
        lens: [],
      }),
    ]);
    const s = await readMore(r.read, efs, FILE, before, { lens: LENS });
    expect(r.calls.map((c) => c.cursor)).toEqual([cursor(150)]);
    expect(r.calls[0]?.lens).toBe(LENS);
    expect(s).toMatchObject({
      decision: { kind: 'version', author: A },
      lens: [{ author: A }],
      public: { rows: [{ author: P1 }, { author: P2 }], live: 4, unchecked: false, more: 'idle' },
    });
    if (s.public.status !== 'present') throw new Error('expected rows');
    expect(s.public.next).toBeUndefined();
  });

  it('spends the same budget per click, and a changed list stays changed (offer a refresh)', async () => {
    const before = await first([page({ rows: [present(P1)], next: cursor(450) })]);
    const r = reader([
      page({ next: cursor(300), changed: true }),
      page({ next: cursor(150) }),
      page({ next: cursor(1) }),
    ]);
    const s = await readMore(r.read, efs, FILE, before);
    expect(r.calls).toHaveLength(3);
    expect(s.public).toMatchObject({
      rows: [{ author: P1 }],
      changed: true,
      next: cursor(1),
      unchecked: true,
    });
  });

  it('a Load more that fails keeps the rows and its `next`, so Try again reads the same page', async () => {
    const before = await first([page({ rows: [present(P1)], next: cursor(150) })]);
    const failed = { kind: 'efs.fileVersions', status: 'UNKNOWN', reason: { code: 'BEHIND' } };
    const s = await readMore(reader([failed as never]).read, efs, FILE, before);
    expect(s.public).toMatchObject({
      rows: [{ author: P1 }],
      next: cursor(150),
      more: 'failed',
    });
    // Nothing to load: unchanged, and no call.
    const done = await first([page({ rows: [present(P1)] })]);
    expect(await readMore(reader([]).read, efs, FILE, done)).toBe(done);
  });
});

describe('decisionLine: what the file shows in its Lens, said first', () => {
  it('names whose version it is, or who hid it, and never reads unknown as nobody', () => {
    const v: VersionsDecision = {
      kind: 'version',
      author: A,
      revision: REV('0a'),
      lensIndex: 0,
    } as never;
    expect(decisionLine(v, undefined)).toEqual({
      id: 'files.versions.decision.version',
      author: A,
    });
    expect(decisionLine(v, A.toUpperCase().replace('0X', '0x'))).toEqual({
      id: 'files.versions.decision.yours',
    });
    const h: VersionsDecision = { kind: 'hidden', author: D, lensIndex: 0 } as never;
    expect(decisionLine(h, A)).toEqual({ id: 'files.versions.decision.hidden', author: D });
    expect(decisionLine(h, D)).toEqual({ id: 'files.versions.decision.hiddenByYou' });
    expect(decisionLine({ kind: 'none' }, A)).toEqual({ id: 'files.versions.decision.none' });
    expect(decisionLine({ kind: 'unknown', reason: { code: 'BEHIND' } } as never, A)).toEqual({
      id: 'files.versions.decision.unknown',
    });
  });

  it("a Lens author's lone no hides the file while another Lens author has a version", async () => {
    // D is first in the Lens and only ever said "not this": the walk stops at D (hidden), D is
    // never a row, and B's version is listed with its own Show (the PM's case, 2026-11-26).
    const s = await readVersions(
      reader([
        page({
          decision: { kind: 'hidden', author: D, lensIndex: 0 } as never,
          lens: [lensRow(B, 1)],
        }),
      ]).read,
      efs,
      FILE,
    );
    if (s.phase !== 'read') throw new Error('expected a read');
    expect(decisionLine(s.decision, A)).toEqual({
      id: 'files.versions.decision.hidden',
      author: D,
    });
    expect(s.lens.map((r) => r.author)).toEqual([B]);
  });
});

describe('nobodyElse: "Nobody else has a version of this file." only when proven', () => {
  it('needs a PRESENT tier with no rows across clicks, no `next`, an idle Load more and an unmoved list', async () => {
    const ended = (await readVersions(reader([page({})]).read, efs, FILE)) as ReadState;
    expect(nobodyElse(ended.public)).toBe(true);
    // Rows, more to read, a failed Load more, or an UNKNOWN tier: never "nobody else".
    const rows = (await readVersions(
      reader([page({ rows: [present(P1)] })]).read,
      efs,
      FILE,
    )) as ReadState;
    expect(nobodyElse(rows.public)).toBe(false);
    const more = (await readVersions(
      reader([page({ next: cursor(3) }), page({ next: cursor(2) }), page({ next: cursor(1) })])
        .read,
      efs,
      FILE,
    )) as ReadState;
    expect(nobodyElse(more.public)).toBe(false);
    if (ended.public.status !== 'present') throw new Error('expected a PRESENT tier');
    expect(nobodyElse({ ...ended.public, more: 'failed' })).toBe(false);
    expect(nobodyElse({ status: 'unknown' })).toBe(false);
  });

  it('a list that moved since the first page never proves "nobody else": only the changed notice', async () => {
    // The first page had `next`; by the last page the list had moved and ended with no rows. Its
    // newer entries (appended after the first page) were never scanned.
    const before = (await readVersions(
      reader([page({ next: cursor(2) }), page({ changed: true })]).read,
      efs,
      FILE,
    )) as ReadState;
    expect(before.public).toMatchObject({ status: 'present', rows: [], changed: true });
    if (before.public.status !== 'present') throw new Error('expected a PRESENT tier');
    expect(before.public.next).toBeUndefined();
    expect(nobodyElse(before.public)).toBe(false);
  });
});

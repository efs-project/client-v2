import type { SequenceProgress } from '@efs/sdk/actions';
import { describe, expect, it } from 'vitest';
import {
  heldMessage,
  saveHold,
  statementKey,
  touchesOf,
  touchesOfInput,
  twinFromReconcile,
  twinStanding,
} from './save-hold.ts';

const ME = `0x${'ab'.repeat(20)}`;
const FILE = `0x${'f1'.repeat(32)}`;
const OTHER_FILE = `0x${'f2'.repeat(32)}`;

const p = (over: Partial<SequenceProgress>): SequenceProgress =>
  ({
    kind: 'efs.sequence',
    sequenceId: `0x${'01'.repeat(32)}`,
    account: ME,
    state: 'IN_FLIGHT',
    final: false,
    total: 1,
    committed: 0,
    effect: { kind: 'files.edit', file: FILE, revision: `0x${'0e'.repeat(32)}` },
    ...over,
  }) as SequenceProgress;

// sdk-v2 #34 shapes: bigint unix seconds, the block the last successful ledger read used.
const inFlight = (deadline: bigint, at: bigint, pastDeadline: boolean, block = 120n) =>
  p({
    current: {
      index: 0,
      planId: `0x${'0d'.repeat(32)}`,
      deadline,
      checkedAt: { blockNumber: block, timestamp: at },
      pastDeadline,
    } as never,
  });

const hold = (saves: SequenceProgress[], except?: string) =>
  saveHold(saves, { account: ME, file: FILE, except });

describe('saveHold', () => {
  it('an in-flight save waits until its deadline, estimated as of the block last read', () => {
    expect(hold([inFlight(1_000_900n, 1_000_000n, false, 77n)])).toEqual({
      hold: { kind: 'waiting', minutes: 15, block: 77n },
      lapsed: false,
    });
  });

  it('releases only on the SDK\'s pastDeadline, with the "didn\'t confirm in time" warning', () => {
    expect(hold([inFlight(1_000_000n, 1_000_100n, true)])).toEqual({ lapsed: true });
    // Never on a clock: the deadline "passed" by the numbers but the SDK hasn't said so.
    expect(hold([inFlight(1_000_000n, 1_000_100n, false)]).hold).toMatchObject({
      kind: 'waiting',
    });
  });

  it('before any ledger read the wait is unknown ("Check again")', () => {
    expect(hold([p({ current: { index: 0 } as never })])).toEqual({
      hold: { kind: 'waiting' },
      lapsed: false,
    });
  });

  it('a save to finish or stop holds, whatever is in flight', () => {
    expect(hold([inFlight(9n, 1n, true), p({ state: 'PARTIAL', committed: 1, total: 2 })])).toEqual(
      { hold: { kind: 'unsettled' }, lapsed: false },
    );
    expect(hold([p({ state: 'NOT_STARTED' })]).hold).toEqual({ kind: 'unsettled' });
  });

  it('holds per file when the save names it; older records hold every file', () => {
    const otherFile = p({
      state: 'PARTIAL',
      effect: { kind: 'files.edit', file: OTHER_FILE as never, revision: `0x${'0e'.repeat(32)}` },
    });
    expect(hold([otherFile])).toEqual({ lapsed: false });
    const noEffect = p({ state: 'PARTIAL' });
    delete (noEffect as { effect?: unknown }).effect;
    expect(hold([noEffect]).hold).toEqual({ kind: 'unsettled' });
    // Case doesn't matter.
    const upper = p({
      state: 'PARTIAL',
      effect: { kind: 'files.edit', file: FILE.toUpperCase() as never, revision: '0x' as never },
    });
    expect(hold([upper]).hold).toEqual({ kind: 'unsettled' });
  });

  it('ignores settled saves, other accounts, and the save a review continues', () => {
    expect(hold([p({ state: 'COMPLETE', committed: 1 })])).toEqual({ lapsed: false });
    expect(hold([p({ state: 'PARTIAL', account: `0x${'cd'.repeat(20)}` as never })])).toEqual({
      lapsed: false,
    });
    const own = p({ state: 'NOT_STARTED', sequenceId: `0x${'09'.repeat(32)}` as never });
    expect(hold([own], own.sequenceId)).toEqual({ lapsed: false });
  });
});

describe('saveHold for folder operations: per (folder, name), fail-closed', () => {
  const DIR = `0x${'d1'.repeat(32)}`;
  const DIR2 = `0x${'d2'.repeat(32)}`;
  const T = `0x${'7a'.repeat(32)}`;
  const partial = (effect: unknown) => p({ state: 'PARTIAL', effect: effect as never });
  const at = (folder: string, name: string) => (saves: SequenceProgress[]) =>
    saveHold(saves, { account: ME, places: [{ folder, name }] });
  const create = (folder: string, name: string) => ({
    kind: 'files.create',
    folder,
    name,
    file: FILE,
    revision: T,
  });

  it('a create at a different name, or in another folder, does not wait', () => {
    expect(at(DIR, 'b.txt')([partial(create(DIR, 'a.txt'))])).toEqual({ lapsed: false });
    expect(at(DIR2, 'a.txt')([partial(create(DIR, 'a.txt'))])).toEqual({ lapsed: false });
  });

  it('a save at the same (folder, name) waits, whatever its kind; case does not matter', () => {
    expect(at(DIR, 'a.txt')([partial(create(DIR.toUpperCase(), 'a.txt'))]).hold).toEqual({
      kind: 'unsettled',
    });
    const folder = {
      kind: 'files.createFolder',
      folder: DIR,
      name: 'a.txt',
      directory: T,
      subject: T,
    };
    expect(at(DIR, 'a.txt')([partial(folder)]).hold).toEqual({ kind: 'unsettled' });
    const removed = {
      kind: 'files.remove',
      hide: false,
      entries: [{ folder: DIR, name: 'a.txt', target: T }],
    };
    expect(at(DIR, 'a.txt')([partial(removed)]).hold).toEqual({ kind: 'unsettled' });
    const restored = {
      kind: 'files.restore',
      entries: [{ folder: DIR, name: 'a.txt', target: T }],
    };
    expect(at(DIR, 'a.txt')([partial(restored)]).hold).toEqual({ kind: 'unsettled' });
  });

  it('names are exact: a different case is a different name (files-name/2)', () => {
    expect(at(DIR, 'A.txt')([partial(create(DIR, 'a.txt'))])).toEqual({ lapsed: false });
  });

  it('a move holds both the place it leaves and the place it goes to', () => {
    const move = {
      kind: 'files.move',
      moves: [{ folder: DIR, name: 'old.txt', toFolder: DIR2, toName: 'new.txt', target: T }],
    };
    expect(at(DIR, 'old.txt')([partial(move)]).hold).toEqual({ kind: 'unsettled' });
    expect(at(DIR2, 'new.txt')([partial(move)]).hold).toEqual({ kind: 'unsettled' });
    expect(at(DIR2, 'old.txt')([partial(move)])).toEqual({ lapsed: false });
  });

  it('an edit and a folder operation do not hold each other', () => {
    expect(at(DIR, 'a.txt')([partial({ kind: 'files.edit', file: FILE, revision: T })])).toEqual({
      lapsed: false,
    });
    expect(hold([partial(create(DIR, 'a.txt'))])).toEqual({ lapsed: false });
  });

  it('an unknown or missing effect holds every save of the account', () => {
    const unknown = partial({ kind: 'files.somethingNew', folder: DIR, name: 'a.txt' });
    expect(at(DIR2, 'zzz')([unknown]).hold).toEqual({ kind: 'unsettled' });
    expect(hold([unknown]).hold).toEqual({ kind: 'unsettled' });
    const none = p({ state: 'PARTIAL' });
    delete (none as { effect?: unknown }).effect;
    expect(at(DIR2, 'zzz')([none]).hold).toEqual({ kind: 'unsettled' });
  });

  it('a malformed folder effect (no entries) holds everything', () => {
    expect(at(DIR2, 'zzz')([partial({ kind: 'files.remove', hide: false })]).hold).toEqual({
      kind: 'unsettled',
    });
  });

  it('a new save that names neither a file nor places is held by any unsettled save', () => {
    expect(saveHold([partial(create(DIR, 'a.txt'))], { account: ME }).hold).toEqual({
      kind: 'unsettled',
    });
  });
});

describe('saveHold for tag saves: per (topic, thing) statement (sdk-v2 983d70b effects)', () => {
  const TOPIC = `0x${'7a'.repeat(32)}`;
  const THING = `0x${'5a'.repeat(32)}`;
  const tagSave = (kind: string, targets: string[], topic = TOPIC) =>
    p({
      state: 'PARTIAL',
      total: 2,
      committed: 1,
      effect: { kind, topic, number: 0, targets } as never,
    });
  const tagHold = (saves: SequenceProgress[], things = [THING]) =>
    saveHold(saves, { account: ME, statements: things.map((x) => statementKey(TOPIC, x)) });

  it('a tag, a "Not this" or an untag of the same (topic, thing) holds; case does not matter', () => {
    for (const kind of ['tags.tag', 'tags.deny', 'tags.untag']) {
      expect(tagHold([tagSave(kind, [THING.toUpperCase().replace('0X', '0x')])]).hold).toEqual({
        kind: 'unsettled',
      });
    }
  });

  it('another thing, or another topic, does not wait', () => {
    expect(tagHold([tagSave('tags.tag', [`0x${'5b'.repeat(32)}`])]).hold).toBeUndefined();
    expect(tagHold([tagSave('tags.tag', [THING], `0x${'7b'.repeat(32)}`)]).hold).toBeUndefined();
  });

  it('a tag save and a folder or file save never hold each other; a registration holds nothing', () => {
    const folderSave = p({
      state: 'PARTIAL',
      total: 2,
      committed: 1,
      effect: {
        kind: 'files.create',
        folder: `0x${'d1'.repeat(32)}`,
        name: 'a',
        file: '0x',
        revision: '0x',
      } as never,
    });
    expect(tagHold([folderSave]).hold).toBeUndefined();
    expect(
      saveHold([tagSave('tags.tag', [THING])], {
        account: ME,
        places: [{ folder: `0x${'d1'.repeat(32)}`, name: 'a' }],
      }).hold,
    ).toBeUndefined();
    expect(
      tagHold([
        p({
          state: 'PARTIAL',
          total: 2,
          committed: 1,
          effect: { kind: 'tags.register', topics: [TOPIC] } as never,
        }),
      ]).hold,
    ).toBeUndefined();
  });

  it('a malformed tag effect, or a save with no effect, still holds every statement (fail-closed)', () => {
    expect(tagHold([tagSave('tags.tag', 'x' as never)]).hold).toEqual({ kind: 'unsettled' });
    expect(
      tagHold([p({ state: 'PARTIAL', total: 2, committed: 1, effect: undefined as never })]).hold,
    ).toEqual({
      kind: 'unsettled',
    });
  });
});

describe('twinStanding (a save the SDK held back for an earlier attempt)', () => {
  const TWIN = `0x${'02'.repeat(32)}` as const;
  const twin = { sequenceId: TWIN };
  const FOLDER = `0x${'fd'.repeat(32)}`;
  const OTHER_FOLDER = `0x${'fe'.repeat(32)}`;
  // The earlier save: a big file created at (FOLDER, photo.png).
  const earlier = (over: Partial<SequenceProgress> = {}) =>
    p({
      sequenceId: TWIN,
      state: 'COMPLETE',
      final: false,
      effect: { kind: 'files.create', folder: FOLDER, name: 'photo.png' } as never,
      ...over,
    });
  const elsewhere = touchesOfInput({
    account: ME,
    places: [{ folder: OTHER_FOLDER, name: 'photo.png' }],
  });
  const here = touchesOfInput({ account: ME, places: [{ folder: FOLDER, name: 'photo.png' }] });

  it('the same save again (the same place), or no save named for the twin: "same"', () => {
    expect(twinStanding(twin, [earlier()], here)).toBe('same');
    expect(twinStanding({}, [earlier()], elsewhere)).toBe('same');
    expect(twinStanding(undefined, [], elsewhere)).toBe('same');
    // Matched case-insensitively (hex).
    expect(
      twinStanding({ sequenceId: TWIN.toUpperCase().replace('0X', '0x') }, [earlier()], here),
    ).toBe('same');
  });

  it('another save of the same bytes waits until that one is final, or stopped', () => {
    expect(twinStanding(twin, [earlier()], elsewhere)).toBe('waiting');
    expect(twinStanding(twin, [earlier({ state: 'IN_FLIGHT' })], elsewhere)).toBe('waiting');
    expect(twinStanding(twin, [earlier({ state: 'PARTIAL' })], elsewhere)).toBe('waiting');
    expect(twinStanding(twin, [earlier({ final: true })], elsewhere)).toBe('settled');
    expect(twinStanding(twin, [earlier({ state: 'ABANDONED' })], elsewhere)).toBe('settled');
    // Not listed (another tab's save, or one that dropped off) is unknown, never settled: the
    // caller checks the twin's attempt.
    expect(twinStanding(twin, [], elsewhere)).toBe('unlisted');
  });

  it("fail-closed: saves that can't be read wait; an effect it can't read is the same save", () => {
    expect(twinStanding(twin, undefined, elsewhere)).toBe('waiting');
    expect(twinStanding(twin, [earlier({ effect: undefined } as never)], elsewhere)).toBe('same');
    expect(twinStanding(twin, [earlier()], touchesOf(undefined))).toBe('same');
  });

  it('says which case it is, with the wait on a local test chain', () => {
    expect(heldMessage('same', true)).toBe('save.held');
    expect(heldMessage('waiting', false)).toBe('save.heldSameBytes');
    expect(heldMessage('waiting', true)).toBe('save.heldSameBytesLocal');
    expect(heldMessage('settled', false)).toBe('save.heldSettled');
    expect(heldMessage('unlisted', true)).toBe('save.heldSameBytesLocal');
  });

  it('an unlisted twin is decided by its attempt: final or proven not committed, else it waits', () => {
    expect(twinFromReconcile({ outcome: 'COMMITTED', final: true })).toBe('settled');
    expect(twinFromReconcile({ outcome: 'NOT_COMMITTED_PROVEN' })).toBe('settled');
    expect(twinFromReconcile({ outcome: 'COMMITTED', final: false })).toBe('waiting');
    expect(twinFromReconcile({ outcome: 'COMMITTED' })).toBe('waiting');
    expect(twinFromReconcile({ outcome: 'UNKNOWN' })).toBe('waiting');
  });
});

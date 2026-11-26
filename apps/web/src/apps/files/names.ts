// Names for what a tag lists, from the SDK and never invented (spec §3.7, tags-0.1 §5.5):
//
// - A file in a tag: its tagger's own name for it (their home or a folder they made), else its
//   creator's, else the first Lens author's (`fileNames`). A row with no name shows its short id,
//   never "no name": a null name from a read that wasn't complete isn't proven absent.
// - A tag's words: a path-level label from the Lens, else the word's label in the reader's
//   language, else the word itself (`topicName`). The words stay one click away: the link holds
//   them.
// Reads are batched (fileNames takes at most 32 files a call) and run one after another.

import type { Efs, Lens } from '@efs/sdk';
import type { FileNameRow, SegmentName, TopicRow } from '@efs/sdk/tags';

const loadTags = async () => import('@efs/sdk/tags');

/** fileNames' own bound: at most this many files a call. */
const NAMES_PER_CALL = 32;

/** A thing's name as read: the SDK's row, or null when the read failed (nothing decided). */
export type NameRead = FileNameRow | null;

/**
 * Names for the rows' things that aren't in `known` yet, by thing (lowercase). The row's Lens
 * decider is its tagger; public and Raw rows have none.
 */
export async function readFileNames(
  efs: Efs,
  rows: readonly TopicRow[],
  known: ReadonlyMap<string, NameRead>,
  lens: Lens | undefined,
  signal: AbortSignal,
): Promise<Map<string, NameRead>> {
  const out = new Map<string, NameRead>();
  const wanted = new Map<string, TopicRow>();
  for (const row of rows) {
    const id = row.thing.toLowerCase();
    if (!known.has(id) && !wanted.has(id)) wanted.set(id, row);
  }
  if (wanted.size === 0) return out;
  const { fileNames } = await loadTags();
  const list = [...wanted.values()];
  for (let i = 0; i < list.length; i += NAMES_PER_CALL) {
    const batch = list.slice(i, i + NAMES_PER_CALL);
    const answer = await fileNames(
      efs,
      batch.map((row) => ({
        file: row.thing,
        ...(row.decider.kind === 'lens' ? { tagger: row.decider.author } : {}),
      })),
      { ...(lens ? { lens } : {}), signal },
    ).catch(() => undefined);
    if (signal.aborted) return out;
    if (answer?.status === 'PRESENT') {
      for (const r of answer.rows) out.set(r.file.toLowerCase(), r);
    }
    // A failed batch names nothing (null): the rows keep their short ids, never "no name".
    for (const row of batch) {
      const id = row.thing.toLowerCase();
      if (!out.has(id)) out.set(id, null);
    }
  }
  return out;
}

/** What a row shows for its thing: its name when one was found, else undefined (its short id). */
export function nameOf(names: ReadonlyMap<string, NameRead>, thing: string): string | undefined {
  return names.get(thing.toLowerCase())?.name?.text;
}

/** The reader's languages for labels, most preferred first (BCP 47, lowercased, at most 8). */
export function readerLangs(locale: string): string[] {
  const all = [locale, ...(typeof navigator !== 'undefined' ? navigator.languages : []), 'en'].map(
    (l) => l.toLowerCase(),
  );
  return [...new Set(all.filter((l) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)))].slice(0, 8);
}

/** A tag's words as names: each segment's label, or the word itself. */
export async function readTopicName(
  efs: Efs,
  words: readonly string[],
  lens: Lens | undefined,
  langs: readonly string[],
  signal: AbortSignal,
): Promise<readonly SegmentName[] | undefined> {
  const { topicName } = await loadTags();
  const answer = await topicName(efs, words, {
    langs,
    ...(lens ? { lens } : {}),
    signal,
  }).catch(() => undefined);
  return answer?.status === 'PRESENT' ? answer.segments : undefined;
}

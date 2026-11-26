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
 * A row's name key: the thing and its tagger (the row's Lens decider, if any). A name read for one
 * tagger's row is never shown on another's: the tagger's own entry is the first choice, so the
 * same file can be named differently in two rows.
 */
export function nameKey(row: Pick<TopicRow, 'thing' | 'decider'>): string {
  const tagger = row.decider.kind === 'lens' ? row.decider.author.toLowerCase() : '';
  return `${row.thing.toLowerCase()}|${tagger}`;
}

/**
 * Names for the rows not in `known` yet, by nameKey. The row's Lens decider is its tagger; public
 * and Raw rows have none.
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
    const key = nameKey(row);
    if (!known.has(key) && !wanted.has(key)) wanted.set(key, row);
  }
  if (wanted.size === 0) return out;
  const { fileNames } = await loadTags();
  const list = [...wanted.entries()];
  for (let i = 0; i < list.length; i += NAMES_PER_CALL) {
    const batch = list.slice(i, i + NAMES_PER_CALL);
    const answer = await fileNames(
      efs,
      batch.map(([, row]) => ({
        file: row.thing,
        ...(row.decider.kind === 'lens' ? { tagger: row.decider.author } : {}),
      })),
      { ...(lens ? { lens } : {}), signal },
    ).catch(() => undefined);
    if (signal.aborted) return out;
    // One answer row per input, in order (checked by file): a mismatch names nothing.
    batch.forEach(([key, row], at) => {
      const r = answer?.status === 'PRESENT' ? answer.rows[at] : undefined;
      out.set(key, r && r.file.toLowerCase() === row.thing.toLowerCase() ? r : null);
    });
  }
  return out;
}

/** What a row shows for its thing: its name when one was found, else undefined (its short id). */
export function nameOf(
  names: ReadonlyMap<string, NameRead>,
  row: Pick<TopicRow, 'thing' | 'decider'>,
): string | undefined {
  return names.get(nameKey(row))?.name?.text;
}

/** The reader's languages for labels, most preferred first (BCP 47, lowercased, at most 8). */
export function readerLangs(locale: string): string[] {
  const all = [locale, ...(typeof navigator !== 'undefined' ? navigator.languages : []), 'en'].map(
    (l) => l.toLowerCase(),
  );
  return [...new Set(all.filter((l) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)))].slice(0, 8);
}

/**
 * The connected person's own name for a tag in `lang` (labelOf in a Lens of just them): its text,
 * null when they have none (proven), undefined when it couldn't be read.
 */
export async function readMyLabel(
  efs: Efs,
  words: readonly string[],
  reader: string,
  lang: string,
  signal: AbortSignal,
): Promise<string | null | undefined> {
  const { labelOf } = await loadTags();
  const lens = efs.lens.from([reader as never]);
  const answer = await labelOf(efs, words, { lens, langs: [lang], signal }).catch(() => undefined);
  if (answer?.status === 'PRESENT') return answer.label.text;
  return answer?.status === 'ABSENT_PROVEN' ? null : undefined;
}

/** A language's name in the reader's own language ("English"), else its tag ("en"). */
export function languageName(lang: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
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

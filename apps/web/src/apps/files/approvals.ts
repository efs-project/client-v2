// How many approvals a save asks of the wallet, in words, from the review's own counts
// (review.prompts) and nothing else: one per part, and, only when a wallet that sends batches
// would be asked fewer times, that count too (sdk-v2 ff3ebe8 packs parts by gas, so for content
// saves it is usually the same).

import type { Translator } from '../../ui/i18n.ts';

export function approvalsLine(
  t: Translator['t'],
  prompts: { readonly sequential: number; readonly atomicBatch: number },
): string {
  if (prompts.sequential === 1) return t('review.promptsOne');
  return prompts.atomicBatch < prompts.sequential
    ? t('review.promptsBatch', { count: prompts.sequential, batch: prompts.atomicBatch })
    : t('review.promptsMany', { count: prompts.sequential });
}

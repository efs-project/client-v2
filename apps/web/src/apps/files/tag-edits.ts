// Tag lists read again after a tag save settles (PM, 2026-11-26). The Preview's Tags section
// read once when opened, so a tag saved (or taken back) while the file stayed open didn't show
// until a reload: a save that confirmed but read stale, the class this app guards against.
// Counted once each tag save is no longer in flight: committed, stopped, or no longer listed.
// Also counted when the tab becomes visible again: the saves list isn't shared live across tabs
// (the journal is read on refresh), so a tag saved in another tab is read on coming back.

import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { FOLDER_SAVED_EVENT, type FolderSavedDetail } from './folder-save.ts';

/** Saves that change what a thing is tagged with, or a tag's names and links. */
const TAG_REQUESTS = new Set(['tag', 'label', 'same', 'broader']);

/** A count that moves each time a tag save from this tab settles. */
export function watchTagSaves(host: AppHost, scope: OwnerScope): ReadonlySignal<number> {
  const edits = state(0);
  const pending = new Set<string>();
  const settle = (saves: ReturnType<AppHost['saving']['saves']['get']>) => {
    let settled = 0;
    for (const id of [...pending]) {
      const p = saves.find((s) => s.sequenceId.toLowerCase() === id);
      if (p && (p.state === 'IN_FLIGHT' || p.state === 'PARTIAL')) continue;
      pending.delete(id);
      settled++;
    }
    // Never a signal write inside the effect that read the saves.
    if (settled > 0) queueMicrotask(() => edits.set(edits.get() + 1));
  };
  const onSaved = (event: Event) => {
    const detail = (event as CustomEvent<FolderSavedDetail>).detail;
    if (!TAG_REQUESTS.has(detail.request.kind)) return;
    pending.add(detail.sequenceId.toLowerCase());
    queueMicrotask(() => settle(host.saving.saves.get()));
  };
  document.addEventListener(FOLDER_SAVED_EVENT, onSaved);
  scope.defer(() => document.removeEventListener(FOLDER_SAVED_EVENT, onSaved));
  const onVisible = () => {
    if (document.visibilityState === 'visible') edits.set(edits.get() + 1);
  };
  document.addEventListener('visibilitychange', onVisible);
  scope.defer(() => document.removeEventListener('visibilitychange', onVisible));
  effect(scope, () => {
    const saves = host.saving.saves.get();
    if (pending.size > 0) settle(saves);
  });
  return edits;
}

// Keeping a folder listing in step with saves: which saves touch the folder on screen, whether a
// listing already shows a save's effect (else the RPC that answered was behind: read again), and
// the names still being created here ("Saving" rows). Pure, so each rule is tested.

import type { SequenceProgress } from '@efs/sdk/actions';
import type { FolderRow } from '@efs/sdk/files';

type Effect = SequenceProgress['effect'];
const same = (a: unknown, b: string) =>
  typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

/** Whether `effect` names `folder` (a files-directory/1 record id), at either end of a move. */
export function touchesFolder(effect: Effect, folder: string): boolean {
  const e = effect as Record<string, unknown> | undefined;
  switch (e?.kind) {
    case 'files.create':
    case 'files.createFolder':
      return same(e.folder, folder);
    case 'files.move':
      return (
        Array.isArray(e.moves) &&
        (e.moves as Record<string, unknown>[]).some(
          (m) => same(m.folder, folder) || same(m.toFolder, folder),
        )
      );
    case 'files.remove':
    case 'files.restore':
    case 'files.unhide':
    case 'files.hide':
      return (
        Array.isArray(e.entries) &&
        (e.entries as Record<string, unknown>[]).some((x) => same(x.folder, folder))
      );
    default:
      return false;
  }
}

/**
 * Whether a listing of `folder` already shows `effect` as its signer (`me`, a principal) saved it.
 * False means the endpoint answered from before the save: read again. Unknown effects are
 * "shown" (nothing to wait for).
 */
export function showsEffect(
  effect: Effect,
  folder: string,
  rows: readonly FolderRow[],
  me: string,
): boolean {
  const mine = (name: string) =>
    rows.some((r) => r.name === name && r.author.toLowerCase() === me.toLowerCase());
  const e = effect as Record<string, unknown> | undefined;
  switch (e?.kind) {
    case 'files.create':
    case 'files.createFolder':
      return !same(e.folder, folder) || mine(String(e.name));
    case 'files.restore':
      return (e.entries as Record<string, unknown>[]).every(
        (x) => !same(x.folder, folder) || mine(String(x.name)),
      );
    case 'files.remove':
      return (e.entries as Record<string, unknown>[]).every(
        (x) => !same(x.folder, folder) || !mine(String(x.name)),
      );
    case 'files.hide':
      // A block covers someone else's entry: shown once nothing is listed at the name.
      return (e.entries as Record<string, unknown>[]).every(
        (x) => !same(x.folder, folder) || !rows.some((r) => r.name === String(x.name)),
      );
    case 'files.move':
      return (e.moves as Record<string, unknown>[]).every(
        (m) =>
          (!same(m.toFolder, folder) || mine(String(m.toName))) &&
          (!same(m.folder, folder) ||
            (same(m.toFolder, folder) && m.toName === m.name) ||
            !mine(String(m.name))),
      );
    default:
      return true;
  }
}

/** Names an unsettled save is creating in `folder` that the listing doesn't show yet. */
export function pendingCreates(
  saves: readonly SequenceProgress[],
  folder: string,
  rows: readonly FolderRow[],
  isUnsettled: (p: SequenceProgress) => boolean,
): readonly { readonly name: string; readonly kind: 'folder' | 'file' }[] {
  const shown = new Set(rows.map((r) => r.name));
  const out: { name: string; kind: 'folder' | 'file' }[] = [];
  for (const p of saves) {
    if (!isUnsettled(p)) continue;
    const e = p.effect as Record<string, unknown> | undefined;
    if (
      (e?.kind === 'files.create' || e?.kind === 'files.createFolder') &&
      same(e.folder, folder)
    ) {
      const name = String(e.name);
      if (!shown.has(name) && !out.some((x) => x.name === name)) {
        out.push({ name, kind: e.kind === 'files.createFolder' ? 'folder' : 'file' });
      }
    }
  }
  return out;
}

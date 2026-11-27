// The tag dialogs' path field (apps/files/tag-picker.ts) looks the typed word up 300 ms after
// typing, and a newer word cancels an older read. A test that types and moves on before that read
// is done sends it on a slow run and not on a fast one, so a replay misses it (CI 45944700804:
// "notes" on Firefox; PM, 2026-11-27). So every fill of the field goes through fillTagPath, which
// waits for the picker to finish, and tools/checks/e2e-debounced.test.ts keeps the field's
// selector out of every other test file.

import { expect, type Locator } from '@playwright/test';

/** The path field of a tag dialog (`dialog`): its wa-input, for its own attributes. */
export const tagPathField = (dialog: Locator): Locator => dialog.locator('wa-input.efs-tag-path');

/**
 * Types `text` into a tag dialog's path field, then waits until no picker is reading: its lookup
 * of the last word (or none, for a word it refuses) is done, in every run, at any speed.
 */
export async function fillTagPath(dialog: Locator, text: string): Promise<void> {
  await tagPathField(dialog).locator('input').fill(text);
  await expect(dialog.page().locator('efs-files-tag-picker[data-reading]')).toHaveCount(0);
}

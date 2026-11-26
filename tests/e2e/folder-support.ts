// Shared steps for the folder tests (folder-writes.spec.ts, a11y-files.spec.ts): the page's
// seeded randomness, opening the realm root connected as anvil #6, entries prepared from Node,
// and the listing's and dialogs' locators. The chain and wallet come from chain.ts.

import type { Page } from '@playwright/test';
import type { TestChain } from './chain.ts';
import { expect } from './edit-support.ts';
import { press } from './press.ts';
import { booted, serveConfig, serveDeployment } from './support.ts';

export const entries = (page: Page) => page.locator('efs-files-listing');
export const row = (page: Page, name: string) =>
  entries(page).locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
/** The folder listing's dialog (the Preview and a tag's list have their own, for tags). */
export const dialog = (page: Page) => page.locator('efs-files-listing wa-dialog.efs-folder-save');
export const send = (page: Page) => dialog(page).locator('wa-button.efs-folder-send');

/**
 * New files and folders get a random CREATE salt, which is in the planner's reads and the signed
 * transaction: a replay can only match a recording if the page draws the same bytes. So this spec
 * seeds the page's crypto.getRandomValues with a fixed sequence (record and replay alike). The
 * app is unchanged; nothing here is a protocol stand-in.
 */
export async function seededRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The generator's state lives in the tab's sessionStorage, so a reload continues the sequence
    // and a reload-then-create can never reuse a salt.
    const KEY = 'efs-test-rng';
    let x = Number(sessionStorage.getItem(KEY) ?? 0x2545f491) | 0 || 0x2545f491;
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (!array) return array;
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        bytes[i] = x & 0xff;
      }
      sessionStorage.setItem(KEY, String(x));
      return array;
    };
  });
}

export async function openRoot(page: Page, chain: TestChain): Promise<void> {
  await seededRandom(page);
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await page.goto('./#/r/testnet/');
  await booted(page);
  await expect(row(page, 'docs')).toBeVisible();
  await press(page.locator('efs-wallet wa-button.efs-wallet-button'));
  await expect(page.locator('wa-dialog.efs-wallet-dialog')).toContainText(
    /Your wallet is on .*Testnet/,
  );
  await page.keyboard.press('Escape');
  chain.step('Open the realm root; connect as anvil #6');
}

/** A text file `name` at the realm root, created from Node as anvil `index`. */
export async function fileAtRoot(chain: TestChain, index: number, name: string, text: string) {
  await chain.actAs?.(index, async ({ files, root, lens, writer, efs, save: done }) => {
    const review = (await done(
      await files.planCreateFile(efs, writer, {
        folder: root,
        name,
        content: new TextEncoder().encode(text),
        lens,
      }),
    )) as { file: { subject: string } };
    return { [`${name}@${index}`]: review.file.subject };
  });
}

/** inbox/ and archive/ by anvil #6 at the root; note.txt and sub/ inside inbox/. */
export async function withInbox(chain: TestChain): Promise<void> {
  await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
    const folderIn = async (parent: import('@efs/sdk/files').FolderRef, name: string) =>
      (
        (await done(await files.planCreateFolder(efs, writer, { folder: parent, name, lens }))) as {
          created: import('@efs/sdk/files').FolderRef;
        }
      ).created;
    const inbox = await folderIn(root, 'inbox');
    await folderIn(root, 'archive');
    await done(
      await files.planCreateFile(efs, writer, {
        folder: inbox,
        name: 'note.txt',
        content: new TextEncoder().encode('note\n'),
        lens,
      }),
    );
    await folderIn(inbox, 'sub');
  });
}

export const picker = (page: Page) => page.locator('efs-files-folder-picker');
export const pickerRow = (page: Page, name: string) =>
  picker(page).locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
export const moveHere = (page: Page) => dialog(page).locator('wa-button.efs-move-here');

// Folder operations, writes: New folder, Rename, Remove (a release) and Restore, through the
// folder dialog and the same review → send → banner path as edits. The test wallet is anvil #6;
// the realm root's owner and the default Lens are anvil #0. Entries are prepared from Node in live
// and record mode; the replay carries the result.

import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import { expect, objectLink, preview, save, sendRequests } from './edit-support.ts';
import { booted, serveConfig, serveDeployment } from './support.ts';

const entries = (page: Page) => page.locator('efs-files-listing');
const row = (page: Page, name: string) =>
  entries(page).locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
const dialog = (page: Page) => page.locator('wa-dialog.efs-folder-save');
const send = (page: Page) => dialog(page).locator('wa-button.efs-folder-send');

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

/**
 * New files and folders get a random CREATE salt, which is in the planner's reads and the signed
 * transaction: a replay can only match a recording if the page draws the same bytes. So this spec
 * seeds the page's crypto.getRandomValues with a fixed sequence (record and replay alike). The
 * app is unchanged; nothing here is a protocol stand-in.
 */
async function seededRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let x = 0x2545f491;
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (!array) return array;
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        bytes[i] = x & 0xff;
      }
      return array;
    };
  });
}

async function openRoot(page: Page, chain: TestChain): Promise<void> {
  await seededRandom(page);
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await page.goto('./#/r/testnet/');
  await booted(page);
  await expect(row(page, 'docs')).toBeVisible();
  await page.locator('efs-wallet wa-button.efs-wallet-button').click();
  await expect(page.locator('wa-dialog.efs-wallet-dialog')).toContainText(
    /Your wallet is on .*Testnet/,
  );
  await page.keyboard.press('Escape');
  chain.step('Open the realm root; connect as anvil #6');
}

/** A text file `name` at the realm root, created from Node as anvil `index`. */
async function fileAtRoot(chain: TestChain, index: number, name: string, text: string) {
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

test('New folder: bad names are refused as typed; then name, review, one send, and it appears as yours', async ({
  page,
}) => {
  const chain = await testChain('client-folder-create', 'The realm root, then a new folder.');
  try {
    await openRoot(page, chain);
    await entries(page).locator('wa-button.efs-new-folder').click();
    const name = dialog(page).locator('wa-input.efs-folder-name');
    await expect(name).toBeFocused();
    // checkName, as typed: Review stays off for a refused name.
    await name.locator('input').fill('projects ');
    await expect(dialog(page)).toContainText("A name can't start or end with a space.");
    await expect(dialog(page).locator('wa-button.efs-folder-review')).toHaveAttribute(
      'disabled',
      '',
    );
    await name.locator('input').fill('..');
    await expect(dialog(page)).toContainText('A name can\'t be "." or "..".');
    await name.locator('input').fill('projects');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await expect(dialog(page)).toContainText(/Creates the folder\W+projects\W+in\W+Root/);
    await expect(dialog(page)).toContainText('One approval in your wallet.');
    chain.step('New folder "projects": checkName, then planCreateFolder in the place Lens');
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(save(page, 'saved').or(save(page, 'confirming'))).toBeVisible();
    await expect(row(page, 'projects').locator('.efs-entry-whose')).toHaveText('yours');
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Send: one approval; the listing reads again once it is on the ledger');
  } finally {
    await chain.finish();
  }
});

test('a name you already use here is refused with its own words, and nothing is planned or sent', async ({
  page,
}) => {
  const chain = await testChain('client-folder-taken', 'projects/ by anvil #6 at the root.');
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      await done(
        await files.planCreateFolder(efs, writer, { folder: root, name: 'projects', lens }),
      );
    });
    await openRoot(page, chain);
    await expect(row(page, 'projects').locator('.efs-entry-whose')).toHaveText('yours');
    await entries(page).locator('wa-button.efs-new-folder').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('projects');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await expect(dialog(page).locator('.efs-folder-refused')).toContainText(
      /You already have something called\W+projects\W+here/,
    );
    await expect(send(page)).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('New folder "projects" again: NAME_TAKEN_MINE, nothing sent');
  } finally {
    await chain.finish();
  }
});

test('Rename: the review says links keep working and what the old name shows after; the file link still opens it', async ({
  page,
}) => {
  const chain = await testChain('client-folder-rename', 'draft.txt by anvil #6 at the root.');
  try {
    await fileAtRoot(chain, 6, 'draft.txt', 'first words\n');
    await openRoot(page, chain);
    await expect(row(page, 'draft.txt').locator('.efs-entry-whose')).toHaveText('yours');
    // Another author's entries have no Rename or Remove.
    await expect(row(page, 'docs').locator('wa-button.efs-entry-rename')).toHaveCount(0);
    await row(page, 'draft.txt').locator('wa-button.efs-entry-rename').click();
    const name = dialog(page).locator('wa-input.efs-folder-name input');
    await expect(name).toHaveValue('draft.txt');
    await name.fill('final.txt');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await expect(dialog(page)).toContainText(
      /Rename\W+draft\.txt\W+to\W+final\.txt\W+Links to it keep working/,
    );
    await expect(dialog(page)).toContainText(/nothing is called\W+draft\.txt\W+here/);
    chain.step('Rename draft.txt to final.txt: planMoveEntries with a new name');
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'final.txt')).toBeVisible();
    await expect(row(page, 'draft.txt')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
    // Links to the file keep working: it opens from its row, by its permanent link, in the Lens
    // the row was shown in.
    await row(page, 'final.txt').getByRole('link').click();
    await expect
      .poll(() => new URL(page.url()).hash)
      .toContain(objectLink(chain.ids['draft.txt@6'] as string).split('?')[0] as string);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('first words\n');
  } finally {
    await chain.finish();
  }
});

test("Remove releases: the dialog says the owner's same-named file will show; it does; Restore brings yours back", async ({
  page,
}) => {
  const chain = await testChain(
    'client-folder-remove-restore',
    'shared.txt at the root by anvil #0 (the owner) and by anvil #6.',
  );
  try {
    await fileAtRoot(chain, 0, 'shared.txt', "the owner's\n");
    await fileAtRoot(chain, 6, 'shared.txt', 'mine\n');
    await openRoot(page, chain);
    // The place Lens puts the reader first: yours shows.
    await expect(row(page, 'shared.txt').locator('.efs-entry-whose')).toHaveText('yours');
    await row(page, 'shared.txt').locator('wa-button.efs-entry-remove').click();
    await expect(dialog(page)).toContainText(/Your\W+shared\.txt\W+stops appearing here/);
    await expect(dialog(page)).toContainText(/After this, this view shows .+shared\.txt\W+here/);
    await expect(dialog(page)).toContainText('This removal is itself public. You can restore it.');
    // Keep it is first: Escape keeps the entry, and nothing is sent.
    await expect(dialog(page).locator('wa-button.efs-folder-keep')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Remove, then Escape: kept, nothing sent');

    await row(page, 'shared.txt').locator('wa-button.efs-entry-remove').click();
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    // The owner's shared.txt shows through (their own rows carry no label).
    await expect(row(page, 'shared.txt').locator('.efs-entry-whose')).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /removed\W+shared\.txt/,
    );
    chain.step("Remove: a release; the owner's shared.txt shows through");

    await entries(page).locator('wa-button.efs-entries-restore').click();
    await expect(dialog(page)).toContainText(/Restore\W+shared\.txt\W+here/);
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'shared.txt').locator('.efs-entry-whose')).toHaveText('yours');
    expect(sendRequests(chain)).toHaveLength(2);
    chain.step('Restore: yours is back, first in the place Lens');
  } finally {
    await chain.finish();
  }
});

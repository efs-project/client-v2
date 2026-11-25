// Folder operations, writes: New folder, Rename, Remove (a release) and Restore, through the
// folder dialog and the same review → send → banner path as edits. The test wallet is anvil #6;
// the realm root's owner and the default Lens are anvil #0. Entries are prepared from Node in live
// and record mode; the replay carries the result.

import { AxeBuilder } from '@axe-core/playwright';
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

test('a send the wallet refuses says so in the dialog; nothing is saved, and Send again sends it', async ({
  page,
}) => {
  const chain = await testChain('client-folder-refused', 'New folder, refused once in the wallet.');
  try {
    await openRoot(page, chain);
    await entries(page).locator('wa-button.efs-new-folder').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('kept');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    chain.refuseSend(1);
    await send(page).click();
    await expect(dialog(page).locator('.efs-review-not-sent')).toContainText(
      'You declined in your wallet. Nothing was saved.',
    );
    expect(chain.broadcasts).toHaveLength(0);
    await expect(row(page, 'kept')).toHaveCount(0);
    chain.step('Send: the wallet refuses (4001); nothing broadcast');
    await expect(send(page)).toContainText('Send again');
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'kept').locator('.efs-entry-whose')).toHaveText('yours');
    expect(chain.broadcasts).toHaveLength(1);
    chain.step('Send again: the same save, one broadcast');
  } finally {
    await chain.finish();
  }
});

test('storage lost right after a send: "couldn\'t confirm", never "nothing was saved", never sent twice', async ({
  page,
}) => {
  const chain = await testChain(
    'client-folder-unconfirmed',
    'New folder; IndexedDB writes fail right after the wallet broadcasts. The dialog says it could not confirm and pauses that name; once storage is back the banner settles it.',
  );
  try {
    await openRoot(page, chain);
    await entries(page).locator('wa-button.efs-new-folder').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('lost');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await chain.breakJournalAfterSend(page);
    await send(page).click();
    // Never "nothing was saved": it may have gone out.
    await expect(dialog(page)).toContainText("We couldn't confirm this save yet. Checking…");
    await expect(dialog(page)).not.toContainText('Nothing was saved');
    chain.step('Send: broadcast; the journal write after it fails (thrown, may have sent)');
    await dialog(page).locator('wa-button', { hasText: 'Close' }).click();
    // (The pause itself is unit-tested in folderHold: here the folder already landed, so a new
    // plan for the same name is refused as taken before any hold applies.)
    await chain.restoreJournal(page);
    chain.step('Storage back: the banner settles the save from the ledger');
    await expect(save(page, 'confirming').or(save(page, 'saved'))).toBeVisible({ timeout: 20_000 });
    await expect(row(page, 'lost').locator('.efs-entry-whose')).toHaveText('yours');
    expect(sendRequests(chain), 'sent exactly once').toHaveLength(1);
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
    // The Lens it was listed in stays in the tab's memory: the URL is a clean object link that
    // never carries the person's trust list.
    expect(new URL(page.url()).hash).not.toContain('lens=');
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

test('Show removed lists only your removed entries here; Restore puts one back, a folder only with its path', async ({
  page,
}) => {
  const chain = await testChain(
    'client-folder-show-removed',
    'outer/ by anvil #6 at the root, holding old.txt and inner/, both removed by anvil #6.',
  );
  // The listing's rows, and the removed list's (it sits inside the listing).
  const listed = (name: string) =>
    entries(page).locator('.efs-entry:not(.efs-entry-removed)', {
      has: page.locator('.efs-entry-name', { hasText: name }),
    });
  const removedList = page.locator('efs-files-removed');
  const removedRow = (name: string) =>
    removedList.locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const outer = (
        (await done(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'outer', lens }),
        )) as { created: import('@efs/sdk/files').FolderRef }
      ).created;
      await done(
        await files.planCreateFile(efs, writer, {
          folder: outer,
          name: 'old.txt',
          content: new TextEncoder().encode('old\n'),
          lens,
        }),
      );
      await done(await files.planCreateFolder(efs, writer, { folder: outer, name: 'inner', lens }));
      await done(
        await files.planRemoveEntries(efs, writer, {
          entries: [
            { folder: outer, name: 'old.txt' },
            { folder: outer, name: 'inner' },
          ],
          lens,
        }),
      );
      return { outer: outer.directory };
    });
    await openRoot(page, chain);
    await entries(page).locator('wa-switch.efs-show-removed').click();
    // Said only because the whole list was read (COMPLETE): outer/ is yours, and still here.
    await expect(removedList).toContainText("You haven't removed anything here.");
    chain.step('Show removed at the root: you have removed nothing here');

    await listed('outer').locator('button.efs-entry-open').click();
    await expect(removedList.locator('.efs-entry')).toHaveCount(2);
    await expect(removedRow('old.txt')).toContainText('Removed');
    await expect(removedRow('inner')).toContainText('Removed');
    await expect(listed('old.txt')).toHaveCount(0);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-listing')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('Open outer/: old.txt and inner/ are listed as removed by you');

    // The same folder opened by its link: no trail, so no path to restore a folder by. Each move
    // waits for the folder's reads to settle, so a replay sees the calls in the recorded order.
    const atRoot = async () => {
      await page.locator('wa-breadcrumb wa-breadcrumb-item').first().click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/');
      await expect(listed('outer')).toBeVisible();
      await expect(removedList).toContainText("You haven't removed anything here.");
    };
    await atRoot();
    await page.evaluate(
      (hash) => {
        location.hash = hash;
      },
      `#/r/testnet/${objectLink(chain.ids.outer as string)}`,
    );
    await expect(removedRow('inner')).toContainText(
      'Open this folder from the root to restore a folder here.',
    );
    await expect(removedRow('inner').locator('wa-button.efs-removed-restore')).toHaveAttribute(
      'disabled',
      '',
    );
    await expect(
      removedRow('old.txt').locator('wa-button.efs-removed-restore'),
    ).not.toHaveAttribute('disabled');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step(
      "outer/ opened by its link: a folder can't be restored without its path; a file can",
    );

    // From the root again: the path is known, and the folder restores.
    await atRoot();
    await listed('outer').locator('button.efs-entry-open').click();
    await expect(removedRow('inner').locator('wa-button.efs-removed-restore')).not.toHaveAttribute(
      'disabled',
    );
    await removedRow('inner').locator('wa-button.efs-removed-restore').click();
    await expect(dialog(page)).toContainText(/Restore\W+inner\W+here/);
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(listed('inner')).toBeVisible();
    await expect(removedRow('inner')).toHaveCount(0);
    await expect(removedRow('old.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Restore inner/ from the list: it is back, and no longer listed as removed');
  } finally {
    await chain.finish();
  }
});

/** inbox/ and archive/ by anvil #6 at the root; note.txt and sub/ inside inbox/. */
async function withInbox(chain: TestChain): Promise<void> {
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

const picker = (page: Page) => page.locator('efs-files-folder-picker');
const pickerRow = (page: Page, name: string) =>
  picker(page).locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
const moveHere = (page: Page) => dialog(page).locator('wa-button.efs-move-here');

test('Move a file: the picker opens where it is, walks by names, and it lands in the folder picked', async ({
  page,
}) => {
  const chain = await testChain('client-folder-move-file', 'inbox/{note.txt, sub/} and archive/.');
  try {
    await withInbox(chain);
    await openRoot(page, chain);
    await row(page, 'inbox').locator('button.efs-entry-open').click();
    await expect(row(page, 'note.txt')).toBeVisible();
    await row(page, 'note.txt').locator('wa-button.efs-entry-move').click();
    await expect(dialog(page)).toContainText(/Move\W+note\.txt\W+to…/);
    // It opens in inbox/, where note.txt already is: not a destination.
    await expect(pickerRow(page, 'sub')).toBeVisible();
    await expect(dialog(page)).toContainText("It's already in this folder.");
    await expect(moveHere(page)).toHaveAttribute('disabled', '');
    chain.step('Move note.txt: the picker opens in inbox/, where it already is');

    await picker(page).locator('wa-breadcrumb-item').first().click();
    await expect(pickerRow(page, 'archive')).toBeVisible();
    await pickerRow(page, 'archive').locator('button.efs-entry-open').click();
    await expect(picker(page)).toContainText('No folders in here.');
    await expect(moveHere(page)).not.toHaveAttribute('disabled');
    chain.step('Up to the root, into archive/: no folders in it, and it can take note.txt');

    await moveHere(page).click();
    await expect(dialog(page)).toContainText(/Move\W+note\.txt\W+to\W+archive/);
    await expect(dialog(page)).toContainText(/Your entry appears in\W+archive/);
    await expect(dialog(page)).not.toContainText('Checked under this lens');
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'note.txt')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Review and send: note.txt leaves inbox/');

    await page.locator('efs-files-view wa-breadcrumb-item').first().click();
    await expect(row(page, 'archive')).toBeVisible();
    await row(page, 'archive').locator('button.efs-entry-open').click();
    await expect(row(page, 'note.txt').locator('.efs-entry-whose')).toHaveCount(0);
    await expect(row(page, 'note.txt')).toBeVisible();
    chain.step('archive/ lists note.txt');
  } finally {
    await chain.finish();
  }
});

test("Move a folder: it can't be opened in the picker, its path travels with it, and the review says how far that was checked", async ({
  page,
}) => {
  const chain = await testChain(
    'client-folder-move-folder',
    'inbox/{note.txt, sub/} and archive/.',
  );
  try {
    await withInbox(chain);
    await openRoot(page, chain);
    await row(page, 'inbox').locator('button.efs-entry-open').click();
    await expect(row(page, 'sub')).toBeVisible();
    await row(page, 'sub').locator('wa-button.efs-entry-move').click();
    await expect(pickerRow(page, 'sub')).toContainText("This is the folder you're moving.");
    await expect(pickerRow(page, 'sub').locator('button.efs-entry-open')).toBeDisabled();
    chain.step('Move sub/: in the picker, sub/ itself is shown but not opened');

    await picker(page).locator('wa-breadcrumb-item').first().click();
    await expect(pickerRow(page, 'archive')).toBeVisible();
    await pickerRow(page, 'archive').locator('button.efs-entry-open').click();
    await expect(picker(page)).toContainText('No folders in here.');
    await moveHere(page).click();
    await expect(dialog(page)).toContainText(/Move\W+sub\W+to\W+archive/);
    await expect(dialog(page)).toContainText(
      "Checked under this lens: the destination isn't inside this folder.",
    );
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'sub')).toHaveCount(0);
    await expect(row(page, 'note.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Into archive/, with its path: sub/ leaves inbox/');
  } finally {
    await chain.finish();
  }
});

const editorFor = (page: Page) => preview(page).locator('efs-file-editor');

test('New text file: name it, write it, leave and come back to it, save it, and it opens by its link', async ({
  page,
}) => {
  const chain = await testChain('client-new-text-file', 'The realm root; a new hello.txt.');
  try {
    await openRoot(page, chain);
    await entries(page).locator('wa-button.efs-new-file').click();
    await expect(dialog(page)).toContainText('New text file');
    await dialog(page).locator('wa-input.efs-folder-name input').fill('hello.txt');
    await dialog(page).locator('wa-button.efs-folder-write').click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(editorFor(page)).toContainText('A new text file in');
    // Focus lands in the text, not back on the toolbar (the dialog gives focus back as it closes).
    await expect(editorFor(page).locator('textarea.efs-edit-text')).toBeFocused();
    await expect(editorFor(page).locator('wa-input.efs-new-name')).toHaveJSProperty(
      'value',
      'hello.txt',
    );
    await editorFor(page).locator('textarea.efs-edit-text').fill('Hello, world.\n');
    chain.step('New text file: named hello.txt, then written in the editor');

    // Leaving keeps it: the folder offers it back, unsaved, with its text.
    await row(page, 'docs').locator('button.efs-entry-open').click();
    await expect(editorFor(page)).toHaveCount(0);
    await page.locator('efs-files-view wa-breadcrumb-item').first().click();
    await expect(row(page, 'docs')).toBeVisible();
    const unsaved = entries(page).locator('.efs-entry-unsaved');
    await expect(unsaved).toContainText('hello.txt');
    await expect(unsaved).toContainText('Not saved yet');
    await unsaved.locator('button.efs-entry-open').click();
    await expect(editorFor(page)).toContainText('Your unsaved new file is back.');
    await expect(editorFor(page).locator('textarea.efs-edit-text')).toHaveValue('Hello, world.\n');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Into docs/ and back: hello.txt is offered back, with its text');

    await editorFor(page).locator('wa-button.efs-edit-review-button').click();
    const review = page.locator('wa-dialog.efs-edit-review');
    await expect(review).toContainText(/Creates\W+hello\.txt\W+in/);
    await review.locator('wa-button.efs-review-send').click();
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Hello, world.\n');
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Review and send: once Saved, hello.txt opens by its own link');
  } finally {
    await chain.finish();
  }
});

test('New text file with a name you already use here: refused in its own words, fixed in place, nothing sent', async ({
  page,
}) => {
  const chain = await testChain('client-new-text-file-taken', 'taken.txt by anvil #6 at the root.');
  try {
    await fileAtRoot(chain, 6, 'taken.txt', 'already here\n');
    await openRoot(page, chain);
    await expect(row(page, 'taken.txt')).toBeVisible();
    await entries(page).locator('wa-button.efs-new-file').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('taken.txt');
    await dialog(page).locator('wa-button.efs-folder-write').click();
    await editorFor(page).locator('textarea.efs-edit-text').fill('new words\n');
    await editorFor(page).locator('wa-button.efs-edit-review-button').click();
    await expect(editorFor(page).locator('.efs-new-refused')).toContainText(
      /You already have something called\W+taken\.txt\W+here/,
    );
    chain.step('taken.txt is yours already: refused, with how to go on');

    await editorFor(page).locator('wa-input.efs-new-name input').fill('fresh.txt');
    await expect(editorFor(page).locator('.efs-new-refused')).toHaveCount(0);
    await editorFor(page).locator('wa-button.efs-edit-review-button').click();
    const review = page.locator('wa-dialog.efs-edit-review');
    await expect(review).toContainText(/Creates\W+fresh\.txt\W+in/);
    await review.locator('wa-button', { hasText: 'Cancel' }).first().click();
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Renamed in place to fresh.txt: it plans; Cancel sends nothing');
  } finally {
    await chain.finish();
  }
});

/** At the root: New text file `name`, written with `text`, then Review (the review dialog). */
async function writeNewFile(page: Page, name: string, text: string) {
  await entries(page).locator('wa-button.efs-new-file').click();
  await dialog(page).locator('wa-input.efs-folder-name input').fill(name);
  await dialog(page).locator('wa-button.efs-folder-write').click();
  await editorFor(page).locator('textarea.efs-edit-text').fill(text);
  await editorFor(page).locator('wa-button.efs-edit-review-button').click();
  const review = page.locator('wa-dialog.efs-edit-review');
  await expect(review).toContainText(new RegExp(`Creates\\W+${name.replace('.', '\\.')}\\W+in`));
  return review;
}

/** Two parts: the content, then the finish that binds the name. */
const LARGE_TEXT = `${'x'.repeat(150 * 1024 - 1)}\n`;

test('New text file whose save loses the name to a race: "Review changes" brings it back in the editor at its folder', async ({
  page,
}) => {
  const chain = await testChain(
    'client-new-text-file-reopen',
    'A two-part new big.txt at the root as anvil #6; before Send, #6 creates big.txt elsewhere, so the finish loses the race. Review changes stops the old save and reopens the editor at the root with the text. One eth_sendTransaction.',
  );
  try {
    await openRoot(page, chain);
    const review = await writeNewFile(page, 'big.txt', LARGE_TEXT);
    await expect(review).toContainText('2 approvals in your wallet');
    await fileAtRoot(chain, 6, 'big.txt', 'made elsewhere\n');
    chain.step('Elsewhere: #6 creates big.txt at the root first');
    await review.locator('wa-button.efs-review-send').click();
    const changed = save(page, 'changed');
    await expect(changed.locator('wa-button.efs-save-reopen')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Send: the content lands; the finish loses the name (changed)');

    await changed.locator('wa-button.efs-save-reopen').click();
    await expect(editorFor(page).locator('.efs-edit-reopened')).toBeVisible();
    await expect(editorFor(page).locator('wa-input.efs-new-name')).toHaveJSProperty(
      'value',
      'big.txt',
    );
    await expect(editorFor(page).locator('textarea.efs-edit-text')).toHaveValue(LARGE_TEXT);
    await expect(save(page, 'changed')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('#/r/testnet/');
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Review changes: the old save stops; the editor is back at the root with the text');
  } finally {
    await chain.finish();
  }
});

test('New text file, storage lost right after Send: "couldn\'t confirm", never "nothing was saved", its place held, settled once', async ({
  page,
}) => {
  const chain = await testChain(
    'client-new-text-file-unconfirmed',
    'New note.txt at the root as anvil #6; IndexedDB writes fail right after the wallet broadcasts. The page says it could not confirm the save and holds the place; once storage is back the banner settles it: Saved · confirming. One eth_sendTransaction.',
  );
  try {
    await openRoot(page, chain);
    const review = await writeNewFile(page, 'note.txt', 'kept through it all\n');
    await chain.breakJournalAfterSend(page);
    await review.locator('wa-button.efs-review-send').click();
    chain.step('Send: broadcast; the journal write after it fails (thrown, may have sent)');
    await expect(review.locator('.efs-review-unconfirmed')).toContainText(
      "We couldn't confirm this save yet.",
    );
    await expect(page.getByText(/nothing was saved/i)).toHaveCount(0);
    await review.locator('wa-button[slot="footer"]').click();
    // The text stays, and no new send while it's unconfirmed: the new file's place is held.
    await expect(editorFor(page).locator('textarea.efs-edit-text')).toHaveValue(
      'kept through it all\n',
    );
    await expect(editorFor(page).locator('.efs-edit-blocked')).toBeVisible();
    await expect(editorFor(page).locator('wa-button.efs-edit-review-button')).toHaveAttribute(
      'disabled',
      '',
    );
    await chain.restoreJournal(page);
    chain.step('Storage back: the banner settles the save from the ledger');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming', { timeout: 20_000 });
    await expect(page.getByText(/nothing was saved/i)).toHaveCount(0);
    expect(sendRequests(chain), 'sent exactly once').toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

/** A 1×1 PNG: its signature, not its name, says what it is. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('Upload: a PNG named pic.txt is stored as image/png from its bytes, one send, and previews as an image', async ({
  page,
}) => {
  const chain = await testChain('client-upload', 'The realm root; upload pic.txt (a PNG).');
  try {
    await openRoot(page, chain);
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({ name: 'pic.txt', mimeType: 'text/plain', buffer: PNG_1X1 });
    await expect(dialog(page)).toContainText('Upload a file');
    await expect(dialog(page).locator('wa-input.efs-folder-name')).toHaveJSProperty(
      'value',
      'pic.txt',
    );
    chain.step('Upload: the file is read; named by its own name first');

    await dialog(page).locator('wa-button.efs-folder-review').click();
    await expect(dialog(page)).toContainText(/Uploads\W+pic\.txt\W+to/);
    await expect(dialog(page).locator('.efs-upload-type')).toContainText(
      /Its type, from its contents:\W+image\/png/,
    );
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'pic.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Review (image/png from its bytes, not its name), Send: pic.txt is listed');

    await row(page, 'pic.txt').locator('a.efs-entry-open').click();
    const img = preview(page).locator('img.efs-preview-media');
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
    chain.step('Open it: the Preview shows it as an image');
  } finally {
    await chain.finish();
  }
});

test('Upload: several files at once are refused with a note, and nothing is read or planned', async ({
  page,
}) => {
  const chain = await testChain(
    'client-upload-several',
    'The realm root; two files dropped at once.',
  );
  try {
    await openRoot(page, chain);
    await entries(page)
      .locator('input.efs-upload-input')
      .evaluate((input: HTMLInputElement) => input.setAttribute('multiple', ''));
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles([
        { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
        { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('b') },
      ]);
    await expect(entries(page).locator('.efs-upload-note')).toContainText(
      'Upload one file at a time for now.',
    );
    await expect(dialog(page)).not.toHaveAttribute('open');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Two files at once: said, nothing planned');
  } finally {
    await chain.finish();
  }
});

test('Upload: a file over the limit says how large a file can be saved here, with no retry, and sends nothing', async ({
  page,
}) => {
  const chain = await testChain('client-upload-too-large', 'The realm root; a 1.2 MiB text file.');
  try {
    await openRoot(page, chain);
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({
        name: 'big.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('x'.repeat(1200 * 1024)),
      });
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await expect(dialog(page)).toContainText(
      'This file is too large to save here. Files up to about 1 MB can be saved here for now.',
    );
    await expect(dialog(page).locator('wa-button', { hasText: 'Try again' })).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Review: TOO_LARGE, said with the limit; no retry; nothing sent');
  } finally {
    await chain.finish();
  }
});

const select = (page: Page, name: string) => row(page, name).locator('input.efs-entry-select');
const selection = (page: Page) => entries(page).locator('.efs-selection');

test('Select a file and a folder, Move them into archive: one review lists both, one send, both leave', async ({
  page,
}) => {
  const chain = await testChain('client-select-move', 'inbox/{note.txt, sub/} and archive/.');
  try {
    await withInbox(chain);
    await openRoot(page, chain);
    await row(page, 'inbox').locator('button.efs-entry-open').click();
    await expect(row(page, 'sub')).toBeVisible();
    await select(page, 'note.txt').check();
    await select(page, 'sub').check();
    await expect(selection(page)).toContainText('2 selected');
    const axe = await new AxeBuilder({ page })
      .include('efs-files-listing')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await selection(page).locator('wa-button.efs-selection-move').click();
    await expect(dialog(page)).toContainText(/Move\W+2\W+entries to…/);
    // sub/ is one of the folders moved: shown, never opened.
    await expect(pickerRow(page, 'sub').locator('button.efs-entry-open')).toBeDisabled();
    chain.step('Select note.txt and sub/, Move…: one picker for both');

    await picker(page).locator('wa-breadcrumb-item').first().click();
    await pickerRow(page, 'archive').locator('button.efs-entry-open').click();
    await expect(picker(page)).toContainText('No folders in here.');
    await moveHere(page).click();
    await expect(dialog(page)).toContainText(/Move these\W+2\W+entries to\W+archive/);
    await expect(dialog(page).locator('.efs-folder-items li')).toHaveCount(2);
    await expect(dialog(page)).toContainText('Checked under this lens');
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'note.txt')).toHaveCount(0);
    await expect(row(page, 'sub')).toHaveCount(0);
    await expect(selection(page)).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Into archive/: one review, one send; both leave inbox/');
  } finally {
    await chain.finish();
  }
});

test('a selection with one refused item plans nothing, lists it, and "Leave these out" reviews the rest', async ({
  page,
}) => {
  const chain = await testChain(
    'client-select-refused',
    'inbox/{note.txt, sub/}, and archive/ already holding a note.txt of anvil #6.',
  );
  try {
    await withInbox(chain);
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const page1 = await files.listFolder(efs, root, { lens });
      const archive =
        page1.status === 'PRESENT'
          ? page1.rows.find((r) => r.name === 'archive')?.target
          : undefined;
      if (archive?.kind !== 'folder') throw new Error('archive/ not listed');
      await done(
        await files.planCreateFile(efs, writer, {
          folder: archive,
          name: 'note.txt',
          content: new TextEncoder().encode('already archived\n'),
          lens,
        }),
      );
    });
    await openRoot(page, chain);
    await row(page, 'inbox').locator('button.efs-entry-open').click();
    await expect(row(page, 'sub')).toBeVisible();
    await select(page, 'note.txt').check();
    await select(page, 'sub').check();
    await selection(page).locator('wa-button.efs-selection-move').click();
    await picker(page).locator('wa-breadcrumb-item').first().click();
    await pickerRow(page, 'archive').locator('button.efs-entry-open').click();
    await expect(picker(page)).toContainText('No folders in here.');
    await moveHere(page).click();
    await expect(dialog(page).locator('.efs-folder-refused')).toContainText(
      /You already have something called\W+note\.txt\W+here/,
    );
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('note.txt is taken in archive/: the whole selection is refused, and says which');

    await dialog(page).locator('wa-button.efs-folder-leave-out').click();
    await expect(dialog(page)).toContainText(/Move\W+sub\W+to\W+archive/);
    await expect(dialog(page)).toContainText('Checked under this lens');
    await dialog(page).locator('wa-button', { hasText: 'Cancel' }).first().click();
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Leave these out: sub/ alone is reviewed; Cancel sends nothing');
  } finally {
    await chain.finish();
  }
});

test('Select two files, Remove: one review lists both, one send; the notice offers Restore for both', async ({
  page,
}) => {
  const chain = await testChain('client-select-remove', 'a.txt and b.txt by anvil #6 at the root.');
  try {
    await fileAtRoot(chain, 6, 'a.txt', 'a\n');
    await fileAtRoot(chain, 6, 'b.txt', 'b\n');
    await openRoot(page, chain);
    await select(page, 'a.txt').check();
    await select(page, 'b.txt').check();
    await selection(page).locator('wa-button.efs-selection-remove').click();
    await expect(dialog(page)).toContainText(/Remove\W+2\W+entries from/);
    await expect(dialog(page)).toContainText(/These\W+2\W+entries of yours stop appearing here/);
    await expect(dialog(page).locator('wa-button.efs-folder-keep')).toBeFocused();
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'a.txt')).toHaveCount(0);
    await expect(row(page, 'b.txt')).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /You removed\W+2\W+entries/,
    );
    await expect(entries(page).locator('wa-button.efs-entries-restore')).not.toHaveAttribute(
      'disabled',
    );
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Remove both: one review, one send; "You removed 2 entries" with Restore');
  } finally {
    await chain.finish();
  }
});

const treeFolder = (page: Page, name: string) =>
  page.locator(`efs-files-tree wa-tree-item.efs-tree-folder[data-name="${name}"]`);

test('the folder tree: read as it opens, follows the trail both ways, leaves only when read, keyboard and axe', async ({
  page,
}) => {
  const chain = await testChain('client-folder-tree', 'inbox/{note.txt, sub/} and archive/.');
  try {
    await withInbox(chain);
    await openRoot(page, chain);
    const tree = page.locator('efs-files-tree wa-tree');
    await expect(treeFolder(page, 'inbox')).toBeVisible();
    await expect(treeFolder(page, 'archive')).toBeVisible();
    await expect(treeFolder(page, 'Root')).toHaveAttribute('selected', '');
    chain.step('The tree: the root open, its folders listed (in the place Lens), Root selected');

    // Choosing a folder in the tree opens it, and its own folders are read.
    await treeFolder(page, 'inbox').locator('span.efs-tree-label').first().click();
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(row(page, 'note.txt')).toBeVisible();
    await expect(treeFolder(page, 'inbox')).toHaveAttribute('selected', '');
    await expect(treeFolder(page, 'sub')).toBeVisible();
    await expect(page.locator('efs-files-view wa-breadcrumb-item')).toHaveCount(2);
    chain.step('Choose inbox/ in the tree: it opens, the breadcrumb names it, sub/ is read');

    // The listing moves the tree: opening sub/ from its row selects it there; read with no
    // folders, it's a leaf (no "Reading…" left behind).
    await row(page, 'sub').locator('button.efs-entry-open').click();
    await expect(entries(page)).toContainText('This folder is empty.');
    await expect(treeFolder(page, 'sub')).toHaveAttribute('selected', '');
    await expect(treeFolder(page, 'sub').locator('wa-tree-item')).toHaveCount(0);
    // Unopened folders hold a hidden "Reading…" until opened; none shows once reads are done.
    await expect(tree.locator('.efs-tree-reading:visible')).toHaveCount(0);
    chain.step('Open sub/ from the listing: the tree selects it; read with no folders, a leaf');

    const axe = await new AxeBuilder({ page })
      .include('efs-files-tree')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    // The keyboard: Enter on a folder in the tree opens it.
    await treeFolder(page, 'archive').focus();
    await page.keyboard.press('Enter');
    await expect(treeFolder(page, 'archive')).toHaveAttribute('selected', '');
    await expect(page.locator('efs-files-view wa-breadcrumb-item')).toHaveCount(2);
    // archive/'s own reads, not the screen sub/ left: its node is read (a leaf), and every read
    // has answered before the case ends (so a recording holds them all).
    await expect(treeFolder(page, 'archive').locator('wa-tree-item')).toHaveCount(0);
    await expect(entries(page)).toContainText('This folder is empty.');
    await chain.idle(500);
    chain.step('Keyboard: Enter on archive/ in the tree opens it');
  } finally {
    await chain.finish();
  }
});

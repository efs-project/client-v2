// Folder operations, writes: New folder, Rename, Remove (a release) and Restore, through the
// folder dialog and the same review → send → banner path as edits. The test wallet is anvil #6;
// the realm root's owner and the default Lens are anvil #0. Entries are prepared from Node in live
// and record mode; the replay carries the result.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import {
  DOUBLE_PRESSES,
  expect,
  objectLink,
  pauseClock,
  preview,
  save,
  sendRequests,
  sendsStarted,
} from './edit-support.ts';
import {
  dialog,
  entries,
  fileAtRoot,
  moveHere,
  openRoot,
  picker,
  pickerRow,
  row,
  send,
  withInbox,
} from './folder-support.ts';
import { press } from './press.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

test('New folder: bad names are refused as typed; then name, review, one send, and it appears as yours', async ({
  page,
}) => {
  const chain = await testChain('client-folder-create', 'The realm root, then a new folder.');
  try {
    await openRoot(page, chain);
    await press(entries(page).locator('wa-button.efs-new-folder'));
    const name = dialog(page).locator('wa-input.efs-folder-name');
    await expect(name).toBeFocused();
    // checkName, as typed: Review stays off for a refused name.
    await name.locator('input').fill('projects ');
    await expect(dialog(page)).toContainText("A name can't start or end with a space.");
    await expect(dialog(page).locator('wa-button.efs-folder-review')).toHaveAttribute(
      'disabled',
      '',
    );
    // files-name/3 (sdk-v2 59bb9fb): no name ends with a dot, so '..' is refused as one; and the
    // characters links keep for themselves are named.
    await name.locator('input').fill('..');
    await expect(dialog(page)).toContainText("A name can't end with a dot.");
    await name.locator('input').fill('Q&A #3');
    await expect(dialog(page)).toContainText('A name can\'t use # ? % / \\ < > " | : * or ;.');
    await expect(dialog(page).locator('wa-button.efs-folder-review')).toHaveAttribute(
      'disabled',
      '',
    );
    await name.locator('input').fill('projects');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page)).toContainText(/Creates the folder\W+projects\W+in\W+Root/);
    await expect(dialog(page)).toContainText('One approval in your wallet.');
    chain.step('New folder "projects": checkName, then planCreateFolder in the place Lens');
    await press(send(page));
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
    await press(entries(page).locator('wa-button.efs-new-folder'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('projects');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
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
    await press(entries(page).locator('wa-button.efs-new-folder'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('kept');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    chain.refuseSend(1);
    await press(send(page));
    await expect(dialog(page).locator('.efs-review-not-sent')).toContainText(
      'You declined in your wallet. Nothing was saved.',
    );
    expect(chain.broadcasts).toHaveLength(0);
    await expect(row(page, 'kept')).toHaveCount(0);
    chain.step('Send: the wallet refuses (4001); nothing broadcast');
    await expect(send(page)).toContainText('Send again');
    await press(send(page));
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
    await press(entries(page).locator('wa-button.efs-new-folder'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('lost');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await chain.breakJournalAfterSend(page);
    await press(send(page));
    // Never "nothing was saved": it may have gone out.
    await expect(dialog(page)).toContainText("We couldn't confirm this save yet. Checking…");
    await expect(dialog(page)).not.toContainText('Nothing was saved');
    chain.step('Send: broadcast; the journal write after it fails (thrown, may have sent)');
    await press(dialog(page).locator('wa-button', { hasText: 'Close' }));
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
    await press(row(page, 'draft.txt').locator('wa-button.efs-entry-rename'));
    const name = dialog(page).locator('wa-input.efs-folder-name input');
    await expect(name).toHaveValue('draft.txt');
    await name.fill('final.txt');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page)).toContainText(
      /Rename\W+draft\.txt\W+to\W+final\.txt\W+Links to it keep working/,
    );
    await expect(dialog(page)).toContainText(/nothing is called\W+draft\.txt\W+here/);
    chain.step('Rename draft.txt to final.txt: planMoveEntries with a new name');
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'final.txt')).toBeVisible();
    await expect(row(page, 'draft.txt')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
    // Links to the file keep working: it opens from its row, by its permanent link, in the Lens
    // the row was shown in.
    await press(row(page, 'final.txt').getByRole('link'));
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
    await press(row(page, 'shared.txt').locator('wa-button.efs-entry-remove'));
    await expect(dialog(page)).toContainText(/Your\W+shared\.txt\W+stops appearing here/);
    await expect(dialog(page)).toContainText(/After this, this view shows .+shared\.txt\W+here/);
    await expect(dialog(page)).toContainText('This removal is itself public. You can restore it.');
    // The root is anvil #0's: blocking the name is offered only to a place's owner.
    await expect(dialog(page).locator('wa-button.efs-folder-block')).toHaveCount(0);
    // Keep it is first: Escape keeps the entry, and nothing is sent.
    await expect(dialog(page).locator('wa-button.efs-folder-keep')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Remove, then Escape: kept, nothing sent');

    await press(row(page, 'shared.txt').locator('wa-button.efs-entry-remove'));
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    // The owner's shared.txt shows through (their own rows carry no label).
    await expect(row(page, 'shared.txt').locator('.efs-entry-whose')).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /removed\W+shared\.txt/,
    );
    chain.step("Remove: a release; the owner's shared.txt shows through");

    await press(entries(page).locator('wa-button.efs-entries-restore'));
    await expect(dialog(page)).toContainText(/Restore\W+shared\.txt\W+here/);
    await press(send(page));
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
    await press(entries(page).locator('wa-switch.efs-show-removed'));
    // Said only because the whole list was read (COMPLETE): outer/ is yours, and still here.
    await expect(removedList).toContainText("You haven't removed anything here.");
    chain.step('Show removed at the root: you have removed nothing here');

    await press(listed('outer').locator('button.efs-entry-open'));
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

    // The same folder opened by its link: no trail, but the walk up finds it under the root (its
    // name is yours, and it leads back down), so its path is known and a folder restores here too.
    // Each move waits for the folder's reads to settle, so a replay sees the calls in the recorded
    // order. (A link-opened folder whose path stays unknown: the loop case below.)
    const atRoot = async () => {
      await press(page.locator('wa-breadcrumb wa-breadcrumb-item').first());
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
    await expect(page.locator('efs-files-view wa-breadcrumb-item')).toHaveCount(2);
    await expect(page.locator('efs-files-view wa-breadcrumb-item').last()).toContainText('outer');
    await expect(removedRow('inner').locator('wa-button.efs-removed-restore')).not.toHaveAttribute(
      'disabled',
    );
    await expect(
      removedRow('old.txt').locator('wa-button.efs-removed-restore'),
    ).not.toHaveAttribute('disabled');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('outer/ opened by its link: the walk up names it Root > outer, so both restore');

    // From the root again: the path is known, and the folder restores.
    await atRoot();
    await press(listed('outer').locator('button.efs-entry-open'));
    await expect(removedRow('inner').locator('wa-button.efs-removed-restore')).not.toHaveAttribute(
      'disabled',
    );
    await press(removedRow('inner').locator('wa-button.efs-removed-restore'));
    await expect(dialog(page)).toContainText(/Restore\W+inner\W+here/);
    await press(send(page));
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

test('Move a file: the picker opens where it is, walks by names, and it lands in the folder picked', async ({
  page,
}) => {
  const chain = await testChain('client-folder-move-file', 'inbox/{note.txt, sub/} and archive/.');
  try {
    await withInbox(chain);
    await openRoot(page, chain);
    await press(row(page, 'inbox').locator('button.efs-entry-open'));
    await expect(row(page, 'note.txt')).toBeVisible();
    await press(row(page, 'note.txt').locator('wa-button.efs-entry-move'));
    await expect(dialog(page)).toContainText(/Move\W+note\.txt\W+to…/);
    // It opens in inbox/, where note.txt already is: not a destination.
    await expect(pickerRow(page, 'sub')).toBeVisible();
    await expect(dialog(page)).toContainText("It's already in this folder.");
    await expect(moveHere(page)).toHaveAttribute('disabled', '');
    chain.step('Move note.txt: the picker opens in inbox/, where it already is');

    await press(picker(page).locator('wa-breadcrumb-item').first());
    await expect(pickerRow(page, 'archive')).toBeVisible();
    await press(pickerRow(page, 'archive').locator('button.efs-entry-open'));
    await expect(picker(page)).toContainText('No folders in here.');
    await expect(moveHere(page)).not.toHaveAttribute('disabled');
    chain.step('Up to the root, into archive/: no folders in it, and it can take note.txt');

    await press(moveHere(page));
    await expect(dialog(page)).toContainText(/Move\W+note\.txt\W+to\W+archive/);
    await expect(dialog(page)).toContainText(/Your entry appears in\W+archive/);
    await expect(dialog(page)).not.toContainText('Checked under this lens');
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'note.txt')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Review and send: note.txt leaves inbox/');

    await press(page.locator('efs-files-view wa-breadcrumb-item').first());
    await expect(row(page, 'archive')).toBeVisible();
    await press(row(page, 'archive').locator('button.efs-entry-open'));
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
    await press(row(page, 'inbox').locator('button.efs-entry-open'));
    await expect(row(page, 'sub')).toBeVisible();
    await press(row(page, 'sub').locator('wa-button.efs-entry-move'));
    await expect(pickerRow(page, 'sub')).toContainText("This is the folder you're moving.");
    await expect(pickerRow(page, 'sub').locator('button.efs-entry-open')).toBeDisabled();
    chain.step('Move sub/: in the picker, sub/ itself is shown but not opened');

    await press(picker(page).locator('wa-breadcrumb-item').first());
    await expect(pickerRow(page, 'archive')).toBeVisible();
    await press(pickerRow(page, 'archive').locator('button.efs-entry-open'));
    await expect(picker(page)).toContainText('No folders in here.');
    await press(moveHere(page));
    await expect(dialog(page)).toContainText(/Move\W+sub\W+to\W+archive/);
    await expect(dialog(page)).toContainText(
      "Checked under this lens: the destination isn't inside this folder.",
    );
    await press(send(page));
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
    await press(entries(page).locator('wa-button.efs-new-file'));
    await expect(dialog(page)).toContainText('New text file');
    await dialog(page).locator('wa-input.efs-folder-name input').fill('hello.txt');
    await press(dialog(page).locator('wa-button.efs-folder-write'));
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
    await press(row(page, 'docs').locator('button.efs-entry-open'));
    await expect(editorFor(page)).toHaveCount(0);
    await press(page.locator('efs-files-view wa-breadcrumb-item').first());
    await expect(row(page, 'docs')).toBeVisible();
    const unsaved = entries(page).locator('.efs-entry-unsaved');
    await expect(unsaved).toContainText('hello.txt');
    await expect(unsaved).toContainText('Not saved yet');
    await press(unsaved.locator('button.efs-entry-open'));
    await expect(editorFor(page)).toContainText('Your unsaved new file is back.');
    await expect(editorFor(page).locator('textarea.efs-edit-text')).toHaveValue('Hello, world.\n');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Into docs/ and back: hello.txt is offered back, with its text');

    await press(editorFor(page).locator('wa-button.efs-edit-review-button'));
    const review = page.locator('wa-dialog.efs-edit-review');
    await expect(review).toContainText(/Creates\W+hello\.txt\W+in/);
    await press(review.locator('wa-button.efs-review-send'));
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
    await press(entries(page).locator('wa-button.efs-new-file'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('taken.txt');
    await press(dialog(page).locator('wa-button.efs-folder-write'));
    await editorFor(page).locator('textarea.efs-edit-text').fill('new words\n');
    await press(editorFor(page).locator('wa-button.efs-edit-review-button'));
    await expect(editorFor(page).locator('.efs-new-refused')).toContainText(
      /You already have something called\W+taken\.txt\W+here/,
    );
    chain.step('taken.txt is yours already: refused, with how to go on');

    await editorFor(page).locator('wa-input.efs-new-name input').fill('fresh.txt');
    await expect(editorFor(page).locator('.efs-new-refused')).toHaveCount(0);
    await press(editorFor(page).locator('wa-button.efs-edit-review-button'));
    const review = page.locator('wa-dialog.efs-edit-review');
    await expect(review).toContainText(/Creates\W+fresh\.txt\W+in/);
    await press(review.locator('wa-button', { hasText: 'Cancel' }).first());
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Renamed in place to fresh.txt: it plans; Cancel sends nothing');
  } finally {
    await chain.finish();
  }
});

/** At the root: New text file `name`, written with `text`, then Review (the review dialog). */
async function writeNewFile(page: Page, name: string, text: string) {
  await press(entries(page).locator('wa-button.efs-new-file'));
  await dialog(page).locator('wa-input.efs-folder-name input').fill(name);
  await press(dialog(page).locator('wa-button.efs-folder-write'));
  await editorFor(page).locator('textarea.efs-edit-text').fill(text);
  await press(editorFor(page).locator('wa-button.efs-edit-review-button'));
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
    await press(review.locator('wa-button.efs-review-send'));
    const changed = save(page, 'changed');
    await expect(changed.locator('wa-button.efs-save-reopen')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Send: the content lands; the finish loses the name (changed)');

    await press(changed.locator('wa-button.efs-save-reopen'));
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
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: broadcast; the journal write after it fails (thrown, may have sent)');
    await expect(review.locator('.efs-review-unconfirmed')).toContainText(
      "We couldn't confirm this save yet.",
    );
    await expect(page.getByText(/nothing was saved/i)).toHaveCount(0);
    await press(review.locator('wa-button[slot="footer"]'));
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

    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page)).toContainText(/Uploads\W+pic\.txt\W+to/);
    await expect(dialog(page).locator('.efs-upload-type')).toContainText(
      /Its type, from its contents:\W+image\/png/,
    );
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'pic.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Review (image/png from its bytes, not its name), Send: pic.txt is listed');

    await press(row(page, 'pic.txt').locator('a.efs-entry-open'));
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
    await press(dialog(page).locator('wa-button.efs-folder-review'));
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

/** 150 KiB of text: an upload plans it as two parts, its content first, then the name. */
const TWO_PARTS = Buffer.from(`${'y'.repeat(150 * 1024 - 1)}\n`);

test('the same big file into two folders: the second waits until the first is final, then sends', async ({
  page,
}) => {
  const chain = await testChain(
    'client-upload-same-bytes',
    'The realm root; upload big.txt (150 KiB: a content part, then the name), then the same bytes into docs/ while the first is confirming. Its content part is the same publication, so the SDK holds the save back (ALREADY_ATTEMPTED, its twin the first save): the review says an earlier save with the same contents is still confirming, and Send waits. After 64 blocks the first is final, and Send sends the second (its content part goes out again, then the name).',
  );
  try {
    await page.clock.install();
    await openRoot(page, chain);
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({ name: 'big.txt', mimeType: 'text/plain', buffer: TWO_PARTS });
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page)).toContainText(/2\W+approvals in your wallet/);
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(save(page, 'confirming')).toHaveCount(1);
    expect(sendRequests(chain)).toHaveLength(2);
    chain.step('Upload big.txt at the root: two parts, two sends; Saved · confirming');

    await press(row(page, 'docs').locator('button.efs-entry-open'));
    await expect(row(page, 'readme.txt')).toBeVisible();
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({ name: 'big.txt', mimeType: 'text/plain', buffer: TWO_PARTS });
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await press(send(page));
    const note = dialog(page).locator('.efs-review-not-sent');
    await expect(note).toContainText(
      'An earlier save with the same contents is still confirming. You can send this once it has',
    );
    await expect(note).not.toContainText(/nothing was saved/i);
    await expect(send(page)).toHaveAttribute('disabled', '');
    expect(sendRequests(chain), 'held back before the wallet').toHaveLength(2);
    chain.step('The same bytes into docs/: held back (ALREADY_ATTEMPTED); its new save stopped');

    // Finality: 64 more blocks on anvil, then the saves' next check (12 s).
    await pauseClock(page);
    await chain.idle();
    await chain.control?.mine(64);
    await page.clock.fastForward(12_000);
    chain.step('64 blocks later, the saves check again: the first save is final');
    await expect(note).toContainText(
      'The earlier save with the same contents has confirmed. You can send this now.',
    );
    await page.clock.resume();
    await expect(send(page)).not.toHaveAttribute('disabled');
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'big.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(4);
    chain.step('Send: a new save, both parts sent; big.txt is listed in docs/');
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
    await press(row(page, 'inbox').locator('button.efs-entry-open'));
    await expect(row(page, 'sub')).toBeVisible();
    await select(page, 'note.txt').check();
    await select(page, 'sub').check();
    await expect(selection(page)).toContainText('2 selected');
    const axe = await new AxeBuilder({ page })
      .include('efs-files-listing')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await press(selection(page).locator('wa-button.efs-selection-move'));
    await expect(dialog(page)).toContainText(/Move\W+2\W+entries to…/);
    // sub/ is one of the folders moved: shown, never opened.
    await expect(pickerRow(page, 'sub').locator('button.efs-entry-open')).toBeDisabled();
    chain.step('Select note.txt and sub/, Move…: one picker for both');

    await press(picker(page).locator('wa-breadcrumb-item').first());
    await press(pickerRow(page, 'archive').locator('button.efs-entry-open'));
    await expect(picker(page)).toContainText('No folders in here.');
    await press(moveHere(page));
    await expect(dialog(page)).toContainText(/Move these\W+2\W+entries to\W+archive/);
    await expect(dialog(page).locator('.efs-folder-items li')).toHaveCount(2);
    await expect(dialog(page)).toContainText('Checked under this lens');
    await press(send(page));
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
    await press(row(page, 'inbox').locator('button.efs-entry-open'));
    await expect(row(page, 'sub')).toBeVisible();
    await select(page, 'note.txt').check();
    await select(page, 'sub').check();
    await press(selection(page).locator('wa-button.efs-selection-move'));
    await press(picker(page).locator('wa-breadcrumb-item').first());
    await press(pickerRow(page, 'archive').locator('button.efs-entry-open'));
    await expect(picker(page)).toContainText('No folders in here.');
    await press(moveHere(page));
    await expect(dialog(page).locator('.efs-folder-refused')).toContainText(
      /You already have something called\W+note\.txt\W+here/,
    );
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('note.txt is taken in archive/: the whole selection is refused, and says which');

    await press(dialog(page).locator('wa-button.efs-folder-leave-out'));
    await expect(dialog(page)).toContainText(/Move\W+sub\W+to\W+archive/);
    await expect(dialog(page)).toContainText('Checked under this lens');
    await press(dialog(page).locator('wa-button', { hasText: 'Cancel' }).first());
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
    await press(selection(page).locator('wa-button.efs-selection-remove'));
    await expect(dialog(page)).toContainText(/Remove\W+2\W+entries from/);
    await expect(dialog(page)).toContainText(/These\W+2\W+entries of yours stop appearing here/);
    await expect(dialog(page).locator('wa-button.efs-folder-keep')).toBeFocused();
    await press(send(page));
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
    await press(treeFolder(page, 'inbox').locator('span.efs-tree-label').first());
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(row(page, 'note.txt')).toBeVisible();
    await expect(treeFolder(page, 'inbox')).toHaveAttribute('selected', '');
    await expect(treeFolder(page, 'sub')).toBeVisible();
    await expect(page.locator('efs-files-view wa-breadcrumb-item')).toHaveCount(2);
    chain.step('Choose inbox/ in the tree: it opens, the breadcrumb names it, sub/ is read');

    // The listing moves the tree: opening sub/ from its row selects it there; read with no
    // folders, it's a leaf (no "Reading…" left behind).
    await press(row(page, 'sub').locator('button.efs-entry-open'));
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

test('a folder cycle in the tree is opened one level per expand, five levels round, never on its own', async ({
  page,
}) => {
  const chain = await testChain(
    'client-folder-cycle',
    "anvil #6 (the wallet) makes loop/ and loop/b/; anvil #0 puts its own entry a in loop/b/ pointing back at loop/ (the SDK's tests-only planFolderEntry). In the place Lens (#6, then #0) that's a cycle, loop → b → a → b → … The tree opens it one level per expand, five levels, and reads nothing below what was opened.",
  );
  /** A tree node by its path of names from the root (tree-model.ts treeKey). */
  const node = (names: readonly string[]) =>
    page.locator(
      `efs-files-tree wa-tree-item.efs-tree-folder[data-key="${names.map((n) => `/${n}`).join('')}"]`,
    );
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save }) => {
      const made = async (parent: import('@efs/sdk/files').FolderRef, name: string) =>
        (
          (await save(
            await files.planCreateFolder(efs, writer, { folder: parent, name, lens }),
          )) as {
            created: import('@efs/sdk/files').FolderRef;
          }
        ).created;
      const loop = await made(root, 'loop');
      const b = await made(loop, 'b');
      return { loop: loop.directory as string, b: b.directory as string };
    });
    await chain.actAs?.(0, async ({ efs, writer, save }) => {
      const { planFolderEntry } = await import('@efs/sdk/testing');
      await save(
        await planFolderEntry(efs, writer, {
          folder: { kind: 'folder', directory: chain.ids.b as never },
          name: 'a',
          target: { kind: 'folder', directory: chain.ids.loop as never },
        }),
      );
    });
    chain.step('#6 makes loop/ and loop/b/; #0 puts a in loop/b/, pointing back at loop/');
    await openRoot(page, chain);
    // The wallet dialog openRoot closed with Escape holds focus until it has finished closing.
    await expect(page.locator('wa-dialog.efs-wallet-dialog')).not.toHaveAttribute('open');
    await expect(node(['loop'])).toBeVisible();
    // Round the cycle: loop → b → a → b → a → b. Each expand reads that one folder and shows its
    // one child; the child itself is unread (no folders of its own shown) until it is expanded.
    const path = ['loop', 'b', 'a', 'b', 'a', 'b'];
    for (let depth = 1; depth < path.length; depth++) {
      const here = path.slice(0, depth);
      const next = path.slice(0, depth + 1);
      await node(here).focus();
      await page.keyboard.press('ArrowRight');
      await expect(node(here)).toHaveAttribute('expanded', '');
      await expect(node(next)).toBeVisible();
      await expect(node(next).locator('wa-tree-item.efs-tree-folder')).toHaveCount(0);
      await expect(
        page.locator('efs-files-tree wa-tree-item.efs-tree-folder[data-key^="/loop"]'),
      ).toHaveCount(depth + 1);
      await chain.idle(300);
      chain.step(`Expand ${here.join('/')}: one level read, ${next.join('/')} shown and unread`);
    }
    // Still on the root (expanding never navigates), and the page answers.
    await expect(row(page, 'loop')).toBeVisible();
    await chain.idle(500);
  } finally {
    await chain.finish();
  }
});

/** The location bar's crumbs. */
const crumbs = (page: Page) => page.locator('efs-files-view wa-breadcrumb-item');

/** Opens a folder by its object link in this tab (no reload: the wallet stays connected). */
async function openByLink(page: Page, directory: string): Promise<void> {
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `#/r/testnet/${objectLink(directory)}`,
  );
}

test("a folder opened by its link, two levels down: the breadcrumb names the path from the root, the tree opens along it, another author's name says whose", async ({
  page,
}) => {
  const chain = await testChain(
    'client-trail-root',
    "anvil #6 (the wallet) makes trail/ and trail/deep/; anvil #0 makes trail/theirs/. Each is opened by its object link: the walk up (folderNames) reaches the root, and the names lead back down in the tree's Lens, so the trail is the one from the root.",
  );
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const made = async (parent: import('@efs/sdk/files').FolderRef, name: string) =>
        (
          (await done(
            await files.planCreateFolder(efs, writer, { folder: parent, name, lens }),
          )) as { created: import('@efs/sdk/files').FolderRef }
        ).created;
      const trail = await made(root, 'trail');
      const deep = await made(trail, 'deep');
      return { trail: trail.directory as string, deep: deep.directory as string };
    });
    await chain.actAs?.(0, async ({ files, lens, writer, efs, save: done }) => {
      const theirs = (
        (await done(
          await files.planCreateFolder(efs, writer, {
            folder: { kind: 'folder', directory: chain.ids.trail as never },
            name: 'theirs',
            lens,
          }),
        )) as { created: import('@efs/sdk/files').FolderRef }
      ).created;
      return { theirs: theirs.directory as string };
    });
    chain.step('#6 makes trail/ and trail/deep/; #0 makes trail/theirs/');
    await openRoot(page, chain);
    await expect(page.locator('wa-dialog.efs-wallet-dialog')).not.toHaveAttribute('open');

    await openByLink(page, chain.ids.deep as string);
    await expect(crumbs(page)).toHaveCount(3);
    await expect(crumbs(page).nth(1)).toContainText('trail');
    await expect(crumbs(page).nth(2)).toContainText('deep');
    // Both names are yours: no "named by", nothing "above".
    await expect(page.locator('efs-files-view .efs-crumb-by')).toHaveCount(0);
    await expect(page.locator('efs-files-view .efs-crumb-above')).toHaveCount(0);
    // The tree opens along the path from the root and selects deep/; there is no "above" node.
    await expect(
      page.locator('efs-files-tree wa-tree-item.efs-tree-folder[data-key="/trail/deep"]'),
    ).toHaveAttribute('selected', '');
    await expect(page.locator('efs-files-tree .efs-tree-above')).toHaveCount(0);
    await expect(entries(page)).toContainText('This folder is empty.');
    await chain.idle(300);
    chain.step('trail/deep/ by its link: Root > trail > deep, the tree selects /trail/deep');

    // trail/ on the bar goes up by the path, as one clicked through would.
    await press(crumbs(page).nth(1));
    await expect(row(page, 'deep')).toBeVisible();
    await expect(crumbs(page)).toHaveCount(2);
    await chain.idle(300);

    await openByLink(page, chain.ids.theirs as string);
    await expect(crumbs(page)).toHaveCount(3);
    await expect(crumbs(page).nth(2)).toContainText('theirs');
    // Its name is its creator's (#0), not yours: the folder on screen says whose.
    await expect(crumbs(page).nth(2).locator('.efs-crumb-by')).toContainText(/named by \W*0xf39F/i);
    await expect(
      page.locator('efs-files-tree wa-tree-item.efs-tree-folder[data-key="/trail/theirs"]'),
    ).toHaveAttribute('selected', '');
    const axe = await new AxeBuilder({ page })
      .include('efs-files-view')
      .include('efs-files-tree')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await expect(entries(page)).toContainText('This folder is empty.');
    await chain.idle(300);
    chain.step('trail/theirs/ by its link: #0\'s name, said as "named by" on the folder on screen');
  } finally {
    await chain.finish();
  }
});

test("a folder opened by its link whose names loop: the path above is shown as a loop, never as one from the root, and a folder can't be restored there", async ({
  page,
}) => {
  const chain = await testChain(
    'client-trail-loop',
    "anvil #6 (the wallet) makes lx/ and lx/ly/, puts a newer entry lx2 for lx/ inside ly/ (the SDK's tests-only planFolderEntry), and removes ly/gone/. Opened by its link, ly/ is named in lx/, and lx/'s newest name is in ly/: a loop.",
  );
  const removedRow = (name: string) =>
    page
      .locator('efs-files-removed')
      .locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const made = async (parent: import('@efs/sdk/files').FolderRef, name: string) =>
        (
          (await done(
            await files.planCreateFolder(efs, writer, { folder: parent, name, lens }),
          )) as { created: import('@efs/sdk/files').FolderRef }
        ).created;
      const lx = await made(root, 'lx');
      const ly = await made(lx, 'ly');
      await made(ly, 'gone');
      await done(
        await files.planRemoveEntries(efs, writer, {
          entries: [{ folder: ly, name: 'gone' }],
          lens,
        }),
      );
      const { planFolderEntry } = await import('@efs/sdk/testing');
      await done(await planFolderEntry(efs, writer, { folder: ly, name: 'lx2', target: lx }));
      return { lx: lx.directory as string, ly: ly.directory as string };
    });
    chain.step('#6 makes lx/, lx/ly/ and removes ly/gone/; then puts lx2 (→ lx/) in ly/');
    await openRoot(page, chain);
    await expect(page.locator('wa-dialog.efs-wallet-dialog')).not.toHaveAttribute('open');

    await openByLink(page, chain.ids.ly as string);
    // Root > Loop > lx2 > ly: the loop is said, in words, and the path is never one from the root.
    await expect(crumbs(page)).toHaveCount(4);
    await expect(crumbs(page).nth(1)).toHaveClass(/efs-crumb-above/);
    await expect(crumbs(page).nth(1)).toContainText('Loop');
    await expect(crumbs(page).nth(1)).toContainText('placed inside each other');
    // Words, not a control (PM, 2026-11-27): nothing in it is a button, so nothing announces a
    // button that does nothing; the folder on screen is the current page.
    await expect(crumbs(page).nth(1).getByRole('button')).toHaveCount(0);
    await expect(crumbs(page).last()).toHaveAttribute('aria-current', 'page');
    // In the accessibility tree: the words are there, and no button carries them.
    const tree = await page.getByRole('navigation', { name: 'Location' }).ariaSnapshot();
    expect(tree).toContain('placed inside each other');
    expect(tree).not.toMatch(/button[^\n]*(Loop|placed inside)/);
    const loopAxe = await new AxeBuilder({ page })
      .include('efs-files-view')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(loopAxe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await expect(crumbs(page).nth(2)).toContainText('lx2');
    await expect(crumbs(page).nth(3)).toContainText('ly');
    // The tree: beside the root, the same "above" node, holding lx2 > ly, with ly/ selected.
    const above = page.locator('efs-files-tree wa-tree-item.efs-tree-above');
    await expect(above).toContainText('Loop');
    await expect(above.locator('wa-tree-item.efs-tree-walked')).toContainText('lx2');
    await expect(above.locator('wa-tree-item.efs-tree-folder[selected]')).toHaveAttribute(
      'data-name',
      'ly',
    );
    chain.step('ly/ by its link: Root > Loop > lx2 > ly, and the tree says the same');

    // The path from the root isn't known here, so a folder can't be restored (the SDK needs it).
    await press(entries(page).locator('wa-switch.efs-show-removed'));
    await expect(removedRow('gone')).toContainText(
      'Open this folder from the root to restore a folder here.',
    );
    await expect(removedRow('gone').locator('wa-button.efs-removed-restore')).toHaveAttribute(
      'disabled',
      '',
    );
    expect(sendRequests(chain)).toHaveLength(0);
    await chain.idle(300);
    chain.step("Show removed: gone/ can't be restored from a folder whose path isn't known");

    // lx2 on the bar opens lx/ by its link, and walks up from there (its newest name is in ly/).
    await press(crumbs(page).nth(2));
    await expect(row(page, 'ly')).toBeVisible();
    await expect(crumbs(page).nth(1)).toContainText('Loop');
    await chain.idle(300);
    chain.step('lx2 on the bar: lx/ by its link, and the loop again from there');
  } finally {
    await chain.finish();
  }
});

test("a folder opened by its link whose names reach the root but lead elsewhere on the way down: shown with what's above, never as a path from the root", async ({
  page,
}) => {
  const chain = await testChain(
    'client-trail-elsewhere',
    "anvil #0 makes ea/ and ea/eb/; anvil #6 (the wallet) makes ez/ and puts its own eb in ea/ pointing at ez/ (planFolderEntry). Walking up from #0's eb/ names it by its creator in ea/, and ea/ in the root; but down from the root in the tree's Lens (#6 first), ea/eb is #6's, which is ez/.",
  );
  try {
    await chain.actAs?.(0, async ({ files, root, lens, writer, efs, save: done }) => {
      const made = async (parent: import('@efs/sdk/files').FolderRef, name: string) =>
        (
          (await done(
            await files.planCreateFolder(efs, writer, { folder: parent, name, lens }),
          )) as { created: import('@efs/sdk/files').FolderRef }
        ).created;
      const ea = await made(root, 'ea');
      const eb = await made(ea, 'eb');
      return { ea: ea.directory as string, eb: eb.directory as string };
    });
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const ez = (
        (await done(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'ez', lens }),
        )) as { created: import('@efs/sdk/files').FolderRef }
      ).created;
      const { planFolderEntry } = await import('@efs/sdk/testing');
      await done(
        await planFolderEntry(efs, writer, {
          folder: { kind: 'folder', directory: chain.ids.ea as never },
          name: 'eb',
          target: ez,
        }),
      );
      return { ez: ez.directory as string };
    });
    chain.step('#0 makes ea/eb/; #6 makes ez/ and puts its own eb (→ ez/) in ea/');
    await openRoot(page, chain);
    await expect(page.locator('wa-dialog.efs-wallet-dialog')).not.toHaveAttribute('open');

    await openByLink(page, chain.ids.eb as string);
    // Root > … > ea > eb: the "…" says why in words; eb is its creator's name.
    await expect(crumbs(page)).toHaveCount(4);
    await expect(crumbs(page).nth(1)).toHaveClass(/efs-crumb-above/);
    await expect(crumbs(page).nth(1)).toContainText('lead to a different folder');
    await expect(crumbs(page).nth(1).getByRole('button')).toHaveCount(0);
    await expect(crumbs(page).nth(2)).toContainText('ea');
    await expect(crumbs(page).nth(3)).toContainText('eb');
    await expect(crumbs(page).nth(3).locator('.efs-crumb-by')).toContainText(/named by \W*0xf39F/i);
    // The tree never opens /ea/eb as this folder: it shows it under the "above" node.
    const above = page.locator('efs-files-tree wa-tree-item.efs-tree-above');
    await expect(above.locator('wa-tree-item.efs-tree-folder[selected]')).toHaveAttribute(
      'data-name',
      'eb',
    );
    await expect(
      page.locator('efs-files-tree wa-tree-item.efs-tree-folder[data-key="/ea/eb"][selected]'),
    ).toHaveCount(0);
    await expect(entries(page)).toContainText('This folder is empty.');
    await chain.idle(300);
    chain.step(
      "#0's eb/ by its link: Root > … > ea > eb (named by #0), under the tree's above node",
    );
  } finally {
    await chain.finish();
  }
});

const overview = (page: Page) => page.locator('efs-files-overview');

test("the Overview shows a folder's README formatted (verified text only), links kept safe; without one, its summary", async ({
  page,
}) => {
  const chain = await testChain(
    'client-readme',
    'guide/ by anvil #6 at the root, holding a README.md in the EFS Markdown subset.',
  );
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const guide = (
        (await done(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'guide', lens }),
        )) as { created: import('@efs/sdk/files').FolderRef }
      ).created;
      const readme = [
        '# Welcome',
        '',
        `This folder has **notes** and [docs](https://example.org/docs). Back to [the root](${objectLink(root.directory)}).`,
        '',
        '- one',
        '- two',
        '',
        '<script>alert(1)</script>',
        '',
        '[not a link](javascript:alert(1))',
      ].join('\n');
      await done(
        await files.planCreateFile(efs, writer, {
          folder: guide,
          name: 'README.md',
          content: new TextEncoder().encode(readme),
          lens,
        }),
      );
    });
    await openRoot(page, chain);
    await expect(overview(page).locator('.efs-folder-summary')).toContainText(
      "The realm's shared folder.",
    );
    chain.step('The root has no README: the Overview shows its summary');

    await press(row(page, 'guide').locator('button.efs-entry-open'));
    const body = overview(page).locator('.efs-readme-body');
    await expect(body.locator('h3')).toHaveText('Welcome');
    await expect(body.locator('strong')).toHaveText('notes');
    await expect(body.locator('li')).toHaveCount(2);
    const external = body.locator('a', { hasText: 'docs' });
    await expect(external).toHaveAttribute('href', 'https://example.org/docs');
    await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    // Raw HTML stays text; a javascript: link stays text.
    await expect(body).toContainText('<script>alert(1)</script>');
    await expect(overview(page).locator('script')).toHaveCount(0);
    await expect(body.locator('a', { hasText: 'not a link' })).toHaveCount(0);
    await expect(overview(page).locator('.efs-readme-caption')).toContainText('README.md');
    const axe = await new AxeBuilder({ page })
      .include('efs-files-overview')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('Open guide/: its README, verified, formatted; raw HTML and javascript: stay text');

    // An EFS link in the README opens in the app.
    await press(body.locator('a', { hasText: 'the root' }));
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(overview(page).locator('.efs-folder-summary')).toContainText(
      "The realm's shared folder.",
    );
    await chain.idle(500);
    chain.step('Its EFS link opens the root, in the app');
  } finally {
    await chain.finish();
  }
});

/**
 * mine/ by anvil #6 at the root, holding note.txt by #6 (and, with `other`, one by anvil #0: the
 * default Lens's author, so this view would show it through).
 */
async function withMine(chain: TestChain, other: boolean): Promise<void> {
  await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
    const mine = (
      (await done(
        await files.planCreateFolder(efs, writer, { folder: root, name: 'mine', lens }),
      )) as {
        created: import('@efs/sdk/files').FolderRef & { owner: string };
      }
    ).created;
    await done(
      await files.planCreateFile(efs, writer, {
        folder: mine,
        name: 'note.txt',
        content: new TextEncoder().encode('mine\n'),
        lens,
      }),
    );
    return { mine: mine.directory, mineOwner: mine.owner };
  });
  if (!other) return;
  await chain.actAs?.(0, async ({ files, lens, writer, efs, save: done }) => {
    const mine = {
      kind: 'folder',
      directory: chain.ids.mine,
      owner: chain.ids.mineOwner,
    } as unknown as import('@efs/sdk/files').FolderRef;
    await done(
      await files.planCreateFile(efs, writer, {
        folder: mine,
        name: 'note.txt',
        content: new TextEncoder().encode('theirs\n'),
        lens,
      }),
    );
  });
}

test("Remove and block this name: only the place's owner is offered it; the review says what it blocks; nothing shows after", async ({
  page,
}) => {
  const chain = await testChain(
    'client-remove-block',
    'mine/ by anvil #6, holding note.txt by #6 and note.txt by #0 (in the default Lens).',
  );
  try {
    await withMine(chain, true);
    await openRoot(page, chain);
    await press(row(page, 'mine').locator('button.efs-entry-open'));
    await expect(row(page, 'note.txt').locator('.efs-entry-whose')).toHaveCount(0);
    await press(row(page, 'note.txt').locator('wa-button.efs-entry-remove'));
    // A plain removal first: #0's note.txt (in this view's Lens) would show through.
    await expect(dialog(page)).toContainText(/After this, this view shows .+note\.txt\W+here/);
    await press(dialog(page).locator('wa-button.efs-folder-block'));
    await expect(dialog(page)).toContainText(/Remove and block\W+note\.txt\W+in\W+mine/);
    await expect(dialog(page).locator('.efs-folder-block-detail')).toContainText(
      /Other people's files called\W+note\.txt\W+won't show here either/,
    );
    await expect(dialog(page).locator('.efs-folder-block-rule')).toContainText(
      'other apps may still show those files',
    );
    await expect(dialog(page)).toContainText(/After this, nothing is called\W+note\.txt\W+here/);
    chain.step('Remove, then Remove and block this name instead: planned as a block, said in full');

    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'note.txt')).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /You removed and blocked\W+note\.txt\W+here/,
    );
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step("Send: neither note.txt shows here now (yours removed, #0's blocked)");
  } finally {
    await chain.finish();
  }
});

test('Restore unblocks a blocked name: listed as "Removed and blocked", the review says so, one send, yours is back', async ({
  page,
}) => {
  const chain = await testChain(
    'client-restore-unblock',
    'mine/ by anvil #6 with note.txt, removed and blocked by #6 from Node.',
  );
  try {
    await withMine(chain, false);
    await chain.actAs?.(6, async ({ files, lens, writer, efs, save: done }) => {
      const mine = {
        kind: 'folder',
        directory: chain.ids.mine,
        owner: chain.ids.mineOwner,
      } as unknown as import('@efs/sdk/files').FolderRef;
      await done(
        await files.planRemoveEntries(efs, writer, {
          entries: [{ folder: mine, name: 'note.txt' }],
          hide: true,
          lens,
        }),
      );
    });
    await openRoot(page, chain);
    await press(row(page, 'mine').locator('button.efs-entry-open'));
    await expect(entries(page)).toContainText('This folder is empty.');
    await press(entries(page).locator('wa-switch.efs-show-removed'));
    const removed = page.locator('efs-files-removed .efs-entry');
    await expect(removed).toContainText('Removed and blocked');
    await press(removed.locator('wa-button.efs-removed-restore'));
    await expect(dialog(page).locator('.efs-folder-unblock')).toContainText(
      'This also unblocks the name here.',
    );
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'note.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Show removed, Restore: it unblocks the name; note.txt is back');
  } finally {
    await chain.finish();
  }
});

test('a block with nothing of yours under it (NEVER_BOUND) offers Unblock, not Restore; Unblock shows the other entry again', async ({
  page,
}) => {
  const chain = await testChain(
    'client-folder-unblock',
    'theirs.txt at the root by anvil #0 (the owner); anvil #6 blocks that name with nothing of its own there (a lone block, planLoneHide).',
  );
  const listed = (name: string) =>
    entries(page).locator('.efs-entry:not(.efs-entry-removed)', {
      has: page.locator('.efs-entry-name', { hasText: name }),
    });
  try {
    await fileAtRoot(chain, 0, 'theirs.txt', "the owner's\n");
    await chain.actAs?.(6, async ({ root, lens, writer, efs, save: done }) => {
      const { planLoneHide } = await import('@efs/sdk/testing');
      await done(await planLoneHide(efs, writer, { folder: root, name: 'theirs.txt', lens }));
    });
    await openRoot(page, chain);
    // You first: your block hides the owner's theirs.txt from this view.
    await expect(listed('theirs.txt')).toHaveCount(0);
    await press(entries(page).locator('wa-switch.efs-show-removed'));
    const removed = page.locator('efs-files-removed .efs-entry', {
      has: page.locator('.efs-entry-name', { hasText: 'theirs.txt' }),
    });
    await expect(removed).toHaveAttribute('data-last', 'NEVER_BOUND');
    await expect(removed).toContainText("You blocked someone else's entry at this name");
    await expect(removed.locator('wa-button.efs-removed-restore')).toHaveCount(0);
    await expect(removed.locator('wa-button.efs-removed-unhide')).toHaveText(
      /Unblock\W+theirs\.txt/,
    );
    const axe = await new AxeBuilder({ page })
      .include('efs-files-listing')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('Show removed: your lone block is listed with Unblock, never Restore');

    await press(removed.locator('wa-button.efs-removed-unhide'));
    await expect(dialog(page)).toContainText(/Unblock\W+theirs\.txt\W+here/);
    // What shows at the name afterwards: the owner's entry.
    await expect(dialog(page).locator('.efs-folder-after')).toContainText(/theirs\.txt/);
    await expect(send(page)).toHaveText('Unblock');
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(listed('theirs.txt')).toBeVisible();
    await expect(page.locator('efs-files-removed')).toContainText(
      "You haven't removed anything here.",
    );
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step("Unblock: one send; the owner's theirs.txt shows here again");
  } finally {
    await chain.finish();
  }
});

/** Lists the whole folder on screen: "Keep looking" until there is no next page. */
async function listAll(page: Page, first: string): Promise<void> {
  await expect(row(page, first)).toBeVisible();
  const more = entries(page).locator('wa-button.efs-entries-more');
  while ((await more.count()) > 0) {
    await press(more);
    await expect(entries(page).locator('wa-button.efs-entries-more[loading]')).toHaveCount(0);
  }
}

const BULK = Array.from({ length: 64 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`);

test('64 entries selected: Move them all, then Remove them all; every part is sent, and each save completes', async ({
  page,
}) => {
  // The path a kernel floor the planners didn't count broke (sdk-v2 db9dc26): batches of about
  // 40 or more were planned over the 2^24 cap and refused on every try. The live chain only: its
  // transcript would be all setup.
  test.skip(CHAIN_MODE !== 'live', 'live chain only (pnpm test:e2e:live)');
  test.setTimeout(600_000);
  const chain = await testChain('client-select-64', 'bulk/ with 64 files and dest/, by anvil #6.');
  try {
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save: done }) => {
      const folderIn = async (name: string) =>
        (
          (await done(await files.planCreateFolder(efs, writer, { folder: root, name, lens }))) as {
            created: import('@efs/sdk/files').FolderRef;
          }
        ).created;
      const bulk = await folderIn('bulk');
      await folderIn('dest');
      for (const name of BULK) {
        await done(
          await files.planCreateFile(efs, writer, {
            folder: bulk,
            name,
            content: new TextEncoder().encode(`${name}\n`),
            lens,
          }),
        );
      }
    });
    await openRoot(page, chain);
    const prompts = dialog(page).locator('.efs-review-prompts');
    /** The parts the review says it will send (one approval each: the test wallet doesn't batch). */
    const parts = async () => {
      const text = (await prompts.textContent()) ?? '';
      if (/One approval/.test(text)) return 1;
      const n = Number(/(\d+)\s*approvals/.exec(text.replace(/[\u2066-\u2069]/g, ''))?.[1]);
      expect(n, text).toBeGreaterThan(1);
      return n;
    };
    // Every part committed (COMPLETE): "Saved · confirming", or "Saved" once final. Each save
    // stays in the banner, and none may show anything else.
    const complete = page.locator(
      'efs-saves-banner .efs-save:is([data-outcome="confirming"], [data-outcome="saved"])',
    );
    const saves = page.locator('efs-saves-banner .efs-save');
    const selectAll = async () => {
      await listAll(page, BULK[0] as string);
      await expect(entries(page).locator('.efs-entry')).toHaveCount(BULK.length);
      for (const name of BULK) await select(page, name).check();
      await expect(selection(page)).toContainText(`${BULK.length} selected`);
    };

    // Move all 64 into dest/.
    await press(row(page, 'bulk').locator('button.efs-entry-open'));
    await selectAll();
    await press(selection(page).locator('wa-button.efs-selection-move'));
    await press(picker(page).locator('wa-breadcrumb-item').first());
    await press(pickerRow(page, 'dest').locator('button.efs-entry-open'));
    await press(moveHere(page));
    await expect(dialog(page)).toContainText(/Move these\W+64\W+entries to\W+dest/, {
      timeout: 60_000,
    });
    const moveParts = await parts();
    const before = sendRequests(chain).length;
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open', '', { timeout: 120_000 });
    await expect(complete).toHaveCount(1, { timeout: 120_000 });
    await expect(saves).toHaveCount(1);
    expect(sendRequests(chain).length - before, 'every move part sent once').toBe(moveParts);
    await expect(entries(page).locator('.efs-entry')).toHaveCount(0, { timeout: 60_000 });
    chain.step(`Move 64 into dest/: ${moveParts} parts, each sent once; Saved; bulk/ is empty`);

    // Remove all 64 from dest/.
    await press(page.locator('wa-breadcrumb wa-breadcrumb-item').first());
    await press(row(page, 'dest').locator('button.efs-entry-open'));
    await selectAll();
    await press(selection(page).locator('wa-button.efs-selection-remove'));
    await expect(dialog(page)).toContainText(/Remove\W+64\W+entries from/, { timeout: 60_000 });
    const removeParts = await parts();
    const sentBefore = sendRequests(chain).length;
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open', '', { timeout: 120_000 });
    await expect(entries(page).locator('.efs-entry')).toHaveCount(0, { timeout: 120_000 });
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /You removed\W+64\W+entries/,
      { timeout: 60_000 },
    );
    await expect(complete).toHaveCount(2, { timeout: 120_000 });
    await expect(saves).toHaveCount(2);
    expect(sendRequests(chain).length - sentBefore, 'every remove part sent once').toBe(
      removeParts,
    );
    chain.step(`Remove 64 from dest/: ${removeParts} parts, each sent once; dest/ is empty`);
    // The counts shrink once the tag release brings the kernel's own floor: logged, not pinned.
    console.log(`select-64: ${JSON.stringify({ move: moveParts, remove: removeParts })}`);
  } finally {
    await chain.finish();
  }
});

/** Goes to `hash` in the same page (a link followed in the app). */
const goTo = (page: Page, hash: string) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

test("At someone else's address: New folder and New text file say who sees your entry before you sign; it shows as yours; no Block there", async ({
  page,
}) => {
  const chain = await testChain(
    'client-home-attach',
    'anvil #5 places pet.txt at its own address; anvil #6 (the wallet) adds a folder and a text file there.',
  );
  try {
    await chain.actAs?.(5, async ({ files, lens, writer, efs, account, save: done }) => {
      await done(
        await files.planCreateFile(efs, writer, {
          folder: { kind: 'home', address: account as `0x${string}` },
          name: 'pet.txt',
          content: new TextEncoder().encode('pet.txt by #5\n'),
          lens,
        }),
      );
      return { account5: account };
    });
    const five = chain.ids.account5 as string;
    await openRoot(page, chain);
    await goTo(page, `#/r/testnet/${five}`);
    await expect(row(page, 'pet.txt')).toBeVisible();
    // Not your address: nothing of anyone else's to block here.
    await expect(row(page, 'pet.txt').locator('wa-button.efs-entry-block')).toHaveCount(0);
    await press(entries(page).locator('wa-button.efs-new-folder'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('mine');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page).locator('.efs-attach-notice')).toContainText(
      /Your entry appears at\W+0x[0-9A-Fa-f]{4}…[0-9A-Fa-f]{4}\W+for you, for anyone whose view includes you/,
    );
    chain.step("New folder at #5's address: the review says who sees your entry");

    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'mine').locator('.efs-entry-whose')).toHaveText('yours');
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Send: one approval; mine/ shows at the address as yours');

    await press(entries(page).locator('wa-button.efs-new-file'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('hello.txt');
    await press(dialog(page).locator('wa-button.efs-folder-write'));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await editorFor(page).locator('textarea.efs-edit-text').fill('Hello from #6.\n');
    await press(editorFor(page).locator('wa-button.efs-edit-review-button'));
    const review = page.locator('wa-dialog.efs-edit-review');
    await expect(review).toContainText(/Creates\W+hello\.txt\W+in/);
    await expect(review.locator('.efs-attach-notice')).toContainText(
      /Your entry appears at\W+0x[0-9A-Fa-f]{4}…[0-9A-Fa-f]{4}/,
    );
    await press(review.locator('wa-button.efs-review-send'));
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Hello from #6.\n');
    expect(sendRequests(chain)).toHaveLength(2);
    await chain.idle(500);
    chain.step(
      'New text file at the address: the same notice in the review; saved, it opens by its link',
    );
  } finally {
    await chain.finish();
  }
});

test("At your own address: writes need no notice; Block someone else's entry there, it's gone for you; Unblock brings it back", async ({
  page,
}) => {
  const chain = await testChain(
    'client-home-block',
    "anvil #0 (in the default Lens) places spam.txt at anvil #6's address; #6 (the wallet) adds notes/ there, blocks spam.txt, then unblocks it.",
  );
  try {
    await chain.actAs?.(6, async ({ account }) => ({ account6: account }));
    const six = chain.ids.account6 as string;
    await chain.actAs?.(0, async ({ files, lens, writer, efs, save: done }) => {
      await done(
        await files.planCreateFile(efs, writer, {
          folder: { kind: 'home', address: six as `0x${string}` },
          name: 'spam.txt',
          content: new TextEncoder().encode('spam by #0\n'),
          lens,
        }),
      );
    });
    await openRoot(page, chain);
    await goTo(page, `#/r/testnet/${six}`);
    await expect(row(page, 'spam.txt').locator('.efs-entry-whose')).toHaveText(/0x.+'s/);
    await press(entries(page).locator('wa-button.efs-new-folder'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('notes');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    // The place is named by its address, never "Root".
    await expect(dialog(page)).toContainText(/Creates the folder\W+notes\W+in\W+0x[0-9A-Fa-f]{4}…/);
    await expect(dialog(page).locator('.efs-attach-notice')).toHaveCount(0);
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    // Your own address: your entries are its owner's, unlabelled.
    await expect(row(page, 'notes')).toBeVisible();
    await expect(row(page, 'notes').locator('.efs-entry-whose')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step("New folder at your own address: no notice; it shows as the owner's");

    await press(row(page, 'spam.txt').locator('wa-button.efs-entry-block'));
    await expect(dialog(page)).toContainText(/Block\W+spam\.txt\W+by\W+0x.+here/);
    await expect(dialog(page).locator('.efs-hide-reach')).toContainText(
      "It's your block, not a deletion",
    );
    await expect(send(page)).toHaveText('Block');
    const axe = await new AxeBuilder({ page })
      .include('efs-files-listing')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step("Block spam.txt (#0's) at your own address: the review says what a block does");

    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'spam.txt')).toHaveCount(0);
    const notice = entries(page).locator('.efs-entries-removed');
    await expect(notice).toContainText(/You blocked\W+spam\.txt\W+here/);
    expect(sendRequests(chain)).toHaveLength(2);
    chain.step('Send: spam.txt is gone for you; the notice offers Unblock');

    await press(notice.locator('wa-button.efs-entries-restore'));
    await expect(dialog(page)).toContainText(/Unblock\W+spam\.txt\W+here/);
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'spam.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(3);
    await chain.idle(500);
    chain.step("Unblock: one send; #0's spam.txt shows at your address again");
  } finally {
    await chain.finish();
  }
});

test('At your own address: Block works on a junk entry too, one that points at nothing with a file version ("other")', async ({
  page,
}) => {
  const chain = await testChain(
    'client-home-block-other',
    "anvil #0 (in the default Lens) places junk.bin, a subject with no file version, at anvil #6's address (planOtherEntry); #6 (the wallet) blocks it.",
  );
  try {
    await chain.actAs?.(6, async ({ account }) => ({ account6: account }));
    const six = chain.ids.account6 as string;
    await chain.actAs?.(0, async ({ efs, writer, lens, save: done }) => {
      const { planOtherEntry } = await import('@efs/sdk/testing');
      await done(
        await planOtherEntry(efs, writer, {
          folder: { kind: 'home', address: six as `0x${string}` },
          name: 'junk.bin',
          lens,
        }),
      );
    });
    await openRoot(page, chain);
    await goTo(page, `#/r/testnet/${six}`);
    const junk = row(page, 'junk.bin');
    await expect(junk).toHaveAttribute('data-kind', 'other');
    await expect(junk.locator('.efs-entry-whose')).toHaveText(/0x.+'s/);
    await press(junk.locator('wa-button.efs-entry-block'));
    await expect(dialog(page)).toContainText(/Block\W+junk\.bin\W+by\W+0x.+here/);
    await expect(dialog(page).locator('.efs-folder-after')).toContainText(
      /nothing is called\W+junk\.bin\W+here/,
    );
    chain.step('Block junk.bin (an "other" row by #0) at your own address: planned like any entry');

    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(junk).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /You blocked\W+junk\.bin\W+here/,
    );
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Send: junk.bin is gone for you; the notice offers Unblock');
  } finally {
    await chain.finish();
  }
});

/** Answers every request to the given gateway hosts with `body` (no real gateway is reached). */
async function gateway(page: Page, hosts: RegExp, body: string): Promise<string[]> {
  const asked: string[] = [];
  await page.route(hosts, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
  });
  return asked;
}

test('Store it elsewhere and link it: fingerprinted here, the address checked, one send; the Preview offers public gateways, then verifies (or rejects wrong bytes)', async ({
  page,
}) => {
  const chain = await testChain(
    'client-link-file',
    'The realm root; anvil #6 links talk.txt (ar://), then notes.txt (ipfs://), and checks a file too large for the chain is offered linking.',
  );
  const TALK = 'Hello from Arweave\n';
  const AR_ID = 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U';
  const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  try {
    // The public gateways answer the right bytes; the test's own IPFS gateway answers wrong ones.
    const arweave = await gateway(page, /^https:\/\/(arweave\.net|ar-io\.net)\//, TALK);
    await gateway(page, /^https:\/\/ipfs\.example\.net\//, 'not the bytes that were linked\n');
    await openRoot(page, chain);

    // Too large for the chain: the plan says so and offers to link it instead.
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({
        name: 'big.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(1_500_000, 7),
      });
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page)).toContainText('This file is too large to save here');
    await press(dialog(page).locator('wa-button.efs-link-offer'));
    await expect(dialog(page).locator('.efs-link-fingerprint')).toContainText(/0x[0-9a-f]{64}/);
    await press(dialog(page).locator('wa-button', { hasText: 'Cancel' }));
    await expect(dialog(page)).not.toHaveAttribute('open');
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('A file too large for the chain: refused, with "Store it elsewhere and link it"');

    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({ name: 'talk.txt', mimeType: 'text/plain', buffer: Buffer.from(TALK) });
    await press(dialog(page).locator('wa-button.efs-link-offer'));
    const link = dialog(page);
    await expect(link.locator('.efs-link-fingerprint')).toContainText(
      // SHA-256 of TALK, made on this device.
      /0x[0-9a-f]{64}/,
    );
    await expect(link.locator('.efs-link-fingerprint')).toContainText('19 bytes');
    const where = link.locator('wa-input.efs-link-locator input');
    await where.fill('ftp://example.org/talk.txt');
    await expect(link.locator('.efs-link-rule')).toContainText(
      'Use an ipfs://, ar:// or https:// address.',
    );
    await expect(link.locator('wa-button.efs-link-review')).toHaveAttribute('disabled', '');
    await where.fill('ar://too-short');
    await expect(link.locator('.efs-link-rule')).toContainText(
      "doesn't look like a complete address",
    );
    await where.fill(`ar://${AR_ID}`);
    await expect(link.locator('.efs-link-rule')).toHaveCount(0);
    await press(link.locator('wa-button.efs-link-review'));
    await expect(link.locator('.efs-link-says')).toContainText(/Links\W+talk\.txt\W+in/);
    await expect(link.locator('.efs-link-where')).toHaveText(`ar://${AR_ID}`);
    await expect(link.locator('.efs-link-promise')).toContainText(
      'The bytes stay where you put them. The chain keeps only their fingerprint.',
    );
    await expect(link.locator('.efs-link-promise')).toContainText('never as different bytes');
    await expect(link).toContainText('One approval in your wallet.');
    chain.step(
      'Link talk.txt at ar://…: fingerprinted here, the address checked, the review says what is kept',
    );

    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'talk.txt')).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    chain.step('Send: one approval; talk.txt is listed');

    // No Arweave gateway is set up (the client ships none): the Preview says so and offers.
    await press(row(page, 'talk.txt').locator('a.efs-entry-open'));
    const offer = preview(page).locator('.efs-gateway-offer');
    await expect(offer).toContainText('This file is stored on Arweave');
    await expect(offer.locator('.efs-gateway-note')).toContainText(
      /arweave\.net, ar-io\.net\W+see your IP address and which file you read/,
    );
    expect(arweave).toEqual([]);
    chain.step(
      'Open it: stored on Arweave, no gateway: "Use public gateways", named, never on silently',
    );

    await press(offer.locator('wa-button.efs-gateway-public'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(TALK, { timeout: 20_000 });
    await expect(preview(page).locator('.efs-gateway-offer')).toHaveCount(0);
    expect(arweave.length).toBeGreaterThan(0);
    await chain.idle(500);
    chain.step('Use public gateways: saved as a setting; the copy is fetched and verified');

    // A host answering different bytes: rejected, never shown as the file.
    await press(page.locator('efs-files-view wa-breadcrumb-item').first());
    await entries(page)
      .locator('input.efs-upload-input')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes\n') });
    await press(dialog(page).locator('wa-button.efs-link-offer'));
    await dialog(page).locator('wa-input.efs-link-locator input').fill(`ipfs://${CID}`);
    await press(dialog(page).locator('wa-button.efs-link-review'));
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await press(row(page, 'notes.txt').locator('a.efs-entry-open'));
    await expect(preview(page).locator('efs-outcome')).toContainText(
      "don't match the published fingerprint",
      { timeout: 20_000 },
    );
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(2);
    await chain.idle(500);
    chain.step('notes.txt at ipfs://…, whose host answers other bytes: rejected, never shown');
  } finally {
    await chain.finish();
  }
});

for (const [how, pressTwice] of Object.entries(DOUBLE_PRESSES)) {
  test(`a folder save whose Send is pressed twice (${how}) is sent once`, async ({ page }) => {
    const name = `once-${how}`;
    const chain = await testChain(
      `client-folder-send-once-${how}`,
      `The realm root; New folder "${name}", then Send pressed twice (${how}) before the page re-renders: one save.`,
    );
    try {
      await openRoot(page, chain);
      await press(entries(page).locator('wa-button.efs-new-folder'));
      await dialog(page).locator('wa-input.efs-folder-name input').fill(name);
      await press(dialog(page).locator('wa-button.efs-folder-review'));
      await expect(send(page)).toBeVisible();
      await pressTwice(send(page));
      chain.step(`Send, twice (${how}): one runSequence, one eth_sendTransaction`);
      await expect(dialog(page)).not.toHaveAttribute('open');
      await expect(row(page, name).locator('.efs-entry-whose')).toHaveText('yours');
      await chain.idle(500);
      expect(sendRequests(chain)).toHaveLength(1);
      // The page's own count: the second press started nothing.
      expect(await sendsStarted(page)).toBe(1);
    } finally {
      await chain.finish();
    }
  });
}

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

// The Files app by keyboard alone, with axe on every dialog and state: create, rename, move,
// remove and restore, upload, a new text file, and a selection. Each step is reached by focus and
// a key (never a mouse click), so the manual VoiceOver / NVDA pass has less to find. Recorded
// against the fixture chain like folder-writes (its own transcripts), replayed in all browsers.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect, preview, sendRequests } from './edit-support.ts';
import {
  dialog,
  entries,
  fileAtRoot,
  openRoot,
  picker,
  pickerRow,
  row,
  send,
  withInbox,
} from './folder-support.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** axe once nothing is animating (a dialog fading in or out measures as low contrast). */
const axe = async (page: Page) => {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  // WebKit doesn't list a dialog's own transition there: wait until every open one is opaque.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('wa-dialog[open]')].every((d) => {
      const panel = d.shadowRoot?.querySelector('dialog');
      return !panel || getComputedStyle(panel).opacity === '1';
    }),
  );
  return (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
};

/**
 * The realm root, connected as anvil #6, once the wallet dialog has finished closing: it gives
 * focus back to the wallet button on a timer, which would otherwise take focus from the first
 * step (and axe would measure the dialog mid-fade).
 */
async function start(page: Page, chain: Parameters<typeof openRoot>[1]): Promise<void> {
  await openRoot(page, chain);
  await expect(page.locator('efs-wallet wa-button.efs-wallet-button')).toBeFocused();
}

/** Focus, then Enter: a control reached and pressed by keyboard (never a mouse click). */
async function activate(page: Page, target: ReturnType<Page['locator']>): Promise<void> {
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

/**
 * Holds back the chunk that brings the name check (the SDK's own module, fetched when a naming
 * dialog first opens), so the keys below land before it arrives: the race a fast typist meets.
 */
async function slowNameCheck(page: Page): Promise<void> {
  await page.route(/\/dist-[\w-]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
}

/** Focus is somewhere meaningful, never dropped on the page. */
async function focusKept(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
}

test('New folder by keyboard: the name takes focus; Enter twice before the name check arrives plans once; axe clean throughout', async ({
  page,
}) => {
  const chain = await testChain(
    'client-a11y-create',
    'The realm root, then a new folder by keyboard.',
  );
  try {
    await start(page, chain);
    expect(await axe(page), 'listing').toEqual([]);
    await slowNameCheck(page);
    await activate(page, entries(page).locator('wa-button.efs-new-folder'));
    await expect(dialog(page).locator('wa-input.efs-folder-name')).toBeFocused();
    // Typed and Enter twice before the name check has even arrived (held back above): the
    // Enter waits for it, and plans once, never twice.
    await page.keyboard.type('projects');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText(/Creates the folder\W+projects\W+in\W+Root/);
    // Exactly one plan for this naming (the dialog counts them: data-plans).
    await expect(page.locator('efs-files-folder-save')).toHaveAttribute('data-plans', '1');
    expect(await axe(page), 'review').toEqual([]);
    chain.step('Keyboard: New folder, type, Enter: reviewed');
    await activate(page, send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'projects')).toBeVisible();
    await expect(entries(page).locator('wa-button.efs-new-folder')).toBeFocused();
    expect(await axe(page), 'after the save').toEqual([]);
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Send by keyboard: one send; focus back on New folder');
  } finally {
    await chain.finish();
  }
});

test('Rename by keyboard: the name is selected for editing, a refused name is announced, Enter reviews, Send by keyboard', async ({
  page,
}) => {
  const chain = await testChain('client-a11y-rename', 'draft.txt by anvil #6 at the root.');
  try {
    await fileAtRoot(chain, 6, 'draft.txt', 'first words\n');
    await start(page, chain);
    await activate(page, row(page, 'draft.txt').locator('wa-button.efs-entry-rename'));
    const name = dialog(page).locator('wa-input.efs-folder-name');
    await expect(name).toBeFocused();
    await expect(name.locator('input')).toHaveValue('draft.txt');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('final.txt ');
    // A refused name is announced (an alert), and Enter does nothing with it.
    await expect(dialog(page).locator('[role="alert"]')).toContainText(
      "A name can't start or end with a space.",
    );
    expect(await axe(page), 'name refused').toEqual([]);
    await page.keyboard.press('Enter');
    await expect(dialog(page).locator('wa-input.efs-folder-name')).toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toContainText(/Rename\W+draft\.txt\W+to\W+final\.txt/);
    expect(await axe(page), 'rename review').toEqual([]);
    await activate(page, send(page));
    await expect(row(page, 'final.txt')).toBeVisible();
    await focusKept(page);
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Keyboard: Rename draft.txt to final.txt; one send');
  } finally {
    await chain.finish();
  }
});

test('Move by keyboard: the picker walks up and in by keyboard; Move here and Send by keyboard; axe clean', async ({
  page,
}) => {
  const chain = await testChain('client-a11y-move', 'inbox/{note.txt, sub/} and archive/.');
  try {
    await withInbox(chain);
    await start(page, chain);
    await activate(page, row(page, 'inbox').locator('button.efs-entry-open'));
    await expect(row(page, 'note.txt')).toBeVisible();
    await activate(page, row(page, 'note.txt').locator('wa-button.efs-entry-move'));
    await expect(pickerRow(page, 'sub')).toBeVisible();
    expect(await axe(page), 'picker').toEqual([]);
    // A breadcrumb item without a link is a real <button> inside it: that's what Tab reaches.
    await activate(page, picker(page).locator('wa-breadcrumb-item').first().locator('button'));
    await expect(pickerRow(page, 'archive')).toBeVisible();
    await activate(page, pickerRow(page, 'archive').locator('button.efs-entry-open'));
    await expect(picker(page)).toContainText('No folders in here.');
    await activate(page, dialog(page).locator('wa-button.efs-move-here'));
    await expect(dialog(page)).toContainText(/Move\W+note\.txt\W+to\W+archive/);
    expect(await axe(page), 'move review').toEqual([]);
    await activate(page, send(page));
    await expect(row(page, 'note.txt')).toHaveCount(0);
    await focusKept(page);
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Keyboard: Move note.txt into archive/; one send');
  } finally {
    await chain.finish();
  }
});

test('Remove and Restore by keyboard: Keep it takes focus, Escape keeps; Remove, then Restore from the notice', async ({
  page,
}) => {
  const chain = await testChain(
    'client-a11y-remove-restore',
    'shared.txt at the root by anvil #0 (the owner) and by anvil #6.',
  );
  try {
    await fileAtRoot(chain, 0, 'shared.txt', "the owner's\n");
    await fileAtRoot(chain, 6, 'shared.txt', 'mine\n');
    await start(page, chain);
    const remove = row(page, 'shared.txt').locator('wa-button.efs-entry-remove');
    await activate(page, remove);
    await expect(dialog(page).locator('wa-button.efs-folder-keep')).toBeFocused();
    expect(await axe(page), 'remove review').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(remove).toBeFocused();
    expect(sendRequests(chain)).toHaveLength(0);
    chain.step('Keyboard: Remove, Escape: kept, focus back on Remove');

    await activate(page, remove);
    await expect(dialog(page).locator('wa-button.efs-folder-keep')).toBeFocused();
    await activate(page, send(page));
    const notice = entries(page).locator('.efs-entries-removed');
    await expect(notice).toContainText(/removed\W+shared\.txt/);
    await expect(notice).toHaveAttribute('role', 'status');
    expect(await axe(page), 'removal notice').toEqual([]);
    chain.step('Keyboard: Remove: one send; the notice is a status');

    await activate(page, entries(page).locator('wa-button.efs-entries-restore'));
    await expect(dialog(page)).toContainText(/Restore\W+shared\.txt\W+here/);
    expect(await axe(page), 'restore review').toEqual([]);
    await activate(page, send(page));
    await expect(row(page, 'shared.txt').locator('.efs-entry-whose')).toHaveText('yours');
    await focusKept(page);
    expect(sendRequests(chain)).toHaveLength(2);
    await chain.idle(500);
    chain.step('Keyboard: Restore from the notice: yours is back');
  } finally {
    await chain.finish();
  }
});

/** A 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('Upload by keyboard: Enter on Upload opens the file chooser; the name takes focus; Enter reviews', async ({
  page,
}) => {
  const chain = await testChain(
    'client-a11y-upload',
    'The realm root; upload pic.png by keyboard.',
  );
  try {
    await start(page, chain);
    const upload = entries(page).locator('wa-button.efs-upload');
    await upload.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await expect(dialog(page).locator('wa-input.efs-folder-name')).toBeFocused();
    expect(await axe(page), 'upload naming').toEqual([]);
    await page.keyboard.press('Enter');
    await expect(dialog(page).locator('.efs-upload-type')).toContainText(/image\/png/);
    expect(await axe(page), 'upload review').toEqual([]);
    await activate(page, send(page));
    await expect(row(page, 'pic.png')).toBeVisible();
    await focusKept(page);
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Keyboard: Upload pic.png; one send');
  } finally {
    await chain.finish();
  }
});

test('New text file by keyboard: Enter twice before the name check arrives writes it once; focus lands in the text; Review and Send by keyboard', async ({
  page,
}) => {
  const chain = await testChain(
    'client-a11y-new-file',
    'The realm root; a new hello.txt by keyboard.',
  );
  try {
    await start(page, chain);
    await slowNameCheck(page);
    await activate(page, entries(page).locator('wa-button.efs-new-file'));
    await expect(dialog(page).locator('wa-input.efs-folder-name')).toBeFocused();
    await page.keyboard.type('hello.txt');
    // Enter twice, quickly: the editor is started once, never twice.
    await page.evaluate(() => {
      const w = window as unknown as { __composes: number };
      w.__composes = 0;
      document.addEventListener('efs-compose', () => w.__composes++, true);
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const editor = preview(page).locator('efs-file-editor');
    await expect(editor.locator('textarea.efs-edit-text')).toBeFocused();
    expect(
      await page.evaluate(() => (window as unknown as { __composes: number }).__composes),
    ).toBe(1);
    await expect(preview(page).locator('efs-file-editor')).toHaveCount(1);
    await page.keyboard.type('Hello by keyboard.\n');
    expect(await axe(page), 'new file editor').toEqual([]);
    await activate(page, editor.locator('wa-button.efs-edit-review-button'));
    const review = page.locator('wa-dialog.efs-edit-review');
    await expect(review).toContainText(/Creates\W+hello\.txt\W+in/);
    expect(await axe(page), 'new file review').toEqual([]);
    await activate(page, review.locator('wa-button.efs-review-send'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Hello by keyboard.\n');
    // The editor is gone: focus lands on the new file's Edit, never on the page.
    await expect(preview(page).locator('wa-button.efs-edit-start')).toBeFocused();
    expect(sendRequests(chain)).toHaveLength(1);
    await chain.idle(500);
    chain.step('Keyboard: New text file hello.txt; one send; it opens by its link');
  } finally {
    await chain.finish();
  }
});

test('A selection by keyboard: Space selects rows, the bar is reachable, its Remove reviews both; Escape sends nothing', async ({
  page,
}) => {
  const chain = await testChain('client-a11y-select', 'a.txt and b.txt by anvil #6 at the root.');
  try {
    await fileAtRoot(chain, 6, 'a.txt', 'a\n');
    await fileAtRoot(chain, 6, 'b.txt', 'b\n');
    await start(page, chain);
    for (const name of ['a.txt', 'b.txt']) {
      const box = row(page, name).locator('input.efs-entry-select');
      await box.focus();
      await page.keyboard.press('Space');
      await expect(box).toBeChecked();
    }
    const bar = entries(page).locator('.efs-selection');
    await expect(bar.locator('[role="status"]')).toContainText('2 selected');
    expect(await axe(page), 'selection').toEqual([]);
    await activate(page, bar.locator('wa-button.efs-selection-remove'));
    await expect(dialog(page)).toContainText(/These\W+2\W+entries of yours/);
    expect(await axe(page), 'selection review').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open');
    expect(sendRequests(chain)).toHaveLength(0);
    await chain.idle(500);
    chain.step('Keyboard: select two, Remove reviews both, Escape keeps them');
  } finally {
    await chain.finish();
  }
});

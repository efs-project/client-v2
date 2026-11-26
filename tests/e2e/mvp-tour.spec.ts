// The MVP tour: James's brief, in its order, as a person clicks it on `pnpm demo`'s seed
// (tools/dev/demo.ts) with the dev accounts' personas (PM, 2026-11-26). Each save asserts what
// the person reads and exactly one wallet request: a dev account's save is one eth_sendTransaction
// over the RPC (`chain.rpcSends`), and the chain signs it. README "Try it" walks the same steps.

import { test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect, preview, save } from './edit-support.ts';
import { dialog, entries, row, seededRandom, send } from './folder-support.ts';
import { press } from './press.ts';
import { booted, serveConfig, serveDeployment, TEST_CONFIG } from './support.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

const SATOSHI = { name: 'Satoshi Nakamoto', address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' };
const HAL = { name: 'Hal Finney', address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' };

/** The test network as `pnpm demo` serves it: a local RPC and its dev accounts. */
const DEMO_CONFIG = {
  ...TEST_CONFIG,
  networks: TEST_CONFIG.networks.map((n) => ({
    ...n,
    rpcs: [{ url: 'http://127.0.0.1:8545/', label: 'Local test chain' }],
    devAccounts: [SATOSHI, HAL],
  })),
};

test('the MVP tour: folders and files, a tag from the Preview, an address, kind filters, and whose curation applies', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const chain = await testChain(
    'client-mvp-tour',
    "pnpm demo's seed, with dev-account personas. As Satoshi Nakamoto in Notes/: New folder, New text file, Rename, Remove, Restore; tag todo.txt from the Preview as \"My Notes\" (saved as /my_notes), then take it back; attach a file at Hal Finney's address; filter Notes/ and photos/sunsets by kind. Then switch to Hal: the curators line changes, and Satoshi's name for photos/sunsets still applies. One RPC eth_sendTransaction per save.",
  );
  const walletButton = page.locator('efs-wallet wa-button.efs-wallet-button');
  const chooser = page.locator('wa-dialog.efs-dev-accounts');
  const persona = (name: string) => chooser.locator('button.efs-entry-open', { hasText: name });
  const topic = page.locator('efs-files-topic');
  const editor = preview(page).locator('efs-file-editor');
  const go = (hash: string) =>
    page.evaluate((h) => {
      location.hash = h;
    }, hash);
  /** No tag list or word page is reading: what it shows is what it read. */
  const settled = () =>
    expect(
      page.locator(
        'efs-files-topic[data-reading], efs-files-word[data-reading], efs-files-tag-picker[data-reading]',
      ),
    ).toHaveCount(0);
  /** Saves so far: one dev-account eth_sendTransaction each. */
  let saves = 0;
  const saved = async (what: string) => {
    saves++;
    await expect.poll(() => chain.rpcSends.length, { message: `${what}: one send` }).toBe(saves);
  };
  try {
    await chain.seedDemo();
    const ids = chain.ids;
    await seededRandom(page);
    await chain.attach(page);
    await serveConfig(page, DEMO_CONFIG);
    await serveDeployment(page, chain.deployment);
    await page.goto('./#/r/testnet/');
    await booted(page);
    await expect(row(page, 'Notes')).toBeVisible();
    await press(walletButton);
    await press(
      page.locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-option', {
        hasText: 'EFS dev accounts',
      }),
    );
    await press(persona(SATOSHI.name));
    await expect(walletButton).toContainText(SATOSHI.name);
    await page.keyboard.press('Escape');
    chain.step('The demo root; Connect with EFS dev accounts as Satoshi Nakamoto');

    // 1. Folders and files, in Notes/ (Satoshi's).
    await press(row(page, 'Notes').locator('button.efs-entry-open'));
    await expect(row(page, 'todo.txt')).toBeVisible();
    await press(entries(page).locator('wa-button.efs-new-folder'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('drafts');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    // Notes/ is Satoshi's: his own rows carry no label, and are his to change.
    await expect(row(page, 'drafts').locator('wa-button.efs-entry-remove')).toHaveCount(1);
    await expect(row(page, 'drafts').locator('.efs-entry-whose')).toHaveCount(0);
    await saved('New folder drafts');
    chain.step('Notes/ (his): New folder drafts, his to change');

    await press(entries(page).locator('wa-button.efs-new-file'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('plan.txt');
    await press(dialog(page).locator('wa-button.efs-folder-write'));
    await editor.locator('textarea.efs-edit-text').fill('Try every step of the tour.\n');
    await press(editor.locator('wa-button.efs-edit-review-button'));
    await press(page.locator('wa-dialog.efs-edit-review wa-button.efs-review-send'));
    await expect(save(page, 'confirming').or(save(page, 'saved'))).toContainText('Saved');
    await expect(row(page, 'plan.txt').locator('wa-button.efs-entry-rename')).toHaveCount(1);
    await saved('New text file plan.txt');
    chain.step('New text file plan.txt: written, reviewed, Saved · confirming, listed');

    await press(row(page, 'plan.txt').locator('wa-button.efs-entry-rename'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('plan-v2.txt');
    await press(dialog(page).locator('wa-button.efs-folder-review'));
    await expect(dialog(page)).toContainText(/Rename\W+plan\.txt\W+to\W+plan-v2\.txt/);
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'plan-v2.txt')).toBeVisible();
    await expect(row(page, 'plan.txt')).toHaveCount(0);
    await saved('Rename to plan-v2.txt');
    chain.step('Rename plan.txt to plan-v2.txt');

    await press(row(page, 'plan-v2.txt').locator('wa-button.efs-entry-remove'));
    await expect(dialog(page)).toContainText(/Your\W+plan-v2\.txt\W+stops appearing here/);
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'plan-v2.txt')).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /removed\W+plan-v2\.txt/,
    );
    await saved('Remove plan-v2.txt');
    await press(entries(page).locator('wa-button.efs-entries-restore'));
    await expect(dialog(page)).toContainText(/Restore\W+plan-v2\.txt\W+here/);
    await press(send(page));
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'plan-v2.txt').locator('wa-button.efs-entry-remove')).toHaveCount(1);
    await saved('Restore plan-v2.txt');
    chain.step('Remove plan-v2.txt (said as removed, with Restore), then Restore: it is back');

    // 2. A tag from the Preview, typed as "My Notes": saved as /my_notes, then taken back.
    await press(row(page, 'todo.txt').getByRole('link'));
    await expect(preview(page).locator('.efs-preview-text')).toContainText('Try the demo');
    // The file's Tags, open before tagging: they read again once the tag is saved (no reload).
    const fileTags = preview(page).locator('efs-files-file-tags');
    const fileTag = (path: string) => fileTags.locator('.efs-file-tag', { hasText: path });
    await press(fileTags.locator('summary'));
    await expect(fileTag('/notes/todo')).toHaveCount(1);
    await expect(fileTag('/my_notes')).toHaveCount(0);
    await press(preview(page).locator('wa-button.efs-preview-tag'));
    const tagDialog = page.locator('efs-files-folder-save.efs-preview-tag-dialog wa-dialog');
    await tagDialog.locator('wa-input.efs-tag-path input').fill('My Notes');
    await expect(tagDialog.locator('.efs-tag-folded')).toContainText(/Saved as\W+\/my_notes/);
    // The picker's lookup of the word is done before Review (it is debounced).
    await settled();
    await press(tagDialog.locator('wa-button.efs-tag-review'));
    await expect(tagDialog.locator('.efs-tag-says')).toContainText(/\/my_notes/);
    await press(tagDialog.locator('wa-button.efs-folder-send'));
    await expect(tagDialog).not.toHaveAttribute('open');
    await saved('Tag /my_notes');
    const tagged = preview(page).locator('.efs-preview-tagged');
    await expect(tagged).toContainText(/Tagged\W+\/my_notes/);
    await expect(fileTag('/my_notes')).toHaveCount(1);
    await expect(fileTag('/notes/todo')).toHaveCount(1);
    chain.step(
      'Tag todo.txt from the Preview: "My Notes" is saved as /my_notes; "Tagged /my_notes", and the open Tags list shows it',
    );

    // The notice's "Open the tag": the tag's own list (one word, so not its word's page).
    await press(tagged.locator('wa-button.efs-tagged-open'));
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/my_notes');
    await settled();
    const mine = topic.locator('[data-section="lens"]');
    await expect(mine.locator('.efs-entry-name')).toHaveText('todo.txt');
    await expect(mine).toContainText('tagged by you');
    // Opened from the list, the file shows beside it with its Tags; taking the tag back there
    // reads them again too.
    await press(mine.locator('.efs-topic-row button.efs-entry-open').first());
    await expect(preview(page).locator('.efs-preview-text')).toContainText('Try the demo');
    await press(fileTags.locator('summary'));
    await expect(fileTag('/my_notes')).toHaveCount(1);
    await press(mine.locator('wa-button.efs-topic-untag'));
    const untag = page.locator('efs-files-folder-save.efs-topic-tag-dialog wa-dialog');
    await expect(untag.locator('.efs-tag-untag')).toContainText('Your tag goes');
    await press(untag.locator('wa-button.efs-folder-send'));
    await expect(untag).not.toHaveAttribute('open');
    await saved('Remove my tag');
    await expect(fileTag('/my_notes')).toHaveCount(0);
    await expect(fileTag('/notes/todo')).toHaveCount(1);
    chain.step(
      'Open the tag: todo.txt tagged by you; opened beside it, Remove my tag; its Tags no longer list /my_notes',
    );

    // 3. A file at an address: Hal Finney's.
    await go(`#/r/testnet/${ids['demo.address']}`);
    await expect(row(page, 'about.txt')).toBeVisible();
    await press(entries(page).locator('wa-button.efs-new-file'));
    await dialog(page).locator('wa-input.efs-folder-name input').fill('hello-hal.txt');
    await press(dialog(page).locator('wa-button.efs-folder-write'));
    await editor.locator('textarea.efs-edit-text').fill('Hello, Hal.\n');
    await press(editor.locator('wa-button.efs-edit-review-button'));
    await press(page.locator('wa-dialog.efs-edit-review wa-button.efs-review-send'));
    await expect(row(page, 'hello-hal.txt').locator('.efs-entry-whose')).toHaveText('yours');
    await saved('hello-hal.txt at Hal Finney');
    chain.step("Hal Finney's address: New text file hello-hal.txt; listed there as yours");

    // 4. Kind filters, with what they leave out counted.
    await go('#/r/testnet/');
    await press(row(page, 'Notes').locator('button.efs-entry-open'));
    await expect(row(page, 'drafts')).toBeVisible();
    await press(entries(page).locator('wa-select.efs-entries-filter'));
    await press(entries(page).locator('wa-option[value="folder"]'));
    await expect(row(page, 'drafts')).toBeVisible();
    await expect(row(page, 'todo.txt')).toHaveCount(0);
    await expect(entries(page)).toContainText(/\d+\W+other entries hidden by the filter/);
    chain.step('Notes/ filtered to Folders: drafts; the files are counted as hidden');

    await go(`#/r/testnet/${ids['demo.tag']}`);
    await expect(topic.locator('.efs-topic-row').first()).toBeVisible();
    await settled();
    await press(topic.locator('wa-select.efs-topic-kind'));
    await press(topic.locator('wa-option[value="folder"]'));
    await expect(topic.locator('.efs-topic-row')).toHaveCount(0);
    await expect(topic.locator('.efs-topic-filtered')).toContainText(
      /\d+\W+other entries hidden by the filter/,
    );
    await expect(topic.locator('.efs-topic-empty')).toHaveCount(0);
    chain.step('photos/sunsets filtered to Folders: none, the files counted as hidden');

    // 5. Whose curation applies: Satoshi's names, for Satoshi and for Hal.
    await settled();
    await press(topic.locator('wa-select.efs-topic-kind'));
    await press(topic.locator('wa-option[value="all"]'));
    const curators = topic.locator('.efs-lens-curators');
    await expect(curators).toHaveText(/from:\s+you\s*$/);
    await expect(topic.locator('.efs-topic-title')).toContainText('Sunset photos');
    await press(walletButton);
    await press(page.locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-switch-persona'));
    await press(persona(HAL.name));
    await expect(walletButton).toContainText(HAL.name);
    await page.keyboard.press('Escape');
    await expect(curators).toHaveText(/from:\s+you, Satoshi Nakamoto\s*$/);
    await settled();
    // Satoshi's name for this tag still applies to Hal: he is in Hal's Lens, after Hal.
    await expect(topic.locator('.efs-topic-title')).toContainText('Sunset photos');
    await chain.idle(500);
    chain.step(
      'As Satoshi: from you; switch to Hal Finney: from you, Satoshi Nakamoto, and "Sunset photos" still names it',
    );
    expect(chain.rpcSends).toHaveLength(saves);
  } finally {
    await chain.finish();
  }
});

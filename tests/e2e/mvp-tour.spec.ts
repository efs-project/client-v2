// The MVP tour: James's brief, in its order, as a person clicks it on `pnpm demo`'s seed
// (tools/dev/demo.ts) with the dev accounts' personas (PM, 2026-11-26). Each save asserts what
// the person reads and exactly one wallet request: a dev account's save is one eth_sendTransaction
// over the RPC (`chain.rpcSends`), and the chain signs it. README "Try it" walks the same steps.

import { test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect, preview, save } from './edit-support.ts';
import { dialog, entries, row, seededRandom, send } from './folder-support.ts';
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
    expect(page.locator('efs-files-topic[data-reading], efs-files-word[data-reading]')).toHaveCount(
      0,
    );
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
    await walletButton.click();
    await page
      .locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-option', {
        hasText: 'EFS dev accounts',
      })
      .click();
    await persona(SATOSHI.name).click();
    await expect(walletButton).toContainText(SATOSHI.name);
    await page.keyboard.press('Escape');
    chain.step('The demo root; Connect with EFS dev accounts as Satoshi Nakamoto');

    // 1. Folders and files, in Notes/ (Satoshi's).
    await row(page, 'Notes').locator('button.efs-entry-open').click();
    await expect(row(page, 'todo.txt')).toBeVisible();
    await entries(page).locator('wa-button.efs-new-folder').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('drafts');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    // Notes/ is Satoshi's: his own rows carry no label, and are his to change.
    await expect(row(page, 'drafts').locator('wa-button.efs-entry-remove')).toHaveCount(1);
    await expect(row(page, 'drafts').locator('.efs-entry-whose')).toHaveCount(0);
    await saved('New folder drafts');
    chain.step('Notes/ (his): New folder drafts, his to change');

    await entries(page).locator('wa-button.efs-new-file').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('plan.txt');
    await dialog(page).locator('wa-button.efs-folder-write').click();
    await editor.locator('textarea.efs-edit-text').fill('Try every step of the tour.\n');
    await editor.locator('wa-button.efs-edit-review-button').click();
    await page.locator('wa-dialog.efs-edit-review wa-button.efs-review-send').click();
    await expect(save(page, 'confirming').or(save(page, 'saved'))).toContainText('Saved');
    await expect(row(page, 'plan.txt').locator('wa-button.efs-entry-rename')).toHaveCount(1);
    await saved('New text file plan.txt');
    chain.step('New text file plan.txt: written, reviewed, Saved · confirming, listed');

    await row(page, 'plan.txt').locator('wa-button.efs-entry-rename').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('plan-v2.txt');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await expect(dialog(page)).toContainText(/Rename\W+plan\.txt\W+to\W+plan-v2\.txt/);
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'plan-v2.txt')).toBeVisible();
    await expect(row(page, 'plan.txt')).toHaveCount(0);
    await saved('Rename to plan-v2.txt');
    chain.step('Rename plan.txt to plan-v2.txt');

    await row(page, 'plan-v2.txt').locator('wa-button.efs-entry-remove').click();
    await expect(dialog(page)).toContainText(/Your\W+plan-v2\.txt\W+stops appearing here/);
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'plan-v2.txt')).toHaveCount(0);
    await expect(entries(page).locator('.efs-entries-removed')).toContainText(
      /removed\W+plan-v2\.txt/,
    );
    await saved('Remove plan-v2.txt');
    await entries(page).locator('wa-button.efs-entries-restore').click();
    await expect(dialog(page)).toContainText(/Restore\W+plan-v2\.txt\W+here/);
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'plan-v2.txt').locator('wa-button.efs-entry-remove')).toHaveCount(1);
    await saved('Restore plan-v2.txt');
    chain.step('Remove plan-v2.txt (said as removed, with Restore), then Restore: it is back');

    // 2. A tag from the Preview, typed as "My Notes": saved as /my_notes, then taken back.
    await row(page, 'todo.txt').getByRole('link').click();
    await expect(preview(page).locator('.efs-preview-text')).toContainText('Try the demo');
    await preview(page).locator('wa-button.efs-preview-tag').click();
    const tagDialog = page.locator('efs-files-folder-save.efs-preview-tag-dialog wa-dialog');
    await tagDialog.locator('wa-input.efs-tag-path input').fill('My Notes');
    await expect(tagDialog.locator('.efs-tag-folded')).toContainText(/Saved as\W+\/my_notes/);
    await tagDialog.locator('wa-button.efs-tag-review').click();
    await expect(tagDialog.locator('.efs-tag-says')).toContainText(/\/my_notes/);
    await tagDialog.locator('wa-button.efs-folder-send').click();
    await expect(tagDialog).not.toHaveAttribute('open');
    await saved('Tag /my_notes');
    chain.step('Tag todo.txt from the Preview: "My Notes" is saved as /my_notes');

    await go('#/r/testnet/my_notes');
    const plain = page.locator('efs-files-word .efs-word-group[data-root="yes"]');
    await expect(plain).toContainText(/\/my_notes/);
    await settled();
    await plain.locator('wa-button.efs-word-open').click();
    await settled();
    const mine = topic.locator('[data-section="lens"]');
    await expect(mine.locator('.efs-entry-name')).toHaveText('todo.txt');
    await expect(mine).toContainText('tagged by you');
    await mine.locator('wa-button.efs-topic-untag').click();
    const untag = page.locator('efs-files-folder-save.efs-topic-tag-dialog wa-dialog');
    await expect(untag.locator('.efs-tag-untag')).toContainText('Your tag goes');
    await untag.locator('wa-button.efs-folder-send').click();
    await expect(untag).not.toHaveAttribute('open');
    await expect(topic.locator('.efs-topic-empty')).toBeVisible({ timeout: 20_000 });
    await saved('Remove my tag');
    chain.step('The word page my_notes, its plain tag: todo.txt tagged by you; Remove my tag');

    // 3. A file at an address: Hal Finney's.
    await go(`#/r/testnet/${ids['demo.address']}`);
    await expect(row(page, 'about.txt')).toBeVisible();
    await entries(page).locator('wa-button.efs-new-file').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('hello-hal.txt');
    await dialog(page).locator('wa-button.efs-folder-write').click();
    await editor.locator('textarea.efs-edit-text').fill('Hello, Hal.\n');
    await editor.locator('wa-button.efs-edit-review-button').click();
    await page.locator('wa-dialog.efs-edit-review wa-button.efs-review-send').click();
    await expect(row(page, 'hello-hal.txt').locator('.efs-entry-whose')).toHaveText('yours');
    await saved('hello-hal.txt at Hal Finney');
    chain.step("Hal Finney's address: New text file hello-hal.txt; listed there as yours");

    // 4. Kind filters, with what they leave out counted.
    await go('#/r/testnet/');
    await row(page, 'Notes').locator('button.efs-entry-open').click();
    await expect(row(page, 'drafts')).toBeVisible();
    await entries(page).locator('wa-select.efs-entries-filter').click();
    await entries(page).locator('wa-option[value="folder"]').click();
    await expect(row(page, 'drafts')).toBeVisible();
    await expect(row(page, 'todo.txt')).toHaveCount(0);
    await expect(entries(page)).toContainText(/\d+\W+other entries hidden by the filter/);
    chain.step('Notes/ filtered to Folders: drafts; the files are counted as hidden');

    await go(`#/r/testnet/${ids['demo.tag']}`);
    await expect(topic.locator('.efs-topic-row').first()).toBeVisible();
    await settled();
    await topic.locator('wa-select.efs-topic-kind').click();
    await topic.locator('wa-option[value="folder"]').click();
    await expect(topic.locator('.efs-topic-row')).toHaveCount(0);
    await expect(topic.locator('.efs-topic-filtered')).toContainText(
      /\d+\W+other entries hidden by the filter/,
    );
    await expect(topic.locator('.efs-topic-empty')).toHaveCount(0);
    chain.step('photos/sunsets filtered to Folders: none, the files counted as hidden');

    // 5. Whose curation applies: Satoshi's names, for Satoshi and for Hal.
    await settled();
    await topic.locator('wa-select.efs-topic-kind').click();
    await topic.locator('wa-option[value="all"]').click();
    const curators = topic.locator('.efs-lens-curators');
    await expect(curators).toHaveText(/from:\s+you\s*$/);
    await expect(topic.locator('.efs-topic-title')).toContainText('Sunset photos');
    await walletButton.click();
    await page.locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-switch-persona').click();
    await persona(HAL.name).click();
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

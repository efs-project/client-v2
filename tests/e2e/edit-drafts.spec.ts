// Unsaved edits that meet the chain (slice H): an edit kept while the person was elsewhere keeps
// the version it started from, so a file that changed meanwhile is never saved over unasked; and
// the banner's "Review changes" never replaces a newer unsaved edit without asking. Replayed on
// every PR (all browsers), live in CI's live-chain job, recorded with `pnpm transcripts:record`.

import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import {
  editAndConnect,
  editor,
  expect,
  openReview,
  preview,
  reviewDialog,
  save,
  sendRequests,
  start,
} from './edit-support.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

/** Two parts on the fixture chain (measured: 150 KiB of text plans as 2 parts, 100 KiB as 1). */
const LARGE = `${'x'.repeat(150 * 1024 - 1)}\n`;

const textarea = (page: Page) => page.locator('textarea.efs-edit-text');

/** Another app route: in-app navigation, never a page load. */
async function leave(page: Page) {
  await page.evaluate(() => {
    location.hash = '#/files';
  });
  await expect(editor(page)).toHaveCount(0);
}

test('an edit kept while away keeps its base: the file changed meanwhile, so Review asks first', async ({
  page,
}) => {
  const chain = await testChain(
    'client-draft-base-changed',
    "Start editing the readme as anvil #6 and leave the file (another app route). Meanwhile its author (#0, first in the default Lens) saves a new version. Back on the file, the edit is back, planned from the version it started on: Review finds the base changed, nothing is sent until the person chooses to save over the new version (one eth_sendTransaction). The saved edit isn't kept as unsaved.",
  );
  try {
    await start(page, chain);
    await editAndConnect(page, chain, 'My kept edit.\n');
    await leave(page);
    chain.step('Leave the file with the edit unsaved');
    await chain.editAs?.(0, 'The author changed it.\n');
    chain.step("Elsewhere: the file's author (#0) saves a new version");
    await page.goBack();
    chain.step('Back on the file: it opens at the new version; the edit comes back');
    await expect(textarea(page)).toHaveValue('My kept edit.\n');
    await expect(editor(page).locator('.efs-edit-kept')).toContainText(
      'This file has changed since you started it',
    );
    await page.locator('wa-button.efs-edit-review-button').click();
    chain.step('Review: BASE_CHANGED (planned from the version the edit started on)');
    const changed = editor(page).locator('.efs-edit-base-changed');
    await expect(changed).toContainText('This file changed since you opened it');
    expect(sendRequests(chain)).toHaveLength(0);
    await changed.locator('wa-button.efs-edit-save-over').click();
    chain.step('Save my edit over the new version: planned from the new head');
    await reviewDialog(page).locator('wa-button.efs-review-send').click();
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(1);
    // Saved, so not unsaved: leaving and coming back opens the file, not the editor.
    await leave(page);
    await page.goBack();
    await expect(preview(page)).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
  } finally {
    await chain.finish();
  }
});

test('"Review changes" asks before replacing a newer unsaved edit of the same file', async ({
  page,
}) => {
  const chain = await testChain(
    'client-draft-reopen-replace',
    'A two-part edit as anvil #6 loses its race (#6 saves the file elsewhere before Send): the banner says the file changed while saving. The person starts a newer edit of the file and leaves it unsaved. Review changes asks before replacing it: Keep my newer edit changes nothing (the old save stays, the newer edit stays); Replace stops the old save and brings its edit back. One eth_sendTransaction in all.',
  );
  try {
    await start(page, chain);
    await editAndConnect(page, chain, LARGE);
    const review = await openReview(page, chain);
    await expect(review).toContainText('2 approvals in your wallet');
    await chain.editAs?.(6, 'Mine, from another tab.\n');
    chain.step('Elsewhere: #6 saves this file (its own HEAD moves)');
    await review.locator('wa-button.efs-review-send').click();
    chain.step('Send: part 1 lands; part 2 (the bind) is refused before the wallet (E_CAS)');
    const changed = save(page, 'changed');
    await expect(changed).toContainText('This file changed while your edit was saving');

    // A newer edit of the same file, left unsaved while another app is open.
    await preview(page).locator('wa-button.efs-edit-start').click();
    await textarea(page).fill('A newer edit.\n');
    await leave(page);
    chain.step('Start a newer edit of the file; leave it unsaved');

    await changed.locator('wa-button.efs-save-reopen').click();
    await expect(changed.locator('.efs-save-confirm')).toContainText(
      'You have a newer unsaved edit of this file',
    );
    await changed.locator('wa-button.efs-save-keep-unsaved').click();
    await expect(changed.locator('.efs-save-confirm')).toHaveCount(0);
    chain.step('Review changes → Keep my newer edit: nothing stopped, nothing replaced');
    await page.goBack();
    await expect(textarea(page)).toHaveValue('A newer edit.\n');
    await expect(save(page, 'changed')).toHaveCount(1);

    await changed.locator('wa-button.efs-save-reopen').click();
    await changed.locator('wa-button.efs-save-replace').click();
    chain.step('Review changes → Replace my newer edit: abandon the old save, reopen its edit');
    await expect(editor(page).locator('.efs-edit-reopened')).toBeVisible();
    await expect(textarea(page)).toHaveValue(LARGE);
    await expect(save(page, 'changed')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

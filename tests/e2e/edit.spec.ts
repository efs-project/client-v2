// Writes, end to end: edit a file from the Preview, review it, approve once, and watch the save
// reach "Saved"; lose the wallet's answer and reload mid-flight, and the next load settles it
// from the ledger without the wallet. The real SDK runs in the page throughout.
//
// The chain is replayed from this client's own recordings by default (every PR, every browser);
// EFS_CHAIN=live runs it against a fresh @efs/fixture chain, and EFS_CHAIN=record re-records
// the transcripts (see tests/e2e/chain.ts).

import { test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import {
  DOUBLE_PRESSES,
  editAndReview,
  expect,
  objectLink,
  openFile,
  pauseClock,
  preview,
  SEEDED,
  save,
  sendRequests,
  sendsStarted,
  start,
} from './edit-support.ts';
import { press } from './press.ts';
import {
  booted,
  replayRpc,
  serveConfig,
  serveDeployment,
  transcript,
  trapWallet,
  walletTouches,
} from './support.ts';

// One chain per test, driven from the test: in live and record modes, one browser is enough.
test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

const sends = (chain: TestChain) => sendRequests(chain);

test('edit, review, one approval: Saved · confirming, and Show my version reads it back', async ({
  page,
}) => {
  const text = 'Meeting moved to 11:00.\n';
  const chain = await testChain(
    'client-edit-one-approval',
    "Edit docs/readme.txt as anvil #6 from a link carrying the sharer's Lens (the fixture author first): connect, review (not visible in that Lens), one approval, Saved · confirming; Show my version reads the edit back.",
  );
  try {
    await start(page, chain, undefined, true);
    chain.step(
      "Open docs/readme.txt by object link with the sharer's Lens: pin, openFile, readBytes",
    );
    const review = await editAndReview(page, chain, text, true);
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: runSequence (one part, one eth_sendTransaction)');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    await expect(review).toHaveCount(0);
    expect(sends(chain)).toHaveLength(1);
    // This view still shows the fixture's version; the person can put theirs first.
    await press(preview(page).locator('wa-button.efs-edit-show-mine'));
    chain.step('Show my version: openFile and readBytes under mineFirst(account)');
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(text);
    await expect(preview(page).locator('.efs-viewing-mine')).toBeVisible();
  } finally {
    await chain.finish();
  }
});

test('a reload mid-flight is settled from the ledger, wallet-free: Saved · confirming, then Saved', async ({
  page,
}) => {
  const text = 'Meeting moved to 11:30.\n';
  const chain = await testChain(
    'client-edit-reload-resume',
    'Edit docs/readme.txt as anvil #6; the wallet broadcasts but its answer is lost and the page is left while the transaction is pending. The next load settles it from the ledger with no wallet request (Saved · confirming); once its block is finalized, the banner says Saved. One eth_sendTransaction in all.',
  );
  try {
    await page.clock.install();
    await start(page, chain);
    chain.step('Open docs/readme.txt by object link: pin, openFile, readBytes');
    const review = await editAndReview(page, chain, text);
    await chain.control?.automine(false);
    chain.dropNextSendResponse();
    await press(review.locator('wa-button.efs-review-send'));
    chain.step(
      'Send: the wallet broadcasts, its answer is lost (AMBIGUOUS); the SDK checks the ledger once',
    );
    await expect.poll(() => sends(chain).length).toBe(1);
    // The lost answer is said at once (the SDK's wallet-answer event, RESPONSE_LOST).
    await expect(review.locator('[role="status"]')).toContainText(
      'Checking the network for your save…',
    );
    // Freeze the page's clock: the SDK's next ledger check waits on a timer, so it can't start.
    // Its first check (already under way) then finishes on its own answers: leave after that.
    await pauseClock(page);
    await chain.idle();
    await page.goto('about:blank');
    await page.clock.resume();
    chain.step('Leave the page while the transaction is pending; the chain mines it');
    await chain.control?.mine(1);
    await chain.control?.automine(true);
    const before = chain.walletCalls.length;
    await openFile(page, chain);
    chain.step(
      'Load 2: pin, openFile, readBytes; the saves check: pendingSequences, reconcileSequence',
    );
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    // Finality: 64 more blocks on anvil, then the banner's next check.
    await chain.control?.mine(64);
    await page.clock.fastForward(12_000);
    chain.step('After 12 s: reconcileSequence finds the block finalized');
    await expect(save(page, 'saved')).toContainText('Saved');
    await expect(save(page, 'confirming')).toHaveCount(0);
    // From the reload to Saved, the wallet was asked nothing at all (not only no second send).
    expect(chain.walletCalls.slice(before), 'no wallet request after the reload').toEqual([]);
    expect(sends(chain), 'the save was sent exactly once').toHaveLength(1);
    await press(save(page, 'saved').locator('wa-button.efs-save-dismiss'));
    await expect(page.locator('efs-saves-banner')).toHaveCount(0);
  } finally {
    await chain.finish();
  }
});

test('a guest reading a file creates no storage and touches no wallet', async ({ page }) => {
  test.skip(CHAIN_MODE !== 'replay', 'replay only');
  await trapWallet(page);
  await serveConfig(page);
  await serveDeployment(page);
  const replay = await replayRpc(page, ['pin-verified', 'open-inline']);
  const { ids } = transcript('open-inline');
  await page.goto(`./#/r/testnet/${objectLink(ids.file as string)}`);
  await booted(page);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
  // The saves check ran (a verified session) and found nothing, without creating its database.
  await expect(page.locator('efs-saves-banner')).toHaveCount(0);
  const databases = await page.evaluate(async () =>
    'databases' in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [],
  );
  expect(databases).not.toContain('efs-sdk-journal');
  expect(await walletTouches(page)).toEqual([]);
  expect(replay.misses).toEqual([]);
});

for (const [how, pressTwice] of Object.entries(DOUBLE_PRESSES)) {
  test(`Send pressed twice (${how}) before the page catches up: one save, one send`, async ({
    page,
  }) => {
    const chain = await testChain(
      `client-edit-send-once-${how}`,
      `Edit docs/readme.txt as anvil #6, then press Send twice (${how}) before the page re-renders: the second press finds the review gone, or the button disabled. One save.`,
    );
    try {
      await start(page, chain, undefined, true);
      const review = await editAndReview(page, chain, `Twice is once (${how}).\n`, true);
      await pressTwice(review.locator('wa-button.efs-review-send'));
      chain.step(`Send, twice (${how}): one runSequence, one eth_sendTransaction`);
      await expect(save(page, 'confirming').or(save(page, 'saved'))).toHaveCount(1);
      await expect(review).toHaveCount(0);
      await chain.idle(500);
      expect(sends(chain)).toHaveLength(1);
      // The page's own count: the second press started nothing.
      expect(await sendsStarted(page)).toBe(1);
    } finally {
      await chain.finish();
    }
  });
}

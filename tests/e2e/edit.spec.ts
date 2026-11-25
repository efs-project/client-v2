// Writes, end to end: edit a file from the Preview, review it, approve once, and watch the save
// reach "Saved"; lose the wallet's answer and reload mid-flight, and the next load settles it
// from the ledger without the wallet. The real SDK runs in the page throughout.
//
// The chain is replayed from this client's own recordings by default (every PR, every browser);
// EFS_CHAIN=live runs it against a fresh @efs/fixture chain, and EFS_CHAIN=record re-records
// the transcripts (see tests/e2e/chain.ts).

import { link } from '@efs/sdk';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
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

const SEEDED = 'Meeting at 10:00.\n';
const objectLink = (subject: string) => link({ kind: 'object', subject: subject as `0x${string}` });
const sends = (chain: TestChain) => chain.walletCalls.filter((m) => m === 'eth_sendTransaction');

const preview = (page: Page) => page.locator('efs-files-preview');
const save = (page: Page, outcome: string) =>
  page.locator(`efs-saves-banner .efs-save[data-outcome="${outcome}"]`);

async function openFile(page: Page, chain: TestChain): Promise<void> {
  await page.goto(`./#/r/testnet/${objectLink(chain.ids.file as string)}`);
  await booted(page);
}

async function start(page: Page, chain: TestChain): Promise<void> {
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await openFile(page, chain);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
}

/** Edit → connect (one click, one wallet) → Review. Returns the open review dialog. */
async function editAndReview(page: Page, chain: TestChain, text: string): Promise<Locator> {
  await preview(page).locator('wa-button.efs-edit-start').click();
  await page.locator('textarea.efs-edit-text').fill(text);
  chain.step('Edit; type the new text');
  // Typing needed no wallet; saving does. Connecting is one click with one wallet installed.
  await page.locator('wa-button.efs-edit-connect').click();
  const wallet = page.locator('wa-dialog.efs-wallet-dialog');
  await expect(wallet).toContainText(/Your wallet is on .*Testnet/);
  await page.keyboard.press('Escape');
  await expect(wallet).not.toHaveAttribute('open');
  chain.step('Connect (eth_requestAccounts, eth_chainId)');
  const reviewButton = page.locator('wa-button.efs-edit-review-button');
  await expect(reviewButton).not.toHaveAttribute('disabled');
  await reviewButton.click();
  chain.step('Review and save: createWriter, planEditFile in the default Lens');
  const review = page.locator('wa-dialog.efs-edit-review');
  await expect(review).toHaveAttribute('open', '');
  await expect(review).toContainText('Your edit appears to anyone whose lens includes you.');
  await expect(review).toContainText('One approval in your wallet.');
  // The default Lens shows the fixture author's version first: said before Send, not after.
  await expect(review.locator('.efs-review-not-visible')).toContainText(
    /Your edit will be saved, but this view shows .*version first/,
  );
  await expect(review).toContainText("You're editing another author's version.");
  return review;
}

test('edit, review, one approval: Saved · confirming, and Show my version reads it back', async ({
  page,
}) => {
  const text = 'Meeting moved to 11:00.\n';
  const chain = await testChain(
    'client-edit-one-approval',
    'Edit docs/readme.txt as anvil #6 from the Preview: connect, review (not visible in the default Lens), one approval, Saved · confirming; Show my version reads the edit back.',
  );
  try {
    await start(page, chain);
    chain.step('Open docs/readme.txt by object link: pin, openFile, readBytes');
    const review = await editAndReview(page, chain, text);
    await review.locator('wa-button.efs-review-send').click();
    chain.step('Send: runSequence (one part, one eth_sendTransaction)');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    await expect(review).toHaveCount(0);
    expect(sends(chain)).toHaveLength(1);
    // This view still shows the fixture's version; the person can put theirs first.
    await preview(page).locator('wa-button.efs-edit-show-mine').click();
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
    await review.locator('wa-button.efs-review-send').click();
    chain.step(
      'Send: the wallet broadcasts, its answer is lost (AMBIGUOUS); the SDK checks the ledger once',
    );
    await expect.poll(() => sends(chain).length).toBe(1);
    await expect(review).toContainText('Approve in your wallet, then wait for the network');
    // The SDK's first ledger check after the lost answer is done; leave before its next one.
    await chain.quiet(400);
    await page.goto('about:blank');
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
    await save(page, 'saved').locator('wa-button.efs-save-dismiss').click();
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

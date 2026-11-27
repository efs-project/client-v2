// Writes when things go wrong, in one tab (slice D): the cases the client's write path must get
// right without a second approval or a second write. Each asserts what the wallet was asked to
// send and what it broadcast. Replayed on every PR (all browsers), live in CI's live-chain job,
// recorded with `pnpm transcripts:record` (see tests/e2e/chain.ts).

import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import {
  DOUBLE_PRESSES,
  editAndConnect,
  editAndReview,
  editor,
  expect,
  openFile,
  openReview,
  preview,
  reviewDialog,
  SEEDED,
  save,
  sendRequests,
  sendsStarted,
  start,
} from './edit-support.ts';
import { press } from './press.ts';
import { serveConfig, serveDeployment } from './support.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

/** Two parts on the fixture chain (measured: 150 KiB of text plans as 2 parts, 100 KiB as 1). */
const LARGE = `${'x'.repeat(150 * 1024 - 1)}\n`;

test('a lost wallet answer in the same tab is settled from the ledger: one send', async ({
  page,
}) => {
  const chain = await testChain(
    'client-lost-same-tab',
    'Edit as anvil #6; the wallet broadcasts (automine on) but its answer is lost. Without a reload the SDK settles the part from the ledger: Saved · confirming. One eth_sendTransaction.',
  );
  try {
    await start(page, chain);
    const review = await editAndReview(page, chain, 'Lost answer, same tab.\n');
    chain.dropNextSendResponse();
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: broadcast, answer lost (AMBIGUOUS); the SDK checks the ledger: committed');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test('storage lost right after a send: "couldn\'t confirm", saving paused, never sent twice', async ({
  page,
}) => {
  const chain = await testChain(
    'client-journal-lost',
    'Edit as anvil #6; IndexedDB writes fail right after the wallet broadcasts. The page says it could not confirm the save and holds new saves; once storage is back the banner settles it: Saved · confirming. One eth_sendTransaction.',
  );
  try {
    await start(page, chain);
    const review = await editAndReview(page, chain, 'Storage lost after send.\n');
    await chain.breakJournalAfterSend(page);
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: broadcast; the journal write after it fails (thrown, may have sent)');
    await expect(review.locator('.efs-review-unconfirmed')).toContainText(
      "We couldn't confirm this save yet.",
    );
    await press(review.locator('wa-button[slot="footer"]'));
    // No new send while it's unconfirmed: the editor holds, whatever the hold says.
    await expect(editor(page).locator('.efs-edit-blocked')).toBeVisible();
    await expect(page.locator('wa-button.efs-edit-review-button')).toHaveAttribute('disabled', '');
    await chain.restoreJournal(page);
    chain.step('Storage back: the banner settles the save from the ledger');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming', { timeout: 20_000 });
    expect(sendRequests(chain), 'sent exactly once').toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test('my own version changed before Send (E_READSET_STALE: the read-set guard, before the CAS): told first, then one send', async ({
  page,
}) => {
  const chain = await testChain(
    'client-cas-before-send',
    "Edit as anvil #6 and review; meanwhile #6 saves this file elsewhere. Send is refused before the wallet (E_READSET_STALE: the read-set guard, before the CAS); planned again under \"you first\", #6's own newer version is the view's head: the editor says the person's own version changed and offers to save over it: one eth_sendTransaction in all.",
  );
  try {
    await start(page, chain);
    const review = await editAndReview(page, chain, 'Mine, from this tab.\n');
    await chain.editAs?.(6, 'Mine, from another tab.\n');
    chain.step('Elsewhere: #6 saves this file (its own HEAD moves)');
    await press(review.locator('wa-button.efs-review-send'));
    chain.step(
      'Send: refused before the wallet (E_READSET_STALE: the read-set guard, before the CAS); dropped; planned again: own version changed',
    );
    const changed = editor(page).locator('.efs-edit-base-changed');
    await expect(changed).toContainText(
      'Your own version of this file changed since you opened it',
    );
    expect(sendRequests(chain), 'nothing was sent').toHaveLength(0);
    await press(changed.locator('wa-button.efs-edit-save-over'));
    await press(reviewDialog(page).locator('wa-button.efs-review-send'));
    chain.step('Save my edit over the new version, Send');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test("my own version changed before Send, in a sharer's Lens: told first, then saved anyway, one send", async ({
  page,
}) => {
  const chain = await testChain(
    'client-cas-before-send-shared',
    "As above, from a link carrying the sharer's Lens (the fixture author first): planned again, the plan still goes through (the view's head is the author's), so the editor says the person's own version changed and offers to save anyway: one eth_sendTransaction in all.",
  );
  try {
    await start(page, chain, undefined, true);
    const review = await editAndReview(page, chain, 'Mine, from this tab.\n', true);
    await chain.editAs?.(6, 'Mine, from another tab.\n');
    chain.step('Elsewhere: #6 saves this file (its own HEAD moves)');
    await press(review.locator('wa-button.efs-review-send'));
    await expect(editor(page).locator('.efs-edit-own-changed')).toContainText(
      'Your own version of this file changed since you opened it',
    );
    expect(sendRequests(chain), 'nothing was sent').toHaveLength(0);
    await press(editor(page).locator('.efs-edit-own-changed wa-button[variant="brand"]'));
    await press(reviewDialog(page).locator('wa-button.efs-review-send'));
    chain.step('Review and save anyway, Send');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test('a part declined mid-save: "You declined part 2", Continue finishes it, each part sent once', async ({
  page,
}) => {
  const chain = await testChain(
    'client-partial-decline',
    'A 150 KiB edit as anvil #6 plans as two parts. The wallet approves part 1 and declines part 2: Partially saved (1 of 2), You declined part 2. Continue sends part 2: Saved · confirming. Two broadcasts, one per part.',
  );
  try {
    await start(page, chain);
    await editAndConnect(page, chain, LARGE);
    const review = await openReview(page, chain);
    await expect(review).toContainText('2 approvals in your wallet');
    chain.refuseSend(2);
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: part 1 approved and sent; part 2 declined (4001)');
    const declined = save(page, 'declined');
    await expect(declined).toContainText(/You declined part .*2.* in your wallet/);
    await press(declined.locator('wa-button.efs-save-continue'));
    chain.step('Continue: resume sends part 2');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(3);
    if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'each part once').toHaveLength(2);
  } finally {
    await chain.finish();
  }
});

test('"Continue to finish" pressed twice before the banner catches up resumes once', async ({
  page,
}) => {
  const chain = await testChain(
    'client-partial-continue-once',
    'As "a part declined mid-save", but Continue is pressed twice in one task: the banner is busy with the first, so the second does nothing. Part 2 is sent once: three wallet requests and two broadcasts in all.',
  );
  try {
    await start(page, chain);
    await editAndConnect(page, chain, LARGE);
    const review = await openReview(page, chain);
    chain.refuseSend(2);
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: part 1 approved and sent; part 2 declined (4001)');
    const declined = save(page, 'declined');
    await expect(declined).toContainText(/You declined part .*2.* in your wallet/);
    await DOUBLE_PRESSES.twice(declined.locator('wa-button.efs-save-continue'));
    chain.step('Continue, twice in one task: one resume sends part 2');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    await chain.idle(500);
    expect(sendRequests(chain)).toHaveLength(3);
    // One send from the review, one resume from the banner: the second press started nothing.
    expect(await sendsStarted(page)).toBe(2);
    if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'each part once').toHaveLength(2);
  } finally {
    await chain.finish();
  }
});

test('the finishing part loses a race (PARTIAL + E_READSET_STALE): "changed", Review changes brings the edit back', async ({
  page,
}) => {
  const chain = await testChain(
    'client-partial-cas',
    "A two-part edit as anvil #6, reviewed; then #6 saves this file elsewhere before Send. Part 1 (content only) lands; part 2, the HEAD bind, is refused (E_READSET_STALE: the read-set guard, before the CAS): the banner says the file changed while saving. Review changes stops the old save and reopens the editor with the person's text.",
  );
  try {
    await start(page, chain);
    await editAndConnect(page, chain, LARGE);
    const review = await openReview(page, chain);
    await expect(review).toContainText('2 approvals in your wallet');
    // Before Send: a concurrent save by the same account moves its HEAD (and takes the nonce
    // it needed), so the first part (content only) still lands and the bind loses the race.
    await chain.editAs?.(6, 'Mine, from another tab.\n');
    chain.step('Elsewhere: #6 saves this file (its own HEAD moves)');
    await press(review.locator('wa-button.efs-review-send'));
    chain.step(
      'Send: part 1 lands; part 2 (the bind) is refused before the wallet (E_READSET_STALE: the read-set guard, before the CAS)',
    );
    const changed = save(page, 'changed');
    await expect(changed).toContainText('This file changed while your edit was saving');
    await press(changed.locator('wa-button.efs-save-reopen'));
    chain.step('Review changes: abandon the old save, reopen the editor with the draft');
    await expect(editor(page).locator('.efs-edit-reopened')).toBeVisible();
    await expect(page.locator('textarea.efs-edit-text')).toHaveValue(LARGE);
    await expect(save(page, 'changed')).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test("a second tab waits for the first tab's save, and never sends meanwhile", async ({
  context,
}) => {
  const chain = await testChain(
    'client-two-tabs',
    "Two tabs edit as anvil #6. Tab 1 sends and its wallet request stays open. Tab 2 opens: its own journal check lists tab 1's save in flight, so once connected its Review already waits, disabled. Tab 1 completes: Saved · confirming. Tab 2 made no send.",
  );
  try {
    const one = await context.newPage();
    const two = await context.newPage();
    await start(one, chain);
    const review = await editAndReview(one, chain, 'From tab one.\n');
    const held = chain.holdNextSend();
    await press(review.locator('wa-button.efs-review-send'));
    await held.reached;
    chain.step('Tab 1: Send; its wallet request stays open');
    await start(two, chain);
    await editAndConnect(two, chain, 'From tab two.\n');
    // Never pressed: tab 2's journal check, as the tab loaded, already found tab 1's save (the
    // re-list at Review is the next case's).
    await expect(editor(two).locator('.efs-edit-blocked')).toHaveAttribute('data-hold', 'waiting');
    await expect(two.locator('wa-button.efs-edit-review-button')).toHaveJSProperty(
      'disabled',
      true,
    );
    chain.step("Tab 2: its journal check lists tab 1's save in flight; Review waits, disabled");
    await expect(reviewDialog(two)).toHaveCount(0);
    const sendsBefore = sendRequests(chain).length;
    held.release();
    chain.step('Tab 1: the wallet answers; the save lands');
    await expect(save(one, 'confirming')).toContainText('Saved · confirming');
    // Both tabs' last reads (the file again, after the save) answered before the case ends.
    await chain.idle(500);
    expect(sendRequests(chain).length, 'tab 2 sent nothing').toBe(sendsBefore);
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test("a tab open before another tab's send finds it at Review, and never sends meanwhile", async ({
  context,
}) => {
  const chain = await testChain(
    'client-two-tabs-relist',
    "Two tabs edit as anvil #6. Tab 2 opens, edits and connects first: its journal check finds nothing, and Review is enabled. Tab 1 sends and its wallet request stays open. Tab 2's Review re-lists the journal, finds tab 1's save in flight and holds. Tab 1 completes: Saved · confirming. Tab 2 made no send.",
  );
  try {
    const one = await context.newPage();
    const two = await context.newPage();
    await start(two, chain);
    await editAndConnect(two, chain, 'From tab two.\n');
    await expect(editor(two).locator('.efs-edit-blocked')).toHaveCount(0);
    await expect(two.locator('wa-button.efs-edit-review-button')).toHaveJSProperty(
      'disabled',
      false,
    );
    chain.step('Tab 2: edits and connects first; nothing is in flight, Review is enabled');
    await start(one, chain);
    const review = await editAndReview(one, chain, 'From tab one.\n');
    const held = chain.holdNextSend();
    await press(review.locator('wa-button.efs-review-send'));
    await held.reached;
    chain.step('Tab 1: Send; its wallet request stays open');
    // Tab 2 learned nothing meanwhile: only its Review's re-list can find tab 1's save.
    await press(two.locator('wa-button.efs-edit-review-button'));
    chain.step("Tab 2: Review re-lists the journal: tab 1's save is in flight");
    await expect(editor(two).locator('.efs-edit-blocked')).toHaveAttribute('data-hold', 'waiting');
    await expect(two.locator('wa-button.efs-edit-review-button')).toHaveJSProperty(
      'disabled',
      true,
    );
    await expect(reviewDialog(two)).toHaveCount(0);
    const sendsBefore = sendRequests(chain).length;
    held.release();
    chain.step('Tab 1: the wallet answers; the save lands');
    await expect(save(one, 'confirming')).toContainText('Saved · confirming');
    // Both tabs' last reads (the file again, after the save) answered before the case ends.
    await chain.idle(500);
    expect(sendRequests(chain).length, 'tab 2 sent nothing').toBe(sendsBefore);
    expect(sendRequests(chain)).toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test('the wallet switched networks before Send: "switch back", then Send again, one send', async ({
  page,
}) => {
  const chain = await testChain(
    'client-wallet-mismatch',
    'Edit as anvil #6 and review; the wallet then reports another chain. Send is refused before broadcast (WALLET_MISMATCH): "Switch your wallet to … on Testnet". The wallet switches back; Send again continues the same save: Saved · confirming. One broadcast.',
  );
  try {
    await start(page, chain);
    const review = await editAndReview(page, chain, 'Wallet switched away and back.\n');
    chain.walletChainId('0x1');
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: the wallet is on chain 1: NOT_SENT (WALLET_MISMATCH)');
    await expect(review.locator('.efs-review-not-sent')).toContainText(
      /Switch your wallet to .* on .*Testnet.* to continue/,
    );
    chain.walletChainId(undefined);
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('The wallet is back; Send again (resume)');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'broadcast once').toHaveLength(1);
  } finally {
    await chain.finish();
  }
});

test('the file changed under another author: told, then "save over the new version", one send', async ({
  page,
}) => {
  const chain = await testChain(
    'client-base-changed',
    'Open the readme and start editing as anvil #6; meanwhile its author (#0, first in the default Lens) saves a new version. Review finds the base changed; the person saves over the new version: one eth_sendTransaction.',
  );
  try {
    await start(page, chain);
    await editAndConnect(page, chain, 'My edit over theirs.\n');
    await chain.editAs?.(0, 'The author changed it.\n');
    chain.step("Elsewhere: the file's author (#0) saves a new version");
    await press(page.locator('wa-button.efs-edit-review-button'));
    chain.step('Review: BASE_CHANGED (the head in this view moved)');
    const changed = editor(page).locator('.efs-edit-base-changed');
    await expect(changed).toContainText('This file changed since you opened it');
    await press(changed.locator('wa-button.efs-edit-save-over'));
    chain.step('Save my edit over the new version: planned from the new head');
    await press(reviewDialog(page).locator('wa-button.efs-review-send'));
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(1);
    await expect(preview(page)).toBeVisible();
  } finally {
    await chain.finish();
  }
});

/**
 * The editing account at 1 wei, then an edit sent: anvil refuses it for insufficient funds after
 * signing (AMBIGUOUS). The review says so at once, from the SDK's "wallet-answer" event, while the
 * SDK still checks the ledger for its settle time (60 s; the page clock skips it); then the banner
 * offers Send again. Returns the banner row.
 */
async function refusedForFunds(page: Page, chain: TestChain) {
  await page.clock.install();
  await start(page, chain);
  await chain.control?.setBalance(chain.ids.account as string, 1n);
  chain.step('the editing account holds 1 wei');
  await editAndConnect(page, chain, 'Not enough for gas.\n');
  const review = await openReview(page, chain);
  await press(review.locator('wa-button.efs-review-send'));
  chain.step('Send: refused for insufficient funds, after signing (AMBIGUOUS)');
  await expect.poll(() => sendRequests(chain).length).toBe(1);
  const gas = chain.sendGas[0];
  expect(gas, 'the send asked for a gas limit').toBeDefined();
  // The limit the send asked for, as the person reads it (MF2 isolates the number).
  const limit = `\\W*${Number(gas).toLocaleString('en-US')}\\W*`;
  const needs = `Your wallet needs enough to cover the gas limit of ${limit}; a save is charged only the gas it uses\\.`;
  // Before the settle wait ends: the wallet's answer, said at once.
  await expect(review.locator('[role="status"]')).toContainText(
    new RegExp(`${needs} Checking whether it went out`),
  );
  await expect(review).not.toContainText('Approve in your wallet, then wait for the network');
  await chain.idle(300);
  await page.clock.fastForward(61_000);
  chain.step('After 61 s: the settle wait ends; the save is IN_FLIGHT, INSUFFICIENT_FUNDS');
  const funds = save(page, 'funds');
  await expect(funds).toContainText(new RegExp(`${needs} Add funds, then send it again\\.`));
  await expect(funds).not.toContainText(/Saved|costs?\b|fail|minutes/i);
  // In flight: Send again (the same plan), and no Stop (the SDK refuses to stop it).
  await expect(funds.locator('wa-button.efs-save-continue')).toHaveText('Send again');
  await expect(funds.locator('wa-button.efs-save-stop')).toHaveCount(0);
  expect(sendRequests(chain)).toHaveLength(1);
  if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'nothing went out').toHaveLength(0);
  return funds;
}

test('a wallet short of funds: said at once, never as a cost; after a top-up, Send again saves it once with no wait', async ({
  page,
}) => {
  const chain = await testChain(
    'client-insufficient-funds',
    "The editing account holds 1 wei (anvil_setBalance, marked). Send: anvil refuses the signed transaction for insufficient funds. The review says at once that the wallet needs enough to cover the gas limit the send asked for (the SDK's wallet-answer event, sdk-v2 f1c5625), never that the save costs it; after the SDK's 60 s settle wait (the page clock skips it) the banner offers Send again. Funds are added; Send again sends the same plan again: Saved · confirming. Two wallet requests, one broadcast.",
  );
  try {
    const funds = await refusedForFunds(page, chain);
    await chain.control?.setBalance(chain.ids.account as string, 10n ** 19n);
    chain.step('Funds added');
    await press(funds.locator('wa-button.efs-save-continue'));
    chain.step('Send again: the same plan, sent again');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(2);
    if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'one went out, once').toHaveLength(1);
    await chain.idle(500);
  } finally {
    await chain.finish();
  }
});

/** Moves the page's clock (installed) `seconds` ahead without firing any timer, as the chain's moved. */
async function advancePageClock(page: Page, seconds: number): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + seconds * 1000);
}

test('a funds refusal resent too close to its deadline waits for EXPIRED, then Send again plans it anew', async ({
  page,
}) => {
  const chain = await testChain(
    'client-insufficient-funds-late',
    "As \"a wallet short of funds\", but by the time Send again is pressed the chain's clock is within a minute of the plan's deadline (control.advance 850, one block). The SDK doesn't send the same plan again and answers at once, with no settle wait (IN_FLIGHT, ALREADY_ATTEMPTED): the banner says it is too close to its deadline, with nothing to press. The chain passes the deadline and finalizes past it; the banner proves it never went out (EXPIRED), and Send again plans it anew and sends it: Saved · confirming. Two wallet requests, one broadcast.",
  );
  try {
    const funds = await refusedForFunds(page, chain);
    await chain.control?.setBalance(chain.ids.account as string, 10n ** 19n);
    await chain.control?.advance(850);
    await chain.control?.mine(1);
    // This device's clock moves with the chain's (no timers fire): the SDK refuses a basis block
    // more than 900 s ahead of the device's clock (sdk-v2 a03ba84), as a lying endpoint's would be.
    await advancePageClock(page, 850);
    chain.step("Funds added; the chain is within a minute of the plan's deadline");
    await press(funds.locator('wa-button.efs-save-continue'));
    // It sends nothing, so the SDK answers at once, with no settle wait (sdk-v2 9ec7860):
    // IN_FLIGHT, ALREADY_ATTEMPTED.
    chain.step(
      'Send again: too close to the deadline, the same plan is not sent again; answered at once',
    );
    const late = save(page, 'funds-late');
    await expect(late).toContainText(
      'This save is too close to its deadline to send again as it is. Checking that it never went out; then you can send it again.',
    );
    await expect(late.locator('wa-button')).toHaveCount(0);
    // An endpoint that isn't on this computer: no test-chain wait line.
    await expect(late.locator('.efs-save-wait')).toHaveCount(0);
    expect(sendRequests(chain), 'the wallet was not asked again').toHaveLength(1);
    await chain.control?.advance(120);
    await chain.control?.mine(66);
    await advancePageClock(page, 120);
    chain.step('The chain passes the deadline and finalizes past it');
    await page.clock.fastForward(5_000);
    chain.step("After 5 s: the banner's check proves it never went out (EXPIRED)");
    const expired = save(page, 'expired');
    await expect(expired).toContainText("This save didn't go through in time. Nothing was saved.");
    await press(expired.locator('wa-button.efs-save-continue', { hasText: 'Send again' }));
    chain.step('Send again: resume plans the part afresh and sends it');
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(2);
    if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'one went out, once').toHaveLength(1);
    await chain.idle(500);
  } finally {
    await chain.finish();
  }
});

test('a deployment priced for another fee schedule: nothing is planned or sent, and both schedules are named', async ({
  page,
}) => {
  const chain = await testChain(
    'client-fee-schedule',
    "The page is served the fixture's deployment document with its fee schedule changed to amsterdam; the fixture chain prices storage as prague. Review: the SDK's fee-schedule check (sdk-v2 1054c2c) measures the chain and refuses to plan (UNSUPPORTED_PROFILE, feeSchedule { document: amsterdam, chain: prague }). The editor names both and says nothing was sent. No wallet request to send.",
  );
  try {
    const doc = JSON.parse(chain.deployment) as { chain: { feeSchedule: string } };
    expect(doc.chain.feeSchedule, "the fixture's own schedule").toBe('prague');
    doc.chain.feeSchedule = 'amsterdam';
    await chain.attach(page);
    await serveConfig(page);
    await serveDeployment(page, `${JSON.stringify(doc, null, 2)}\n`);
    await openFile(page, chain);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
    chain.step('Open docs/readme.txt, served a document priced for amsterdam');
    await editAndConnect(page, chain, 'Priced for another chain.\n');
    const reviewButton = page.locator('wa-button.efs-edit-review-button');
    await press(reviewButton);
    chain.step('Review: the fee-schedule check refuses to plan');
    await expect(editor(page).locator('[role="alert"]')).toContainText(
      /This app's deployment was set up for the \W*amsterdam\W* fee schedule, but this network uses \W*prague\W*\. Nothing was sent\./,
    );
    // Nothing was planned, so there is no review to open.
    await expect(reviewDialog(page)).toHaveCount(0);
    expect(sendRequests(chain)).toHaveLength(0);
    await chain.idle(500);
  } finally {
    await chain.finish();
  }
});

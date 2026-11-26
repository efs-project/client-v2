// Writes when things go wrong, in one tab (slice D): the cases the client's write path must get
// right without a second approval or a second write. Each asserts what the wallet was asked to
// send and what it broadcast. Replayed on every PR (all browsers), live in CI's live-chain job,
// recorded with `pnpm transcripts:record` (see tests/e2e/chain.ts).

import { test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
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

test('my own version changed before Send (E_CAS): told first, then one send', async ({ page }) => {
  const chain = await testChain(
    'client-cas-before-send',
    "Edit as anvil #6 and review; meanwhile #6 saves this file elsewhere. Send is refused before the wallet (E_CAS); planned again under \"you first\", #6's own newer version is the view's head: the editor says the person's own version changed and offers to save over it: one eth_sendTransaction in all.",
  );
  try {
    await start(page, chain);
    const review = await editAndReview(page, chain, 'Mine, from this tab.\n');
    await chain.editAs?.(6, 'Mine, from another tab.\n');
    chain.step('Elsewhere: #6 saves this file (its own HEAD moves)');
    await press(review.locator('wa-button.efs-review-send'));
    chain.step(
      'Send: refused before the wallet (E_CAS); dropped; planned again: own version changed',
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

test('the finishing part loses a race (PARTIAL + E_CAS): "changed", Review changes brings the edit back', async ({
  page,
}) => {
  const chain = await testChain(
    'client-partial-cas',
    "A two-part edit as anvil #6, reviewed; then #6 saves this file elsewhere before Send. Part 1 (content only) lands; part 2, the HEAD bind, is refused (E_CAS): the banner says the file changed while saving. Review changes stops the old save and reopens the editor with the person's text.",
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
    chain.step('Send: part 1 lands; part 2 (the bind) is refused before the wallet (E_CAS)');
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

test('a wallet short of funds: the gas limit is named, never a cost; funded and proven unsent, Send again saves it once', async ({
  page,
}) => {
  const chain = await testChain(
    'client-insufficient-funds',
    "The editing account holds 1 wei (anvil_setBalance, marked). Send: anvil refuses the signed transaction for insufficient funds. The SDK names it (INSUFFICIENT_FUNDS, sdk-v2 4043ce7: in flight until reconcile proves it never went out) and, after its 60 s settle wait (the page clock skips it), the banner says the wallet needs enough to cover the gas limit the send asked for, never that the save costs it. Nothing went out. Then funds are added and the chain passes the plan's deadline and finalizes past it: the banner proves it never went out (EXPIRED), and Send again sends it once: Saved · confirming. Two wallet requests, one broadcast.",
  );
  try {
    await page.clock.install();
    await start(page, chain);
    await chain.control?.setBalance(chain.ids.account as string, 1n);
    chain.step('the editing account holds 1 wei');
    await editAndConnect(page, chain, 'Not enough for gas.\n');
    const review = await openReview(page, chain);
    await press(review.locator('wa-button.efs-review-send'));
    chain.step('Send: refused for insufficient funds, after signing (AMBIGUOUS)');
    await expect.poll(() => sendRequests(chain).length).toBe(1);
    // The refusal came after signing, so the SDK checks the ledger every second for up to its
    // settle time (60 s) before it answers IN_FLIGHT; until then the review says only this.
    await expect(review).toContainText('Approve in your wallet, then wait for the network');
    await chain.idle(300);
    await page.clock.fastForward(61_000);
    chain.step('After 61 s: the settle wait ends; the save is IN_FLIGHT, INSUFFICIENT_FUNDS');
    const funds = save(page, 'funds');
    await expect(funds).toBeVisible();
    expect(sendRequests(chain)).toHaveLength(1);
    const gas = chain.sendGas[0];
    expect(gas, 'the send asked for a gas limit').toBeDefined();
    // The limit the send asked for, as the person reads it (MF2 isolates the number).
    const limit = Number(gas).toLocaleString('en-US');
    await expect(funds).toContainText(
      new RegExp(
        `Your wallet needs enough to cover the gas limit of \\W*${limit}\\W*; a save is charged only the gas it uses\\.`,
      ),
    );
    await expect(funds).not.toContainText(/Saved|costs?\b|fail/i);
    // In flight until reconcile proves it never went out: nothing to press, and no Stop.
    await expect(funds.locator('wa-button')).toHaveCount(0);
    // An endpoint that isn't on this computer: no test-chain wait line.
    await expect(funds.locator('.efs-save-wait')).toHaveCount(0);
    if (CHAIN_MODE !== 'replay') expect(chain.broadcasts, 'nothing went out').toHaveLength(0);
    // The person adds funds. Reconcile proves it never went out once a finalized block is past the
    // plan's deadline (its block time + 900 s): the chain's clock jumps, then 66 blocks.
    await chain.control?.setBalance(chain.ids.account as string, 10n ** 19n);
    await chain.control?.advance(901);
    await chain.control?.mine(66);
    chain.step('Funds added; the chain passes the deadline and finalizes past it');
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

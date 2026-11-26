// Shared steps for the write tests: open a file, edit, connect, review. The chain and wallet
// come from tests/e2e/chain.ts (replay, live or record).

import { link } from '@efs/sdk';
import { expect as baseExpect, type Locator, type Page } from '@playwright/test';

/**
 * A save runs several SDK steps (re-list, plan, send, settle); under the full three-browser suite
 * one of them can outlast Playwright's default 5 s. That's load, not a failure: wait longer.
 */
export const expect = baseExpect.configure({ timeout: 15_000 });

import type { TestChain } from './chain.ts';
import { press } from './press.ts';
import { booted, serveConfig, serveDeployment } from './support.ts';

export const SEEDED = 'Meeting at 10:00.\n';
export const objectLink = (subject: string) =>
  link({ kind: 'object', subject: subject as `0x${string}` });
/** Every eth_sendTransaction the page asked of the wallet (answered or not). */
export const sendRequests = (chain: TestChain) =>
  chain.walletCalls.filter((m) => m === 'eth_sendTransaction');

/**
 * The ways a person presses a button twice before the page catches up: both presses in one task
 * (before any re-render; WebKit delivered such a pair on CI), a double click, and Enter then a
 * click. Each test that uses them expects one send.
 */
export const DOUBLE_PRESSES = {
  twice: (button: Locator) =>
    button.evaluate((b: HTMLElement) => {
      b.click(); // press-raw: the person's second press, before any re-render
      b.click(); // press-raw: (the same)
    }),
  dblclick: (button: Locator) => button.dblclick(), // press-raw: a double click, second press dropped
  'enter-click': async (button: Locator) => {
    const box = await button.boundingBox();
    if (!box) throw new Error('the button is not on screen');
    await button.focus();
    const page = button.page();
    await page.keyboard.press('Enter');
    // Straight at the point, with no wait for the button to be enabled: a person's second press.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // press-raw: (the same)
  },
} satisfies Record<string, (button: Locator) => Promise<void>>;

/** Sends the page's controls started (an `efs:send` mark each), whatever the wallet said. */
export const sendsStarted = (page: Page) =>
  page.evaluate(() => performance.getEntriesByName('efs:send', 'mark').length);

/**
 * Pauses the page's clock a few milliseconds ahead of its own time. pauseAt can't go backwards,
 * and the page's clock runs on its own, so the target comes from the page, with a larger lead if
 * the page has moved past it meanwhile. The lead stays far below the SDK's 1 s ledger poll, so
 * the jump never fires it.
 */
export async function pauseClock(page: Page): Promise<void> {
  for (let lead = 25; ; lead *= 2) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(now + lead);
      return;
    } catch (error) {
      if (lead >= 400 || !/past/i.test(String(error))) throw error;
    }
  }
}

export const preview = (page: Page) => page.locator('efs-files-preview');
export const save = (page: Page, outcome: string) =>
  page.locator(`efs-saves-banner .efs-save[data-outcome="${outcome}"]`);
export const editor = (page: Page) => page.locator('efs-file-editor');
export const reviewDialog = (page: Page) => page.locator('wa-dialog.efs-edit-review');

/**
 * The seeded file's link. `shared`: the link carries the sharer's Lens (the deployment's default,
 * the fixture author first), so "you first" doesn't apply: the view is the sharer's.
 */
export function fileLink(chain: TestChain, shared = false): string {
  const subject = chain.ids.file as `0x${string}`;
  if (!shared) return objectLink(subject);
  const principals = (JSON.parse(chain.deployment) as { defaultLensPrincipals: string[] })
    .defaultLensPrincipals;
  return link({ kind: 'object', subject, lens: { principals } as never });
}

export async function openFile(page: Page, chain: TestChain, shared = false): Promise<void> {
  await page.goto(`./#/r/testnet/${fileLink(chain, shared)}`);
  await booted(page);
}

export async function start(
  page: Page,
  chain: TestChain,
  expected = SEEDED,
  shared = false,
): Promise<void> {
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await openFile(page, chain, shared);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(expected);
}

/** Edit, type `text`, and connect (one click, one wallet installed). */
export async function editAndConnect(page: Page, chain: TestChain, text: string): Promise<void> {
  await press(preview(page).locator('wa-button.efs-edit-start'));
  await page.locator('textarea.efs-edit-text').fill(text);
  chain.step('Edit; type the new text');
  // Typing needed no wallet; saving does. Connecting is one click with one wallet installed.
  await press(page.locator('wa-button.efs-edit-connect'));
  const wallet = page.locator('wa-dialog.efs-wallet-dialog');
  await expect(wallet).toContainText(/Your wallet is on .*Testnet/);
  await page.keyboard.press('Escape');
  await expect(wallet).not.toHaveAttribute('open');
  chain.step('Connect (eth_requestAccounts, eth_chainId)');
}

/** "Review and save": the review dialog, open. */
export async function openReview(page: Page, chain: TestChain): Promise<Locator> {
  const reviewButton = page.locator('wa-button.efs-edit-review-button');
  await expect(reviewButton).not.toHaveAttribute('disabled');
  await press(reviewButton);
  chain.step('Review and save: journal re-list, createWriter, planEditFile in the default Lens');
  const review = reviewDialog(page);
  await expect(review).toHaveAttribute('open', '');
  return review;
}

/**
 * Edit → connect → Review, for a one-part edit as anvil #6 of the fixture author's file. `shared`:
 * the link carries the sharer's Lens (see fileLink).
 */
export async function editAndReview(
  page: Page,
  chain: TestChain,
  text: string,
  shared = false,
): Promise<Locator> {
  await editAndConnect(page, chain, text);
  const review = await openReview(page, chain);
  await expect(review).toContainText('Your edit appears to anyone whose lens includes you.');
  await expect(review).toContainText('One approval in your wallet.');
  if (shared) {
    // The sharer's Lens shows the fixture author's version first: said before Send, not after.
    await expect(review.locator('.efs-review-not-visible')).toContainText(
      /Your edit will be saved, but this view shows .*version first/,
    );
  } else {
    // "You first" (D10): connected, this view puts the person's own version first.
    await expect(review.locator('.efs-review-not-visible')).toHaveCount(0);
  }
  await expect(review).toContainText("You're editing another author's version.");
  return review;
}

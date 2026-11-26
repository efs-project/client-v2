// The read floor against a live chain whose endpoint falls behind (PM ruling C, 2026-11-26). A
// read is never served from a block older than one this client already read (sdk-v2 7db4417).
// So after a save, an endpoint stuck before the save's block makes the re-read wait, then say
// UNKNOWN BEHIND; it never shows the version from before the save.
//
// Live only (e2e-live-chain): replay serves recorded heads, so the lagging endpoint is a proxy in
// front of anvil (chain.ts `control.lagBefore`), as the SDK's own integration test does with a
// fetch wrapper. It is behind, never lying: every call but the head is served as usual.

import { test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import {
  editAndReview,
  expect,
  openFile,
  preview,
  SEEDED,
  save,
  sendRequests,
  start,
} from './edit-support.ts';
import { press } from './press.ts';
import { serveConfig, serveDeployment, TEST_CONFIG } from './support.ts';

test.skip(
  CHAIN_MODE !== 'live',
  'live only: a lagging endpoint needs a live chain (replay serves recorded heads)',
);

const BEHIND = /hasn't caught up with what you've already seen/;

/** The test network on this computer's RPC: a local test chain, where Start over is offered. */
const LOCAL_CONFIG = {
  ...TEST_CONFIG,
  networks: TEST_CONFIG.networks.map((n) => ({
    ...n,
    rpcs: [{ url: 'http://127.0.0.1:8545/', label: 'Local test chain' }],
  })),
};

/** Saves `text` as anvil #6 from the sharer's view, then the endpoint falls behind the save. */
async function saveThenLag(page: import('@playwright/test').Page, chain: TestChain, text: string) {
  const review = await editAndReview(page, chain, text, true);
  await press(review.locator('wa-button.efs-review-send'));
  await expect(save(page, 'confirming')).toContainText('Saved · confirming');
  expect(sendRequests(chain)).toHaveLength(1);
  await chain.control?.lagBefore(chain.broadcasts.at(-1) as string);
  // This view shows the fixture's version; the person's own is read again, at the floor.
  await press(preview(page).locator('wa-button.efs-edit-show-mine'));
  const outcome = preview(page).locator('efs-outcome');
  // The SDK polls up to 4 s before it says so.
  await expect(outcome).toContainText(BEHIND, { timeout: 15_000 });
  await expect(outcome.locator('.efs-outcome-code')).toHaveText('UNKNOWN');
  await expect(outcome.locator('.efs-outcome-reason')).toHaveText('BEHIND');
  // Never the version from before the save.
  await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
  return outcome;
}

test('after a save, an endpoint behind it is BEHIND, never the version from before the save', async ({
  page,
}) => {
  const text = 'Read at the floor.\n';
  const chain = await testChain('live-read-floor-behind', 'live only');
  try {
    await start(page, chain, undefined, true);
    const outcome = await saveThenLag(page, chain, text);
    // A live chain's endpoint (https://rpc.example.net): no Start over, only Try again.
    await expect(outcome.locator('wa-button.efs-outcome-start-over')).toHaveCount(0);
    // The endpoint catches up: Try again reads the person's own version.
    chain.control?.catchUp();
    await press(outcome.locator('wa-button.efs-outcome-retry'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(text);
    await expect(preview(page).locator('.efs-viewing-mine')).toBeVisible();
  } finally {
    chain.control?.catchUp();
    await chain.finish();
  }
});

test('on a local test chain, BEHIND offers Start over, which forgets the floor and reads again', async ({
  page,
}) => {
  const chain = await testChain('live-read-floor-start-over', 'live only');
  try {
    await chain.attach(page);
    await serveConfig(page, LOCAL_CONFIG);
    await serveDeployment(page, chain.deployment);
    await openFile(page, chain, true);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
    const outcome = await saveThenLag(page, chain, 'Read after a reset.\n');
    const startOver = outcome.locator('wa-button.efs-outcome-start-over');
    await expect(startOver).toHaveText('The test chain was reset? Start over');
    // As on a chain that was reset: with the floor forgotten, the read is served at the endpoint's
    // own head, from before the save, where the person has no version yet.
    await press(startOver);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
    // Its bytes line (VERIFIED) is the only outcome now: no BEHIND.
    await expect(preview(page).locator('efs-outcome', { hasText: BEHIND })).toHaveCount(0);
    await expect(preview(page).locator('efs-outcome .efs-outcome-code')).toHaveText('VERIFIED');
  } finally {
    chain.control?.catchUp();
    await chain.finish();
  }
});

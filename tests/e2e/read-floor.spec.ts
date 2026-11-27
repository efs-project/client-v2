// The read floor against a live chain whose endpoint falls behind (PM ruling C, 2026-11-26). A
// read is never served from a block older than one this client already read (sdk-v2 7db4417).
// So after a save, an endpoint stuck before the save's block makes the re-read wait, then say
// UNKNOWN BEHIND; it never shows the version from before the save.
//
// Live only (e2e-live-chain): replay serves recorded heads, so the lagging endpoint is a proxy in
// front of anvil (chain.ts `control.lagBefore`), as the SDK's own integration test does with a
// fetch wrapper. It is behind, never lying: every call but the head is served as usual.

import { type Page, test } from '@playwright/test';
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
async function saveThenLag(page: Page, chain: TestChain, text: string) {
  const review = await editAndReview(page, chain, text, true);
  await press(review.locator('wa-button.efs-review-send'));
  await expect(save(page, 'confirming')).toContainText('Saved · confirming');
  expect(sendRequests(chain)).toHaveLength(1);
  // "Saved · confirming" refreshes this view once (preview.ts): let that read finish before the
  // endpoint falls behind. A refresh that reads after the lag is itself BEHIND, which has no
  // "Show my version" to press (CI run 45830906590 timed out waiting for it).
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
  await expect(preview(page).locator('wa-button.efs-edit-show-mine')).toBeVisible();
  await chain.idle();
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

/**
 * Holds the first head read after the save's floor is raised (its genesis read, `eth_getBlockByNumber`
 * "0x0", the save's last read before "Saved · confirming"): the Preview's refresh. Answered once
 * `release` settles, through the harness's route, so with the lag on by then. `seen` counts every
 * RPC request the page made, held or not.
 */
async function holdRefreshHead(page: Page, release: Promise<unknown>) {
  const state = { armed: false, held: 0, seen: 0 };
  await page.route(/^(https:\/\/rpc\.example\.net|http:\/\/127\.0\.0\.1:8545)\//, async (route) => {
    state.seen++;
    const body = route.request().postData() ?? '';
    const head = body.includes('eth_getBlockByNumber');
    if (head && body.includes('"0x0"')) state.armed = true;
    else if (head && state.armed && state.held === 0 && body.includes('"latest"')) {
      state.held++;
      await release;
    }
    await route.fallback();
  });
  return state;
}

test('an endpoint that falls behind during the refresh after a save leaves it BEHIND, then it reads itself again once the endpoint catches up', async ({
  page,
}) => {
  // The save's own check comes every 12 s; this case waits for one after the catch-up.
  test.setTimeout(60_000);
  const text = 'Read after the refresh.\n';
  const chain = await testChain('live-read-floor-refresh', 'live only');
  let lagged = () => {};
  const lagOn = new Promise<void>((resolve) => {
    lagged = resolve;
  });
  try {
    await start(page, chain, undefined, true);
    const review = await editAndReview(page, chain, text, true);
    const rpc = await holdRefreshHead(page, lagOn);
    await press(review.locator('wa-button.efs-review-send'));
    await expect(save(page, 'confirming')).toContainText('Saved · confirming');
    expect(sendRequests(chain)).toHaveLength(1);
    // What CI run 45830906590 met by chance: the refresh's head read arrives after the lag.
    await chain.control?.lagBefore(chain.broadcasts.at(-1) as string);
    lagged();
    // Waited for, not read at once: the refresh's head read may reach the route a moment after the
    // lag is on (CI 45950225395: it started 0.5 ms after this line ran). Either way it is answered
    // only once the lag is on (holdRefreshHead), which is what this case needs.
    await expect
      .poll(() => rpc.held, {
        message: "the refresh's head read was held (if 0, the SDK's read order changed)",
      })
      .toBe(1);
    const outcome = preview(page).locator('efs-outcome');
    await expect(outcome).toContainText(BEHIND, { timeout: 15_000 });
    await expect(outcome.locator('.efs-outcome-code')).toHaveText('UNKNOWN');
    await expect(outcome.locator('.efs-outcome-reason')).toHaveText('BEHIND');
    // Never a version read from before the save; and BEHIND has no "Show my version".
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    await expect(preview(page).locator('wa-button.efs-edit-show-mine')).toHaveCount(0);
    // The endpoint catches up. Nothing reads for the Preview's sake, but the page's own next read
    // (the save's check, every 12 s) is served at or above the floor: the SDK's onCaughtUp fires
    // (sdk-v2 a61b2e8), and the Preview reads itself again, once, with nobody pressing anything.
    chain.control?.catchUp();
    // This view's version (the fixture's: its Lens doesn't include the person), then theirs.
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED, {
      timeout: 20_000,
    });
    await expect(preview(page).locator('efs-outcome', { hasText: BEHIND })).toHaveCount(0);
    await chain.idle();
    await expect(save(page, 'confirming').or(save(page, 'saved'))).toBeVisible();
    await press(preview(page).locator('wa-button.efs-edit-show-mine'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(text);
    await expect(preview(page).locator('.efs-viewing-mine')).toBeVisible();
  } finally {
    lagged();
    chain.control?.catchUp();
    await chain.finish();
  }
});

test("the Preview's Versions and Tags sections, BEHIND after a save, read themselves again once the endpoint catches up", async ({
  page,
}) => {
  // The save's own check comes every 12 s; this case waits for one after the catch-up.
  test.setTimeout(60_000);
  const chain = await testChain('live-read-floor-sections', 'live only');
  const versions = preview(page).locator('efs-files-file-versions');
  const tags = preview(page).locator('efs-files-file-tags');
  try {
    await start(page, chain, undefined, true);
    await saveThenLag(page, chain, 'Read by the sections.\n');
    // Opened while the endpoint is behind the save: each section says so (BEHIND's own words).
    await press(versions.locator('summary'));
    await expect(versions.locator('efs-outcome')).toContainText(BEHIND, { timeout: 15_000 });
    await press(tags.locator('summary'));
    await expect(tags.locator('efs-outcome')).toContainText(BEHIND, { timeout: 15_000 });
    // The endpoint catches up. Nobody presses anything: the page's next read (the save's check)
    // is served at or above the floor, the SDK's onCaughtUp fires, and each section reads itself
    // again, once (PM, 2026-11-27), beside the Preview, which does the same.
    chain.control?.catchUp();
    await expect(versions.locator('.efs-versions-decision')).toBeVisible({ timeout: 20_000 });
    await expect(versions.locator('efs-outcome', { hasText: BEHIND })).toHaveCount(0);
    await expect(tags.locator('efs-outcome', { hasText: BEHIND })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(preview(page).locator('.efs-preview-text')).toBeVisible({ timeout: 20_000 });
    await chain.idle();
  } finally {
    chain.control?.catchUp();
    await chain.finish();
  }
});

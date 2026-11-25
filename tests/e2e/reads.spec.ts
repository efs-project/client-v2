import { readFileSync } from 'node:fs';
import { link } from '@efs/sdk';
import { expect, type Page, test } from '@playwright/test';
import {
  booted,
  DEPLOYMENT,
  openSettings,
  recordRequests,
  replayRpc,
  rpcDown,
  serveConfig,
  serveDeployment,
  TEST_CONFIG,
  transcript,
} from './support.ts';

const EVIDENCE = process.env.EFS_EVIDENCE ?? 'apps/web/dist-evidence';

/**
 * Chunks holding the SDK's core (its client, chain and byte I/O, and their viem/ox/noble
 * internals), from the build's module provenance. The SDK's link grammar is pure string code and
 * may load with the File Browser; the core must not.
 */
function sdkCoreChunks(): string[] {
  const provenance = JSON.parse(readFileSync(`${EVIDENCE}/provenance.json`, 'utf8')) as {
    chunks: { fileName: string; modules: string[] }[];
  };
  const core = (id: string) =>
    /[/+]@?(viem|ox|abitype|@noble[+/][a-z]+)[@/]/.test(id) ||
    /@efs[/+]sdk.*\/dist\/(client|chain\/|files\/)/.test(id);
  return provenance.chunks.filter((c) => c.modules.some(core)).map((c) => c.fileName);
}

const indicator = (page: Page) => page.locator('efs-network-indicator');
const networkStatus = (page: Page) => page.locator('[data-section="network"] .efs-network-status');

test('the SDK core is lazy: a site with no networks never downloads it', async ({ page }) => {
  const chunks = sdkCoreChunks();
  expect(chunks.length).toBeGreaterThan(0);
  const requests = recordRequests(page);
  await page.goto('./#/files');
  await booted(page);
  await page.waitForTimeout(300);
  const fetched = requests.map((u) => u.pathname.slice(1));
  expect(fetched.filter((p) => chunks.includes(p))).toEqual([]);
});

test('a missing deployment document is a visible setup problem, not an empty folder', async ({
  page,
}) => {
  await serveConfig(page); // names deployments/testnet.json, which the static server doesn't have
  await page.goto('./#/files');
  await booted(page);
  await expect(indicator(page)).toContainText('setup problem');
  await expect(page.getByRole('main').getByText("This site's setup for").first()).toBeVisible();
  await openSettings(page);
  await expect(networkStatus(page)).toContainText(
    "deployment file for this network couldn't be loaded",
  );
});

test('a deployment document the SDK rejects is reported as invalid', async ({ page }) => {
  await serveConfig(page);
  await serveDeployment(page, JSON.stringify({ schema: 'efs-deployment/1', chainId: 31337 }));
  await page.goto('./#/files');
  await booted(page);
  await openSettings(page);
  await expect(networkStatus(page)).toContainText("deployment file for this network isn't valid");
});

test('a deployment for another chain is refused, with both chain ids shown plainly', async ({
  page,
}) => {
  const config = structuredClone(TEST_CONFIG);
  config.networks[0] = { ...config.networks[0], chainId: 11155111 } as (typeof config.networks)[0];
  await serveConfig(page, config);
  await serveDeployment(page);
  const rpc = await rpcDown(page);
  await page.goto('./#/files');
  await booted(page);
  await openSettings(page);
  // MF2 isolates arguments (U+2068/U+2069), hence the patterns.
  await expect(networkStatus(page)).toContainText(/for chain\W*31337/);
  await expect(networkStatus(page)).toContainText(/as chain\W*11155111/);
  await expect(networkStatus(page)).not.toContainText('11,155,111');
  // Nothing was asked of an RPC for a deployment that can't be this network's.
  expect(rpc).toEqual([]);
});

test('an unreachable network is "unreachable", reads wait, and Try again asks again', async ({
  page,
}) => {
  await serveConfig(page);
  await serveDeployment(page);
  const rpc = await rpcDown(page);
  await page.goto('./#/files');
  await booted(page);
  await expect(indicator(page)).toContainText('unreachable');
  const main = page.getByRole('main');
  await expect(main.getByText("Couldn't reach").first()).toBeVisible();
  const before = rpc.length;
  expect(before).toBeGreaterThan(0);
  await main.getByRole('button', { name: 'Try again' }).first().click();
  await expect.poll(() => rpc.length).toBeGreaterThan(before);
  await expect(indicator(page)).toContainText('unreachable');
});

// ---- The real SDK against recorded chain traffic (no chain) ----

const objectLink = (subject: string) => link({ kind: 'object', subject: subject as `0x${string}` });
const preview = (page: Page) => page.locator('efs-files-preview');

test.describe('verified reads (recorded chain traffic)', () => {
  test('the pin verifies; the header names the endpoint that answered', async ({ page }) => {
    await serveConfig(page);
    await serveDeployment(page);
    const replay = await replayRpc(page, ['pin-verified']);
    // An app route, not the realm's root: the root lists its folder, which this recorded traffic
    // doesn't cover (folders.spec.ts records the root, its redirect and its listing).
    await page.goto('./#/files');
    await booted(page);
    await expect(indicator(page)).toContainText('Example RPC');
    await expect(page.locator('efs-network-indicator wa-button')).toHaveAttribute(
      'data-status',
      'PINNED',
    );
    await openSettings(page);
    await expect(networkStatus(page)).toContainText('Connected to the expected EFS deployment');
    await expect(networkStatus(page)).toContainText('31337');
    expect(replay.misses).toEqual([]);
  });

  test('an object link opens the file and shows its verified text', async ({ page }) => {
    await serveConfig(page);
    await serveDeployment(page);
    const replay = await replayRpc(page, ['pin-verified', 'open-inline']);
    const file = transcript('open-inline').ids.file as string;
    await page.goto(`./#/r/testnet/${objectLink(file)}`);
    await booted(page);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Meeting at 10:00.\n');
    await expect(preview(page)).toContainText(
      'Contents verified against the published fingerprint',
    );
    await expect(preview(page)).toContainText('18 bytes');
    const downloading = page.waitForEvent('download');
    await preview(page).getByRole('button', { name: 'Save a copy' }).click();
    expect((await downloading).suggestedFilename()).toMatch(/^efs-[0-9a-f]{12}\.txt$/);
    expect(replay.misses).toEqual([]);
  });

  test('"proven absent" and "couldn\'t tell" look different, and only the second offers a retry', async ({
    page,
  }) => {
    await serveConfig(page);
    await serveDeployment(page);
    const replay = await replayRpc(page, ['pin-verified', 'open-absent']);
    const absent = transcript('open-absent').ids.file as string;
    await page.goto(`./#/r/testnet/${objectLink(absent)}`);
    await booted(page);
    const outcome = preview(page).locator('efs-outcome');
    await expect(outcome).toContainText('Confirmed not present.');
    await expect(outcome).toContainText('ABSENT_PROVEN');
    await expect(outcome.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(replay.misses).toEqual([]);
  });

  test('a large binary file is verified across chunks and offered for saving, not shown', async ({
    page,
  }) => {
    await serveConfig(page);
    await serveDeployment(page);
    const replay = await replayRpc(page, ['pin-verified', 'open-span']);
    const file = transcript('open-span').ids.file as string;
    await page.goto(`./#/r/testnet/${objectLink(file)}`);
    await booted(page);
    await expect(preview(page)).toContainText(
      'Contents verified against the published fingerprint',
    );
    await expect(preview(page)).toContainText("can't preview this kind of file");
    await expect(preview(page)).toContainText('20,000 bytes');
    await expect(preview(page).getByRole('button', { name: 'Save a copy' })).toBeVisible();
    expect(replay.misses).toEqual([]);
  });

  test('a publisher-hosted file is fetched only after "Load from", once, from that origin', async ({
    page,
  }) => {
    await serveConfig(page);
    await serveDeployment(page);
    const replay = await replayRpc(page, ['pin-verified', 'open-external-https']);
    const { ids } = transcript('open-external-https');
    const hits: string[] = [];
    await page.route(/^https:\/\/files\.example\//, (route) => {
      hits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'text/plain',
        // A real publisher host must allow cross-origin reads too.
        headers: { 'access-control-allow-origin': '*' },
        body: ids.httpsText as string,
      });
    });
    await page.goto(`./#/r/testnet/${objectLink(ids.file as string)}`);
    await booted(page);
    // MF2 isolates the host (U+2068/U+2069), hence the pattern.
    await expect(preview(page)).toContainText(/stored at\W*files\.example/);
    await expect(preview(page)).toContainText('see your IP address');
    expect(hits).toEqual([]);
    await preview(page)
      .getByRole('button', { name: /Load from\W+files\.example/ })
      .click();
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(ids.httpsText as string);
    await expect(preview(page)).toContainText(
      'Contents verified against the published fingerprint',
    );
    expect(hits).toEqual([ids.httpsUrl]);

    // Opening it again in this tab uses the bytes already loaded (the SDK's in-memory cache):
    // shown and verified, with nobody contacted.
    const link = new URL(page.url()).hash;
    await page.evaluate(() => {
      location.hash = '#/files';
    });
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    await page.evaluate((h) => {
      location.hash = h;
    }, link);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(ids.httpsText as string);
    expect(hits).toEqual([ids.httpsUrl]);

    // The permission itself is never remembered: after a reload the button is back, nothing fetched.
    await page.reload();
    await booted(page);
    await expect(
      preview(page).getByRole('button', { name: /Load from\W+files\.example/ }),
    ).toBeVisible();
    expect(hits).toEqual([ids.httpsUrl]);
    expect(replay.misses).toEqual([]);
  });

  test('the full realm form resolves to the configured network; links are canonicalized', async ({
    page,
  }) => {
    await serveConfig(page);
    await serveDeployment(page);
    await replayRpc(page, ['pin-verified', 'open-inline']);
    const file = transcript('open-inline').ids.file as string;
    const ledger = TEST_CONFIG.networks[0]?.core as string;
    const shouty = objectLink(file).replace(file.slice(2), file.slice(2).toUpperCase());
    await page.goto(`./#/r/eip155:31337/${ledger}/${shouty}`);
    await booted(page);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Meeting at 10:00.\n');
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe(`#/r/eip155:31337/${ledger}/${objectLink(file)}`);
  });

  test('a link to a network this site does not set up says so, with the realm named', async ({
    page,
  }) => {
    await serveConfig(page);
    const file = transcript('open-inline').ids.file as string;
    await page.goto(`./#/r/mainnet/${objectLink(file)}`);
    await booted(page);
    await expect(indicator(page)).toContainText('Network not set up here');
    const main = page.getByRole('main');
    await expect(
      main.getByText("This link is for a network this site doesn't set up").first(),
    ).toBeVisible();
    await expect(main.locator('code', { hasText: 'mainnet' }).first()).toBeVisible();
  });

  test('a forged deployment document fails the pin, and nothing is read', async ({ page }) => {
    const forged = JSON.parse(DEPLOYMENT) as Record<string, unknown>;
    forged.layoutId = `0x${'11'.repeat(32)}`;
    await serveConfig(page);
    await serveDeployment(page, JSON.stringify(forged));
    await replayRpc(page, ['pin-verified', 'open-inline']);
    const file = transcript('open-inline').ids.file as string;
    await page.goto(`./#/r/testnet/${objectLink(file)}`);
    await booted(page);
    await expect(indicator(page)).toContainText('unexpected deployment');
    await expect(preview(page)).toContainText("doesn't have the expected EFS deployment");
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    await openSettings(page);
    await expect(networkStatus(page)).toContainText('layoutId');
  });
});

test('an over-long link is refused visibly, never truncated', async ({ page }) => {
  await page.goto(`./#/r/testnet/${'a'.repeat(9000)}`);
  await page.locator('html[data-efs-booted]').waitFor({ state: 'attached' });
  await expect(page.getByRole('main')).toContainText('This link is too long to open');
});

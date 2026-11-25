// Performance budgets, measured in Chromium with the CPU slowed 4× (a mid-range phone, roughly)
// against replayed chain answers, so only the client's own work is timed. Each run attaches its
// numbers (budgets.json) to the report, so CI keeps the trend.

import { link } from '@efs/sdk';
import { expect, test } from '@playwright/test';
import { booted, replayRpc, serveConfig, serveDeployment, transcript } from './support.ts';

/**
 * Milliseconds from navigation start, with the CPU slowed 4×: 2.5× CI's median, rounded up to the
 * next 100 ms (samples in docs/design/shell.md, "Time budgets"). Re-measure, don't bump.
 */
const BUDGET_MS = { booted: 900, previewVerified: 4300 };

test('startup and Preview stay within their budgets @chromium-only', async ({ page }, info) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await serveConfig(page);
  await serveDeployment(page);
  await replayRpc(page, ['pin-verified', 'open-inline']);
  const { ids } = transcript('open-inline');
  await page.goto(`./#/r/testnet/${link({ kind: 'object', subject: ids.file as `0x${string}` })}`);
  await booted(page);
  await expect(page.locator('efs-files-preview .efs-preview-text')).toHaveText(
    'Meeting at 10:00.\n',
  );
  const measured = await page.evaluate(() => ({
    booted: performance.getEntriesByName('efs:booted')[0]?.startTime ?? Number.NaN,
    previewVerified:
      performance.getEntriesByName('efs:preview-verified')[0]?.startTime ?? Number.NaN,
  }));
  await info.attach('budgets.json', {
    body: JSON.stringify({ cpuSlowdown: 4, measured, budget: BUDGET_MS }, null, 2),
    contentType: 'application/json',
  });
  console.log(`budgets: ${JSON.stringify(measured)}`);
  expect(measured.booted).toBeLessThan(BUDGET_MS.booted || Number.POSITIVE_INFINITY);
  expect(measured.previewVerified).toBeLessThan(
    BUDGET_MS.previewVerified || Number.POSITIVE_INFINITY,
  );
});

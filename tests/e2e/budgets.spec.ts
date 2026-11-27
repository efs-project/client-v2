// Performance budgets, measured in Chromium with the CPU slowed 4× (a mid-range phone, roughly)
// against replayed chain answers, so only the client's own work is timed. Each run attaches its
// numbers (budgets.json) to the report, so CI keeps the trend.

import { link } from '@efs/sdk';
import { expect, test } from '@playwright/test';
import { testChain } from './chain.ts';
import { booted, replayRpc, serveConfig, serveDeployment, transcript } from './support.ts';

/**
 * Milliseconds from navigation start, with the CPU slowed 4×: about 2.5× CI's median, rounded up
 * to the next 100 ms (PM, 2026-11-27; samples in docs/design/shell.md, "Time budgets"). Strict 2×
 * would fail healthy runs (a tag view once booted in 755 ms): a flaky gate gets ignored. When one
 * fails, its message names the measured value, the budget and CI's median. If one trips twice on
 * healthy commits, re-measure and tell the PM: never just rerun, never just bump.
 */
const BUDGET_MS = { booted: 800, previewVerified: 3800 };
/** The same budgets for the tag, word and address views: their first list in place of the file. */
const VIEW_BUDGET_MS = { booted: BUDGET_MS.booted, listed: BUDGET_MS.previewVerified };
/** CI's medians (ms) over 8 green main runs, 2026-11-26 to 2026-11-27, for the failure messages. */
const CI_MEDIAN_MS: Readonly<Record<string, number>> = {
  booted: 304,
  previewVerified: 1496,
  'tag booted': 323,
  'tag listed': 1580,
  'word booted': 214,
  'word listed': 969,
  'address booted': 215,
  'address listed': 1361,
};

/** "booted: 850 ms against a budget of 800 ms (CI median 304 ms)". */
const said = (what: string, measured: number | undefined, budget: number) =>
  `${what}: ${Math.round(measured ?? Number.NaN)} ms against a budget of ${budget} ms (CI median ${
    CI_MEDIAN_MS[what] ?? '?'
  } ms)`;

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
  expect(measured.booted, said('booted', measured.booted, BUDGET_MS.booted)).toBeLessThan(
    BUDGET_MS.booted,
  );
  expect(
    measured.previewVerified,
    said('previewVerified', measured.previewVerified, BUDGET_MS.previewVerified),
  ).toBeLessThan(BUDGET_MS.previewVerified);
});

/**
 * The tag, word and address views, each loaded fresh as a guest with the CPU slowed 4×: the shell
 * within the same 800 ms, and each view's first list (its rows, or an honest empty or unknown:
 * efs:topic-listed, efs:word-listed, efs:listing-listed) within the Preview's 3.8 s. Recorded
 * chain answers (its own transcript), so only the client's work is timed.
 */
test('a tag, a word page and an address view stay within their budgets @chromium-only', async ({
  page,
}, info) => {
  const chain = await testChain(
    'client-budget-views',
    'c.txt tagged /photos/sunsets and /sunsets by anvil #0; note.txt at anvil #0’s address.',
  );
  try {
    await chain.actAs?.(0, async ({ files, root, lens, writer, efs, account, save }) => {
      const tags = await import('@efs/sdk/tags');
      const made = (await save(
        await files.planCreateFile(efs, writer, {
          folder: root,
          name: 'c.txt',
          content: new TextEncoder().encode('c\n'),
          lens,
        }),
      )) as { file: { subject: `0x${string}` } };
      const target = { kind: 'file', subject: made.file.subject } as const;
      for (const topic of [['photos', 'sunsets'], ['sunsets']]) {
        await save(await tags.planTag(efs, writer, { topic, targets: [target] }));
      }
      await save(
        await files.planCreateFile(efs, writer, {
          folder: { kind: 'home', address: account as `0x${string}` },
          name: 'note.txt',
          content: new TextEncoder().encode('note\n'),
          lens,
        }),
      );
      return { account0: account };
    });
    const zero = chain.ids.account0 as string;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await chain.attach(page);
    await serveConfig(page);
    await serveDeployment(page, chain.deployment);
    const views = [
      { view: 'tag', route: '#/r/testnet/photos/sunsets', mark: 'efs:topic-listed' },
      { view: 'word', route: '#/r/testnet/sunsets', mark: 'efs:word-listed' },
      { view: 'address', route: `#/r/testnet/${zero}`, mark: 'efs:listing-listed' },
    ];
    const measured: Record<string, { booted: number; listed: number }> = {};
    for (const { view, route, mark } of views) {
      // A query string of its own: a full page load, so every mark starts again.
      await page.goto(`./?view=${view}${route}`);
      await booted(page);
      await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, mark);
      measured[view] = await page.evaluate(
        (m) => ({
          booted: performance.getEntriesByName('efs:booted')[0]?.startTime ?? Number.NaN,
          listed: performance.getEntriesByName(m)[0]?.startTime ?? Number.NaN,
        }),
        mark,
      );
      // Let this view's reads finish before the next load, so a replay meets the same calls.
      await expect(page.locator('[data-reading]')).toHaveCount(0);
      await chain.idle(500);
      chain.step(`The ${view} view, loaded fresh`);
    }
    await info.attach('budgets-views.json', {
      body: JSON.stringify({ cpuSlowdown: 4, measured, budget: VIEW_BUDGET_MS }, null, 2),
      contentType: 'application/json',
    });
    console.log(`budgets (views): ${JSON.stringify(measured)}`);
    for (const { view } of views) {
      const m = measured[view];
      expect(m?.booted, said(`${view} booted`, m?.booted, VIEW_BUDGET_MS.booted)).toBeLessThan(
        VIEW_BUDGET_MS.booted,
      );
      expect(m?.listed, said(`${view} listed`, m?.listed, VIEW_BUDGET_MS.listed)).toBeLessThan(
        VIEW_BUDGET_MS.listed,
      );
    }
  } finally {
    await chain.finish();
  }
});

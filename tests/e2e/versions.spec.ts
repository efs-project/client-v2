// "Versions" in the Preview: everyone's versions of a file (the SDK's fileVersions, from the
// contracts' head-authors list) in the Lens the file was opened under.
//
// The seeded readme.txt (by the fixture author, its creator) gets versions of their own from anvil
// #2, then #3. The decision comes first; the Lens tier, then the creator's row when the creator is
// outside the Lens, then everyone else, labelled public, newest first by first version. A public
// row's Open shows that version behind the media gate; the creator's Show doesn't (the file view's
// own fallback opens the creator's version without it). "Versions · N" is `live`.
//
// Paging: a local test chain's config may set `devVersionsPage` (tests only; never shown), the
// entries one read scans, so a short list pages like a long one: the paging case reads one entry
// per call. A Lens author's lone no ("not this", never a version) comes from the SDK's tests-only
// planHeadNo (sdk-v2 bdcbe6e).

import { AxeBuilder } from '@axe-core/playwright';
import { link } from '@efs/sdk/links';
import { type Page, test } from '@playwright/test';
import { type TestChain, testChain } from './chain.ts';
import { expect, preview, SEEDED, start } from './edit-support.ts';
import { press } from './press.ts';
import { booted, serveConfig, serveDeployment, TEST_CONFIG } from './support.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const versions = (page: Page) => preview(page).locator('efs-files-file-versions');
const tier = (page: Page, name: 'lens' | 'creator' | 'public') =>
  versions(page).locator(`[data-section="${name}"]`);
const versionRow = (page: Page, author: string) =>
  versions(page).locator(`li.efs-version[data-author="${author.toLowerCase()}"]`);

/** No Versions read is in flight, so each step starts from the same reads in every browser. */
const settled = (page: Page) =>
  expect(page.locator('efs-files-file-versions[data-reading]')).toHaveCount(0);

const go = (page: Page, hash: string) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

/** Opens (or closes) the section: a plain <summary>, so a click is the person's own. */
const toggle = (page: Page) => press(versions(page).locator('summary'));

/** Whether `locator` holds focus (a wa-button's own button is inside its shadow root). */
const focused = (locator: import('@playwright/test').Locator) =>
  locator.evaluate((el) => el === document.activeElement || el.matches(':focus-within'));

/** TEST_CONFIG on a local test chain, reading one head-authors list entry per Versions call. */
const PAGED_CONFIG = {
  ...TEST_CONFIG,
  networks: [
    {
      ...TEST_CONFIG.networks[0],
      rpcs: [{ url: 'http://127.0.0.1:8545/', label: 'Local test chain' }],
      devVersionsPage: 1,
    },
  ],
};

/** The principal of anvil account `index`, from the SDK (kept in the transcript's ids). */
async function principalOf(chain: TestChain, index: number): Promise<string> {
  await chain.actAs?.(index, async ({ efs, account }) => ({
    [`p${index}`]: efs.lens.principalOf(account as never),
  }));
  return chain.ids[`p${index}`] as string;
}

test("Versions: the view's decision first, the Lens tier, then everyone else (public, behind the gate); Show the original view", async ({
  page,
}) => {
  const chain = await testChain(
    'client-versions',
    'readme.txt (the fixture seed, by its author) gets a version of their own from anvil #2, then #3, from Node. A guest opens it in the default Lens (its author): Versions reads nothing until opened, then says this view shows the author version, with the author in the Lens tier (Showing here, marked creator) and #3 then #2 as public rows (Versions · 3). Open on #3: that version first, behind the media gate, until Show preview. Show the original view: the seeded text again.',
  );
  try {
    await chain.editAs?.(2, 'Version by #2.\n');
    await chain.editAs?.(3, 'Version by #3.\n');
    const p2 = await principalOf(chain, 2);
    const p3 = await principalOf(chain, 3);
    await start(page, chain);
    await expect(versions(page).locator('summary')).toHaveText('Versions');
    // Closed: nothing read for it.
    await expect(versions(page).locator('li.efs-version')).toHaveCount(0);
    chain.step('Open readme.txt as a guest: Versions is closed and has read nothing');

    await toggle(page);
    await expect(versions(page).locator('.efs-versions-decision')).toHaveText(
      /^\s*This view shows .+'s version\.\s*$/,
    );
    await settled(page);
    // Opening the section doesn't move focus.
    expect(
      await versions(page)
        .locator('summary')
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await expect(versions(page).locator('summary')).toHaveText(/^\s*Versions · 3\s*$/);
    const lensRows = tier(page, 'lens').locator('li.efs-version');
    await expect(lensRows).toHaveCount(1);
    await expect(lensRows.first()).toHaveAttribute('data-shown', '');
    await expect(lensRows.first()).toContainText('creator');
    await expect(lensRows.first()).toContainText('Showing here');
    // The creator is in this Lens: no creator tier of its own.
    await expect(tier(page, 'creator')).toHaveCount(0);
    await expect(tier(page, 'public').locator('.efs-topic-heading')).toHaveText(
      'Others (public) · newest first, by when each person first saved one here',
    );
    // Newest first, by first version: #3 saved after #2.
    const pub = tier(page, 'public').locator('li.efs-version');
    await expect(pub).toHaveCount(2);
    await expect(pub.nth(0)).toHaveAttribute('data-author', p3.toLowerCase());
    await expect(pub.nth(1)).toHaveAttribute('data-author', p2.toLowerCase());
    await expect(pub.nth(0)).toContainText('public');
    // Its name says whose version it opens, and that it's public; it reads "Open".
    await expect(pub.nth(0).locator('wa-button.efs-version-open [aria-hidden="true"]')).toHaveText(
      'Open',
    );
    await expect(pub.nth(0).getByRole('button')).toHaveAccessibleName(
      /^Open .+'s version \(public\)$/,
    );
    // The end of the list: no Load more.
    await expect(versions(page).locator('wa-button.efs-versions-more')).toHaveCount(0);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-file-versions')
      .withTags(AXE_TAGS)
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step(
      'Open Versions: the decision (the author version), the author in the Lens tier, #3 then #2 public; Versions · 3',
    );

    await press(versionRow(page, p3).locator('wa-button.efs-version-open'));
    await expect(preview(page).locator('.efs-viewing-author')).toContainText(
      /Showing .+'s version first\./,
    );
    // Public: nothing fetched until asked.
    await expect(preview(page).locator('.efs-preview-gated')).toBeVisible();
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    await expect(versionRow(page, p3)).toHaveAttribute('data-shown', '');
    // The button gave way to "Showing here": focus stays on the row.
    expect(await versionRow(page, p3).evaluate((el) => el === document.activeElement)).toBe(true);
    await press(preview(page).locator('wa-button.efs-preview-show'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Version by #3.\n');
    await settled(page);
    chain.step(
      "Open on #3's public row: its version first, behind the gate; Show preview shows it",
    );

    await press(preview(page).locator('wa-button.efs-show-original'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
    await expect(lensRows.first()).toHaveAttribute('data-shown', '');
    await expect(versionRow(page, p3)).not.toHaveAttribute('data-shown', '');
    await settled(page);
    await chain.idle(500);
    chain.step('Show the original view: the seeded text, the author Showing here again');
  } finally {
    await chain.finish();
  }
});

test("Versions in a Lens without the creator: the creator's row comes after the Lens tier, and its Show needs no gate", async ({
  page,
}) => {
  const chain = await testChain(
    'client-versions-creator',
    "readme.txt gets a version of their own from anvil #2, then #3, from Node. A guest opens it by a link carrying the Lens [#2]: the file shows #2's version; Versions says so, lists #2 in the Lens tier (Showing here), the fixture author in a Creator tier of its own, and #3 public. Show on the creator's row: the seeded text first, with no gate.",
  );
  try {
    await chain.editAs?.(2, 'Version by #2.\n');
    await chain.editAs?.(3, 'Version by #3.\n');
    const p2 = await principalOf(chain, 2);
    const p3 = await principalOf(chain, 3);
    await start(page, chain);
    const shared = link({
      kind: 'object',
      subject: chain.ids.file as never,
      lens: { principals: [p2] } as never,
    });
    await go(page, `#/r/testnet/${shared}`);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Version by #2.\n');
    chain.step("The link with the Lens [#2]: #2's version");

    await toggle(page);
    await expect(versions(page).locator('.efs-versions-decision')).toHaveText(
      /This view shows .+'s version\./,
    );
    await settled(page);
    await expect(versions(page).locator('summary')).toHaveText(/^\s*Versions · 3\s*$/);
    await expect(tier(page, 'lens').locator('li.efs-version')).toHaveCount(1);
    await expect(versionRow(page, p2)).toHaveAttribute('data-shown', '');
    const creator = tier(page, 'creator').locator('li.efs-version');
    await expect(creator).toHaveCount(1);
    await expect(creator).toContainText('creator');
    await expect(tier(page, 'creator').locator('.efs-topic-heading')).toHaveText('Creator');
    // Lens, then creator, then public, in that order on the page.
    const order = await versions(page)
      .locator('[data-section]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
    expect(order).toEqual(['lens', 'creator', 'public']);
    const pub = tier(page, 'public').locator('li.efs-version');
    await expect(pub).toHaveCount(1);
    await expect(pub.first()).toHaveAttribute('data-author', p3.toLowerCase());
    chain.step('Versions: #2 in the Lens tier, the creator apart, #3 public');

    await expect(creator.getByRole('button')).toHaveAccessibleName(/^Show .+'s version$/);
    await press(creator.locator('wa-button.efs-version-show'));
    // The creator's version needs no gate: its text, at once.
    await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
    await expect(preview(page).locator('.efs-preview-gated')).toHaveCount(0);
    await expect(creator).toHaveAttribute('data-shown', '');
    await settled(page);
    await chain.idle(500);
    chain.step("Show on the creator's row: the seeded text, no gate");
  } finally {
    await chain.finish();
  }
});

test('Versions one entry per read: the 3-read budget, Load more keeping focus, then a row; a list that moves offers Refresh', async ({
  page,
}) => {
  const chain = await testChain(
    'client-versions-paging',
    "readme.txt (by the fixture author, #0) gets versions of their own from #2, then #3, #4, #5, #7, #8, #9, from Node. The page is served a local test chain config with devVersionsPage 1 (one list entry per read) and opens the file by a link whose Lens is [#3, #4, #5, #7, #8, #9, #0]. Opening Versions reads #9, #8, #7 (Lens authors, skipped in the public tier): More of the list to check. Load more reads #5, #4, #3: none again, focus stays on Load more. #1 then saves a version (the list moves). Load more reads #2: a public row, focus on it, and the list changed: Refresh. Refresh reads from the newest entry: #1's row; focus on the first row.",
  );
  try {
    // The list, oldest first: #0 (the seed), #2 (public), then the Lens authors.
    for (const i of [2, 3, 4, 5, 7, 8, 9]) await chain.editAs?.(i, `Version by #${i}.\n`);
    const p: Record<number, string> = {};
    for (const i of [0, 1, 2, 3, 4, 5, 7, 8, 9]) p[i] = await principalOf(chain, i);
    await chain.attach(page);
    await serveConfig(page, PAGED_CONFIG);
    await serveDeployment(page, chain.deployment);
    const lens = [3, 4, 5, 7, 8, 9, 0].map((i) => p[i] as string);
    const shared = link({
      kind: 'object',
      subject: chain.ids.file as never,
      lens: { principals: lens } as never,
    });
    await page.goto(`./#/r/testnet/${shared}`);
    await booted(page);
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Version by #3.\n');
    chain.step('The link with a Lens of six version authors and #0: #3 shows');

    await toggle(page);
    await settled(page);
    const pub = tier(page, 'public').locator('li.efs-version');
    const more = versions(page).locator('wa-button.efs-versions-more');
    await expect(tier(page, 'lens').locator('li.efs-version')).toHaveCount(7);
    await expect(versions(page).locator('summary')).toHaveText(/^\s*Versions · 8\s*$/);
    // Three reads of one entry each, all Lens authors: no rows, and never "nobody else".
    await expect(versions(page).locator('.efs-versions-unchecked')).toHaveText(
      'More of the list to check.',
    );
    await expect(pub).toHaveCount(0);
    await expect(versions(page).locator('.efs-versions-no-others')).toHaveCount(0);
    await expect(more).toBeVisible();
    chain.step('Open Versions: three reads, no public row yet: More of the list to check');

    await press(more);
    await settled(page);
    await expect(pub).toHaveCount(0);
    await expect(versions(page).locator('.efs-versions-unchecked')).toBeVisible();
    // No new rows: focus stays on Load more.
    expect(await focused(more)).toBe(true);
    chain.step('Load more: three more reads, still no row; focus stays on Load more');

    await chain.editAs?.(1, 'Version by #1.\n');
    chain.step('#1 saves a version from Node: the list moves');
    await press(more);
    await settled(page);
    await expect(pub).toHaveCount(1);
    await expect(pub.first()).toHaveAttribute('data-author', (p[2] as string).toLowerCase());
    // A new row: focus moves to it.
    expect(await focused(pub.first())).toBe(true);
    await expect(versions(page).locator('.efs-versions-changed')).toContainText(
      'This list changed while you were reading it.',
    );
    await expect(versions(page).locator('.efs-versions-no-others')).toHaveCount(0);
    chain.step("Load more: #2's public row, focus on it; the list changed: Refresh");

    await press(versions(page).locator('wa-button.efs-versions-refresh'));
    await settled(page);
    await expect(pub.first()).toHaveAttribute('data-author', (p[1] as string).toLowerCase());
    await expect(versions(page).locator('.efs-versions-changed')).toHaveCount(0);
    await expect(versions(page).locator('summary')).toHaveText(/^\s*Versions · 9\s*$/);
    // Read again in place: focus on the first row, never on body.
    expect(await focused(versions(page).locator('li.efs-version').first())).toBe(true);
    await chain.idle(500);
    chain.step("Refresh: read from the newest entry, #1's row first; focus on the first row");
  } finally {
    await chain.finish();
  }
});

test("Versions: a Lens author's lone no hides the file; another Lens author's version has Show; the lone-no author has no row", async ({
  page,
}) => {
  const chain = await testChain(
    'client-versions-hidden',
    'From Node: #3 says "not this" on readme.txt before ever stating on it (the SDK\'s tests-only planHeadNo: a lone no, an entry in the versions list, never a version); #2 saves a version of their own. A guest opens readme.txt by a link whose Lens is [#3, #2]: the file is hidden (the walk stops at #3). Versions says "Hidden for you by" #3; the Lens tier holds #2\'s version only, with Show; #3 has no row. Show on #2: their version first.',
  );
  try {
    await chain.actAs?.(3, async ({ efs, writer, save }) => {
      const { planHeadNo } = await import('@efs/sdk/testing');
      const plan = await planHeadNo(efs, writer, {
        file: { kind: 'file', subject: chain.ids.file as never },
      });
      const review = (plan as { review?: { statement?: string } }).review;
      if (review?.statement !== 'lone-no')
        throw new Error(`expected a lone no: ${review?.statement}`);
      await save(plan);
    });
    await chain.editAs?.(2, 'Version by #2.\n');
    const p2 = await principalOf(chain, 2);
    const p3 = await principalOf(chain, 3);
    await chain.attach(page);
    await serveConfig(page);
    await serveDeployment(page, chain.deployment);
    const shared = link({
      kind: 'object',
      subject: chain.ids.file as never,
      lens: { principals: [p3, p2] } as never,
    });
    await page.goto(`./#/r/testnet/${shared}`);
    await booted(page);
    // Hidden in this Lens: no contents.
    await expect(preview(page).locator('efs-outcome')).toBeVisible();
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    chain.step('The link with the Lens [#3, #2]: the file is hidden (#3 said not this)');

    await toggle(page);
    await expect(versions(page).locator('.efs-versions-decision')).toHaveAttribute(
      'data-decision',
      'hidden',
    );
    await expect(versions(page).locator('.efs-versions-decision')).toHaveText(
      /^\s*Hidden for you by .+\.\s*$/,
    );
    await settled(page);
    const lensRows = tier(page, 'lens').locator('li.efs-version');
    await expect(lensRows).toHaveCount(1);
    await expect(lensRows.first()).toHaveAttribute('data-author', p2.toLowerCase());
    // The lone-no author is never a row, in any tier.
    await expect(versionRow(page, p3)).toHaveCount(0);
    // Nothing is shown here, so no row says "Showing here".
    await expect(versions(page).locator('li.efs-version[data-shown]')).toHaveCount(0);
    await expect(lensRows.first().getByRole('button')).toHaveAccessibleName(/^Show .+'s version$/);
    chain.step(
      "Versions: hidden for you by #3; #2's version in the Lens tier with Show; #3 has no row",
    );

    await press(lensRows.first().locator('wa-button.efs-version-show'));
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('Version by #2.\n');
    await expect(preview(page).locator('.efs-viewing-author')).toContainText(
      /Showing .+'s version first\./,
    );
    await expect(lensRows.first()).toHaveAttribute('data-shown', '');
    await settled(page);
    await chain.idle(500);
    chain.step("Show on #2's row: #2's version first");
  } finally {
    await chain.finish();
  }
});

// "Versions" in the Preview: everyone's versions of a file (the SDK's fileVersions, from the
// contracts' head-authors list) in the Lens the file was opened under.
//
// The seeded readme.txt (by the fixture author, its creator) gets versions of their own from anvil
// #2, then #3. The decision comes first; the Lens tier, then the creator's row when the creator is
// outside the Lens, then everyone else, labelled public, newest first by first version. A public
// row's Open shows that version behind the media gate; the creator's Show doesn't (the file view's
// own fallback opens the creator's version without it). "Versions · N" is `live`.
//
// Not here, and why: Load more, Refresh and the budget need a list longer than one page (150
// entries), so versions-model.test.ts pins them; the hidden decision by a Lens author's lone no
// waits for the SDK's planHeadNo (next pack), and is pinned there too.

import { AxeBuilder } from '@axe-core/playwright';
import { link } from '@efs/sdk/links';
import { type Page, test } from '@playwright/test';
import { type TestChain, testChain } from './chain.ts';
import { expect, preview, SEEDED, start } from './edit-support.ts';
import { press } from './press.ts';

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

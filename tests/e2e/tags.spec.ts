// Tags and addresses in the File Browser: a tag's list (a topic, `cars/tesla`) and an address's
// (a home, `0x…`), read through the SDK's topicItems. Tags are made from Node (live and record):
// anvil #0 is the deployment's default Lens, anvil #5 is nobody's. Recorded against the fixture
// chain (its own transcripts), replayed in all browsers.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import { expect, preview } from './edit-support.ts';
import { booted, serveConfig, serveDeployment } from './support.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

const topic = (page: Page) => page.locator('efs-files-topic');
const section = (page: Page, kind: 'lens' | 'public' | 'raw') =>
  topic(page).locator(`[data-section="${kind}"] .efs-topic-row`);
const crumbs = (page: Page) => page.locator('wa-breadcrumb wa-breadcrumb-item');
const radio = (page: Page, group: 'view' | 'scope', value: string) =>
  topic(page).locator(`wa-radio-group.efs-topic-${group} wa-radio[value="${value}"]`);

async function open(page: Page, chain: TestChain, route: string): Promise<void> {
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await page.goto(route);
  await booted(page);
}

/** Goes to `hash` in the same page (a link followed in the app). */
const go = (page: Page, hash: string) =>
  page.evaluate((h) => {
    location.hash = h;
  }, hash);

/** A text file `name` at the realm root by anvil `index`, tagged with each of `places`. */
async function taggedFile(
  chain: TestChain,
  index: number,
  name: string,
  places: readonly (readonly string[] | { readonly home: true })[],
) {
  await chain.actAs?.(index, async ({ files, root, lens, writer, efs, account, save }) => {
    const tags = await import('@efs/sdk/tags');
    const made = (await save(
      await files.planCreateFile(efs, writer, {
        folder: root,
        name,
        content: new TextEncoder().encode(`${name}\n`),
        lens,
      }),
    )) as { file: { subject: `0x${string}` } };
    const target = { kind: 'file', subject: made.file.subject } as const;
    for (const p of places) {
      const at = 'home' in p ? { kind: 'home' as const, address: account as `0x${string}` } : p;
      await save(await tags.planTag(efs, writer, { topic: at, targets: [target] }));
    }
    return { [name]: made.file.subject, [`account${index}`]: account };
  });
}

test('a tag lists what people tagged: Everyone by default, the public tier labelled and gated, rows filed below say where', async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-topic',
    'a.txt tagged /cars/tesla by anvil #0 (the default Lens); b.txt tagged /cars/tesla/model_y by anvil #5.',
  );
  try {
    await taggedFile(chain, 0, 'a.txt', [['cars', 'tesla']]);
    await taggedFile(chain, 5, 'b.txt', [['cars', 'tesla', 'model_y']]);
    await open(page, chain, './#/r/testnet/cars/tesla');
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(
      /Everything tagged\W+\/cars\/tesla/,
    );
    await expect(topic(page).locator('.efs-topic-mark')).toContainText('Tag');
    await expect(topic(page).locator('wa-radio-group.efs-topic-view')).toHaveJSProperty(
      'value',
      'everyone',
    );
    await expect(section(page, 'lens')).toHaveCount(1);
    await expect(section(page, 'lens')).toContainText(/tagged by\W+0x/);
    await expect(section(page, 'public')).toHaveCount(1);
    await expect(section(page, 'public')).toContainText(/1 person says it applies/);
    await expect(section(page, 'public')).toContainText(/filed at\W+\/cars\/tesla\/model_y/);
    await expect(topic(page).locator('[data-section="public"] h4')).toHaveText(
      'From everyone else · not checked by anyone you trust · recently added',
    );
    await expect(topic(page).locator('.efs-topic-count')).toHaveText(/About\W+2\W+tagged things/);
    await expect(crumbs(page)).toHaveCount(3);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-topic')
      .withTags(AXE_TAGS)
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('cars/tesla: Everyone, the Lens row named, the public row labelled and filed below');

    await radio(page, 'scope', 'here').click();
    await expect(section(page, 'public')).toHaveCount(0);
    await expect(section(page, 'lens')).toHaveCount(1);
    chain.step('Only here: the row filed below leaves');

    await radio(page, 'scope', 'below').click();
    await radio(page, 'view', 'mine').click();
    await expect(section(page, 'lens')).toHaveCount(1);
    await expect(section(page, 'public')).toHaveCount(0);
    chain.step('People I trust: the Lens row only');

    await radio(page, 'view', 'raw').click();
    await expect(section(page, 'raw')).toHaveCount(2);
    await expect(section(page, 'raw').first()).toContainText(/1 of 1 say it applies/);
    chain.step('Unfiltered: every row, with its counts');

    // A public-tier row opens behind the media gate; the list stays beside it.
    await radio(page, 'view', 'everyone').click();
    await expect(section(page, 'public')).toHaveCount(1);
    await section(page, 'public').locator('button.efs-entry-open').click();
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(topic(page)).toBeVisible();
    await expect(preview(page).locator('.efs-preview-gated')).toContainText(
      "Nobody you trust has checked this. Its contents aren't loaded until you ask.",
    );
    await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
    await preview(page).locator('wa-button.efs-preview-show').click();
    await expect(preview(page).locator('.efs-preview-text')).toContainText('b.txt');
    chain.step("Open the public row: gated; Show preview reads it; the tag's list stays");

    // A row from the Lens opens straight away.
    await section(page, 'lens').locator('button.efs-entry-open').click();
    await expect(preview(page).locator('.efs-preview-text')).toContainText('a.txt');
    await expect(preview(page).locator('.efs-preview-gated')).toHaveCount(0);
    chain.step('Open the Lens row: no gate');

    // The bar's words open their own tags.
    await go(page, '#/r/testnet/cars/tesla');
    await expect(section(page, 'lens')).toHaveCount(1);
    await crumbs(page).nth(1).click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/cars');
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(/Everything tagged\W+\/cars/);
    await expect(section(page, 'public')).toHaveCount(1);
    await chain.idle(500);
    chain.step('The bar: "cars" opens /cars, which rolls up both');
  } finally {
    await chain.finish();
  }
});

test('a word the network refuses is named before any read; a tag word ending .eth says it is not an address', async ({
  page,
}) => {
  const chain = await testChain('client-tags-words', 'No tags.');
  try {
    await open(page, chain, './#/r/testnet/Cars');
    const bad = topic(page).locator('.efs-topic-bad-word');
    await expect(bad).toContainText(/Cars\W+isn't a word the network accepts in a tag \(rule\W+3/);
    chain.step('Cars: refused by the grammar (rule 3), nothing read');

    await go(page, '#/r/testnet/vitalik.eth');
    await expect(topic(page).locator('.efs-topic-not-address')).toContainText(
      /This is the tag\W+vitalik\.eth\W+, not an address\./,
    );
    await expect(topic(page).locator('.efs-topic-mark')).toContainText('Tag');
    await expect(topic(page).locator('.efs-topic-empty')).toBeVisible();
    await chain.idle(500);
    chain.step('vitalik.eth: a tag, said not to be an address; nothing tagged');
  } finally {
    await chain.finish();
  }
});

test("an address lists what's attached to it, the address first: its own rows unlabelled, everyone else's named", async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-home',
    "c.txt attached to anvil #5's address by #5; a.txt attached there by anvil #0.",
  );
  try {
    await taggedFile(chain, 5, 'c.txt', [{ home: true }]);
    const five = chain.ids.account5 as string;
    await chain.actAs?.(0, async ({ files, root, lens, writer, efs, save }) => {
      const tags = await import('@efs/sdk/tags');
      const made = (await save(
        await files.planCreateFile(efs, writer, {
          folder: root,
          name: 'a.txt',
          content: new TextEncoder().encode('a.txt\n'),
          lens,
        }),
      )) as { file: { subject: `0x${string}` } };
      await save(
        await tags.planTag(efs, writer, {
          topic: { kind: 'home', address: five as `0x${string}` },
          targets: [{ kind: 'file', subject: made.file.subject }],
        }),
      );
    });
    await open(page, chain, `./#/r/testnet/${five}`);
    await expect(topic(page).locator('.efs-topic-mark')).toContainText('Address');
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(/Everything at\W+0x/);
    await expect(topic(page).locator('wa-radio-group.efs-topic-scope')).toHaveCount(0);
    const rows = section(page, 'lens');
    await expect(rows).toHaveCount(2);
    await expect(rows.locator('.efs-topic-who').filter({ hasText: 'tagged by' })).toHaveCount(1);
    await expect(rows.locator('.efs-topic-who').filter({ hasText: /^$/ })).toHaveCount(1);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-topic')
      .withTags(AXE_TAGS)
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step("The address: its own row unlabelled, #0's named");

    await go(page, `#/r/testnet/${five}/photos/cat.jpg`);
    await expect(topic(page).locator('.efs-home-names-soon')).toContainText(
      "Names under an address can't be read yet.",
    );
    await topic(page).locator('wa-button.efs-home-open').click();
    await expect.poll(() => new URL(page.url()).hash).toBe(`#/r/testnet/${five}`);
    await expect(section(page, 'lens')).toHaveCount(2);
    await chain.idle(500);
    chain.step('Names under the address: not readable yet; Open the address');
  } finally {
    await chain.finish();
  }
});

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
    // Tags under this one: model_y, with its count.
    const child = topic(page).locator('[data-section="children"] .efs-topic-child');
    await expect(child).toHaveCount(1);
    await expect(child).toContainText('/cars/tesla/model_y');
    await expect(child).toContainText(/about\W+1\W+tagged thing/);
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

    // A child opens its own tag.
    await go(page, '#/r/testnet/cars/tesla');
    await expect(child).toHaveCount(1);
    await child.locator('button.efs-entry-open').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/cars/tesla/model_y');
    await expect(section(page, 'public')).toHaveCount(1);
    chain.step('Tags under this one: model_y opens its own tag');

    // The bar's first word opens its word's page; the plain tag opens from there, and back.
    await crumbs(page).nth(1).click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/cars');
    const word = page.locator('efs-files-word');
    await expect(word.locator('.efs-topic-title')).toHaveText(
      /Everything tagged with the word\W+cars/,
    );
    const plainGroup = word.locator('.efs-word-group[data-root="yes"]');
    await expect(plainGroup).toContainText(/\/cars\W+\(just the word\)/);
    await expect(plainGroup).toContainText(/about\W+2\W+tagged things/);
    await expect(plainGroup.locator('.efs-topic-row')).toHaveCount(2);
    await plainGroup.locator('wa-button.efs-word-open').click();
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(/Everything tagged\W+\/cars/);
    await expect(section(page, 'public')).toHaveCount(1);
    await topic(page).locator('wa-button.efs-word-back').click();
    await expect(plainGroup).toBeVisible();
    await chain.idle(500);
    chain.step('The bar: "cars" opens the word page; the plain /cars lists both; back to the page');
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
    const bad = page.locator('efs-files-word .efs-topic-bad-word');
    await expect(bad).toContainText(/Cars\W+isn't a word the network accepts in a tag \(rule\W+3/);
    chain.step('Cars: refused by the grammar (rule 3), nothing read');

    await go(page, '#/r/testnet/vitalik.eth');
    const word = page.locator('efs-files-word');
    await expect(word.locator('.efs-topic-not-address')).toContainText(
      /This is the tag\W+vitalik\.eth\W+, not an address\./,
    );
    await expect(word.locator('.efs-topic-mark')).toContainText('Tag');
    // A word nobody has used: the SDK's wordPage says INVALID today (its reader's ABSENT_PROVEN,
    // asked to become an empty, finished page). Shown as refused, never as "couldn't be confirmed".
    await expect(word.locator('.efs-word-invalid')).toContainText(
      "This word's places can't be read:",
    );
    await expect(word.locator('efs-outcome')).toHaveCount(0);
    await chain.idle(500);
    chain.step('vitalik.eth: a tag, said not to be an address; nothing tagged');
  } finally {
    await chain.finish();
  }
});

test('a word page groups every place that uses the word, the plain tag first, never one mixed list', async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-word-page',
    'p.txt tagged /tesla, c.txt tagged /cars/tesla and k.txt tagged /companies/tesla, all by anvil #0.',
  );
  try {
    await taggedFile(chain, 0, 'p.txt', [['tesla']]);
    await taggedFile(chain, 0, 'c.txt', [['cars', 'tesla']]);
    await taggedFile(chain, 0, 'k.txt', [['companies', 'tesla']]);
    await open(page, chain, './#/r/testnet/tesla');
    const word = page.locator('efs-files-word');
    await expect(word.locator('.efs-topic-title')).toHaveText(
      /Everything tagged with the word\W+tesla/,
    );
    const groups = word.locator('.efs-word-group');
    await expect(groups).toHaveCount(3);
    await expect(word.locator('.efs-word-count')).toHaveText(/3\W+places use it/);
    // The plain tag first; each place its own group, each with its own items.
    await expect(groups.first()).toHaveAttribute('data-root', 'yes');
    await expect(groups.first()).toContainText(/\/tesla\W+\(just the word\)/);
    for (const path of ['/cars/tesla', '/companies/tesla']) {
      const g = groups.filter({ hasText: path });
      await expect(g).toHaveCount(1);
      await expect(g.locator('.efs-topic-row')).toHaveCount(1);
    }
    await expect(word.locator('.efs-topic-section')).toHaveCount(0);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-word')
      .withTags(AXE_TAGS)
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('tesla: three groups, the plain tag first, no mixed list');

    await groups.filter({ hasText: '/companies/tesla' }).locator('wa-button.efs-word-open').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/companies/tesla');
    await expect(section(page, 'lens')).toHaveCount(1);
    await chain.idle(500);
    chain.step('Open /companies/tesla: its own tag');
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

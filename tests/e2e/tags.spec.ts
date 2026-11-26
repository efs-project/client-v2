// Tags and addresses in the File Browser: a tag's list (a topic, `cars/tesla`) and an address's
// (a home, `0x…`), read through the SDK's topicItems. Tags are made from Node (live and record):
// anvil #0 is the deployment's default Lens, anvil #5 is nobody's. Recorded against the fixture
// chain (its own transcripts), replayed in all browsers.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import { expect, preview, save } from './edit-support.ts';
import { fileAtRoot, openRoot, row } from './folder-support.ts';
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

/**
 * Waits until no tag list or word page is reading (`data-reading`): its rows, paths, children
 * and names. Each step then starts from the same reads in every browser, so replays match.
 */
const settled = (page: Page) =>
  expect(
    page.locator(
      'efs-files-topic[data-reading], efs-files-word[data-reading], efs-files-file-tags[data-reading]',
    ),
  ).toHaveCount(0);

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
    // Authors show as their checksummed address (displayOf), never the padded principal.
    await expect(section(page, 'lens')).toContainText(/tagged by\W+0xf39F…2266/);
    // Each file by its name (fileNames: its creator's entry at the root), never an invented one.
    await expect(section(page, 'lens').locator('.efs-entry-name')).toHaveText('a.txt');
    await expect(section(page, 'public').locator('.efs-entry-name')).toHaveText('b.txt');
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

    await settled(page);
    await radio(page, 'scope', 'here').click();
    await expect(section(page, 'public')).toHaveCount(0);
    await expect(section(page, 'lens')).toHaveCount(1);
    chain.step('Only here: the row filed below leaves');

    await settled(page);
    await radio(page, 'scope', 'below').click();
    await settled(page);
    await radio(page, 'view', 'mine').click();
    await expect(section(page, 'lens')).toHaveCount(1);
    await expect(section(page, 'public')).toHaveCount(0);
    chain.step('People I trust: the Lens row only');

    await settled(page);
    await radio(page, 'view', 'raw').click();
    await expect(section(page, 'raw')).toHaveCount(2);
    await expect(section(page, 'raw').first()).toContainText(/1 of 1 say it applies/);
    chain.step('Unfiltered: every row, with its counts');

    // A public-tier row opens behind the media gate; the list stays beside it.
    await settled(page);
    await radio(page, 'view', 'everyone').click();
    await expect(section(page, 'public')).toHaveCount(1);
    await settled(page);
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
    await settled(page);
    await section(page, 'lens').locator('button.efs-entry-open').click();
    await expect(preview(page).locator('.efs-preview-text')).toContainText('a.txt');
    await expect(preview(page).locator('.efs-preview-gated')).toHaveCount(0);
    // Its tags (lensTagsOf), read when the section opens: /cars/tesla, from the Lens.
    await preview(page).locator('details.efs-file-tags summary').click();
    const fileTag = preview(page).locator('[data-section="lens"] .efs-file-tag');
    await expect(fileTag).toHaveCount(1);
    await expect(fileTag).toContainText('/cars/tesla');
    await expect(fileTag).toContainText(/tagged by\W+0xf39F…2266/);
    chain.step('Open the Lens row: no gate');

    // A child opens its own tag.
    await settled(page);
    await go(page, '#/r/testnet/cars/tesla');
    await expect(child).toHaveCount(1);
    await settled(page);
    await child.locator('button.efs-entry-open').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/cars/tesla/model_y');
    // Its own list (the parent's also had one public row): the title says which tag is shown.
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(
      /Everything tagged\W+\/cars\/tesla\/model_y/,
    );
    await expect(section(page, 'public')).toHaveCount(1);
    chain.step('Tags under this one: model_y opens its own tag');

    // The bar's first word opens its word's page; the plain tag opens from there, and back.
    await settled(page);
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
    await settled(page);
    await plainGroup.locator('wa-button.efs-word-open').click();
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(/Everything tagged\W+\/cars/);
    await expect(section(page, 'public')).toHaveCount(1);
    await settled(page);
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
    // A word nobody has used: proven absent (the reader's own proof), so "no tag uses it yet",
    // never "couldn't be confirmed" or a refusal.
    await expect(word.locator('.efs-topic-empty')).toContainText(
      /No tag uses the word\W+vitalik\.eth\W+yet\./,
    );
    await expect(word.locator('efs-outcome, .efs-word-invalid')).toHaveCount(0);
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
    for (const [path, file] of [
      ['/cars/tesla', 'c.txt'],
      ['/companies/tesla', 'k.txt'],
    ] as const) {
      const g = groups.filter({ hasText: path });
      await expect(g).toHaveCount(1);
      await expect(g.locator('.efs-topic-row')).toHaveCount(1);
      await expect(g.locator('.efs-topic-row .efs-entry-name')).toHaveText(file);
    }
    await expect(word.locator('.efs-topic-section')).toHaveCount(0);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-word')
      .withTags(AXE_TAGS)
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('tesla: three groups, the plain tag first, no mixed list');

    await settled(page);
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
    await expect(topic(page).locator('.efs-topic-title')).toHaveText(/Things tagged at\W+0x/);
    // Its own entries list above, like a folder's: nothing placed there yet.
    await expect(page.locator('efs-files-listing')).toContainText(
      'Nothing is placed at this address yet, in your view.',
    );
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

    // Names under the address are looked up (openPath); nothing is named photos there.
    await settled(page);
    await go(page, `#/r/testnet/${five}/photos/cat.jpg`);
    await expect(preview(page).locator('.efs-preview-no-path')).toContainText(
      /Nothing named\W+photos\W+is on this path/,
    );
    expect(new URL(page.url()).hash).toContain('/photos/cat.jpg');
    await chain.idle(500);
    chain.step('Names under the address: photos is not there; it says which, and the path stays');
  } finally {
    await chain.finish();
  }
});

test("an address lists its own entries like a folder: yours first, the owner's unlabelled; names under it open by their own link", async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-home-entries',
    'anvil #5 places docs/ (with note.txt) and pet.txt at its own address; anvil #6 places its own pet.txt there too.',
  );
  try {
    await chain.actAs?.(5, async ({ files, lens, writer, efs, account, save }) => {
      const home = { kind: 'home' as const, address: account as `0x${string}` };
      const docs = (
        (await save(
          await files.planCreateFolder(efs, writer, { folder: home, name: 'docs', lens }),
        )) as { created: import('@efs/sdk/files').FolderRef }
      ).created;
      for (const [folder, name] of [
        [docs, 'note.txt'],
        [home, 'pet.txt'],
      ] as const) {
        await save(
          await files.planCreateFile(efs, writer, {
            folder,
            name,
            content: new TextEncoder().encode(`${name} by #5\n`),
            lens,
          }),
        );
      }
      return { account5: account };
    });
    const five = chain.ids.account5 as string;
    await chain.actAs?.(6, async ({ files, lens, writer, efs, save }) => {
      await save(
        await files.planCreateFile(efs, writer, {
          folder: { kind: 'home', address: five as `0x${string}` },
          name: 'pet.txt',
          content: new TextEncoder().encode('pet.txt by #6\n'),
          lens,
        }),
      );
    });
    await openRoot(page, chain);
    await go(page, `#/r/testnet/${five}`);
    // You first, then the address: your pet.txt ("yours"), its docs/ (unlabelled).
    await expect(row(page, 'docs')).toBeVisible();
    await expect(row(page, 'docs').locator('.efs-entry-whose')).toHaveCount(0);
    await expect(row(page, 'pet.txt').locator('.efs-entry-whose')).toHaveText('yours');
    // Writable once the address's key is read: New folder here, Remove on your own pet.txt; no
    // Block on #5's docs/ (it isn't your address).
    await expect(page.locator('efs-files-listing wa-button.efs-new-folder')).toBeVisible();
    await expect(row(page, 'pet.txt').locator('wa-button.efs-entry-remove')).toBeVisible();
    await expect(row(page, 'docs').locator('wa-button.efs-entry-block')).toHaveCount(0);
    chain.step("The address: its entries, yours first, the owner's unlabelled; yours to change");

    await settled(page);
    await row(page, 'docs').locator('button.efs-entry-open').click();
    await expect(row(page, 'note.txt')).toBeVisible();
    const crumbs = page.locator('wa-breadcrumb wa-breadcrumb-item');
    await expect(crumbs).toHaveCount(2);
    await expect(crumbs.first()).toContainText(/0x/);
    await expect(crumbs.last()).toContainText('docs');
    chain.step('docs/ opens below the address: the bar starts at the address');

    await settled(page);
    await go(page, `#/r/testnet/${five}/docs/note.txt`);
    await expect(preview(page).locator('.efs-preview-text')).toContainText('note.txt by #5');
    await expect.poll(() => new URL(page.url()).hash).toMatch(/~efs\/o\/0x[0-9a-f]{64}$/);
    await chain.idle(500);
    chain.step('A name under the address opens the file by its own link');
  } finally {
    await chain.finish();
  }
});

const tagDialog = (page: Page) =>
  page.locator('efs-files-folder-save.efs-preview-tag-dialog wa-dialog');
/** The dialog's own count of plans this opening made (`data-plans`): a second would mean a re-plan. */
const plansOf = (page: Page, which: 'efs-preview-tag-dialog' | 'efs-topic-tag-dialog') =>
  page.locator(`efs-files-folder-save.${which}`);

test('Tag from the Preview: suggestions from the word, a new tag said new, the review names what it creates; then Remove my tag', async ({
  page,
  browserName,
}) => {
  // QUARANTINED in WebKit replay (2026-11-26; docs/design/writes.md "Quarantined"). On CI twice
  // (main 9d701db, f522ce1) WebKit issued the tag plan's 4-entry reads-contract call (0xd62efcd9)
  // again at the block after the tag landed, a call the recording has only before it: a replay
  // miss at finish, with every assertion passing and data-plans 1 per opening (so not a re-plan of
  // the dialog; a re-read elsewhere). Never reproduced locally (30/30). Chromium and Firefox still
  // run it, and so does the live job. Lift it once the re-reading reader is found.
  test.skip(
    browserName === 'webkit' && CHAIN_MODE === 'replay',
    'quarantined in WebKit replay: a late re-read after the tag lands (see the comment above)',
  );
  const chain = await testChain(
    'client-tags-tagging',
    'note.txt at the root by anvil #6; c.txt tagged /cars/tesla by anvil #0.',
  );
  try {
    await fileAtRoot(chain, 6, 'note.txt', 'note\n');
    await taggedFile(chain, 0, 'c.txt', [['cars', 'tesla']]);
    await openRoot(page, chain);
    await row(page, 'note.txt').locator('.efs-entry-open').click();
    await expect(preview(page).locator('.efs-preview-text')).toContainText('note');
    await preview(page).locator('wa-button.efs-preview-tag').click();
    const d = tagDialog(page);
    await expect(d).toHaveAttribute('open', '');
    const path = d.locator('wa-input.efs-tag-path input');

    // Typing a word lists the places that use it, with their counts.
    await path.fill('tesla');
    // The plain /tesla first (registered with /cars/tesla's words, nothing filed there), then
    // /cars/tesla.
    const suggestion = d.locator('.efs-tag-suggestion');
    await expect(suggestion).toHaveCount(2);
    await expect(suggestion.first()).toContainText('/tesla');
    await expect(suggestion.first()).toContainText(/about\W+0\W+tagged things, from everyone/);
    await expect(suggestion.nth(1)).toContainText('/cars/tesla');
    await expect(suggestion.nth(1)).toContainText(/about\W+1\W+tagged thing, from everyone/);
    // A path nobody has used is said to be new before anything is signed.
    await path.fill('notes/todo');
    await expect(d.locator('.efs-tag-new')).toContainText(/Nobody has used\W+\/notes\/todo\W+yet/);
    // A word the grammar refuses is named, and Review stays off.
    await path.fill('Notes');
    await expect(d.locator('.efs-tag-refused')).toContainText(/rule\W+3/);
    await expect(d.locator('wa-button.efs-tag-review')).toHaveAttribute('disabled', '');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const axe = await new AxeBuilder({ page })
      .include('efs-files-folder-save.efs-preview-tag-dialog')
      .withTags(AXE_TAGS)
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    chain.step('Tag note.txt: suggestions for tesla; notes/todo is new; Notes is refused');

    // "Not this" is a different act: its review says what it hides, and where it doesn't reach.
    await path.fill('notes/todo');
    await d.locator('wa-radio-group.efs-tag-stance wa-radio[value="deny"]').click();
    await d.locator('wa-button.efs-tag-review').click();
    await expect(d.locator('.efs-tag-says')).toContainText(/Say\W+0x.+is not\W+\/notes\/todo/);
    await expect(d.locator('.efs-tag-reach')).toContainText(/It says nothing about\W+\/notes\b/);
    await expect(d.locator('wa-button.efs-folder-send')).toHaveText('Not this');
    await d.locator('wa-button', { hasText: 'Cancel' }).click();
    await expect(d).not.toHaveAttribute('open');
    chain.step('Not this: its review states its reach; Cancel sends nothing');

    await preview(page).locator('wa-button.efs-preview-tag').click();
    await path.fill('notes/todo');
    await d.locator('wa-button.efs-tag-review').click();
    await expect(d.locator('.efs-tag-says')).toContainText(/Tag\W+0x.+\/notes\/todo/);
    await expect(d.locator('.efs-tag-creates')).toContainText(
      /Creates\W+2\W+new tags:\W+\/notes, \/notes\/todo/,
    );
    await expect(d.locator('.efs-tag-public')).toContainText('Tags are public and permanent');
    await d.locator('wa-button.efs-folder-send').click();
    await expect(d).not.toHaveAttribute('open');
    await expect(save(page, 'confirming').or(save(page, 'saved'))).toHaveCount(1, {
      timeout: 20_000,
    });
    // One plan for this opening: nothing planned it again after Send.
    await expect(plansOf(page, 'efs-preview-tag-dialog')).toHaveAttribute('data-plans', '1');
    chain.step('Review: creates /notes and /notes/todo, public and permanent; Send');

    // The tag lists it as yours; Remove my tag takes it back.
    await go(page, '#/r/testnet/notes/todo');
    const mine = section(page, 'lens');
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('tagged by you');
    await expect(mine.locator('.efs-entry-name')).toHaveText('note.txt');
    await settled(page);
    await mine.locator('wa-button.efs-topic-untag').click();
    const untag = page.locator('efs-files-folder-save.efs-topic-tag-dialog wa-dialog');
    await expect(untag.locator('.efs-tag-untag')).toContainText('Your tag goes');
    await expect(untag.locator('wa-button.efs-folder-send')).toHaveText('Remove my tag');
    await untag.locator('wa-button.efs-folder-send').click();
    await expect(untag).not.toHaveAttribute('open');
    await expect(topic(page).locator('.efs-topic-empty')).toBeVisible({ timeout: 20_000 });
    await chain.idle(500);
    // Still one plan each, after everything settled: neither dialog planned again late.
    await expect(plansOf(page, 'efs-topic-tag-dialog')).toHaveAttribute('data-plans', '1');
    if ((await plansOf(page, 'efs-preview-tag-dialog').count()) > 0) {
      await expect(plansOf(page, 'efs-preview-tag-dialog')).toHaveAttribute('data-plans', '1');
    }
    chain.step('notes/todo lists it as yours; Remove my tag; the list reads again, empty');
  } finally {
    await chain.finish();
  }
});

test('Name this tag: your name in your language, said public in the review; the title shows it; then remove it', async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-name',
    'c.txt tagged /photos/sunsets by anvil #0; anvil #6 (the wallet) names the tag, then removes its name.',
  );
  const naming = page.locator('efs-files-folder-save.efs-topic-tag-dialog wa-dialog');
  const title = topic(page).locator('.efs-topic-title');
  try {
    await taggedFile(chain, 0, 'c.txt', [['photos', 'sunsets']]);
    await openRoot(page, chain);
    await go(page, '#/r/testnet/photos/sunsets');
    await expect(section(page, 'lens')).toHaveCount(1);
    await settled(page);
    await expect(title).toContainText('/photos/sunsets');
    // Connected, with no name of yours yet: the button alone.
    await expect(topic(page).locator('.efs-topic-mine')).toHaveCount(0);
    await topic(page).locator('wa-button.efs-topic-name').click();
    await expect(naming).toHaveAttribute('open', '');
    await expect(naming.locator('wa-input.efs-label-text')).toHaveAttribute(
      'label',
      /Your name for\W+\/photos\/sunsets\W+in\W+English/,
    );
    await expect(naming.locator('wa-button.efs-label-remove')).toHaveCount(0);
    await naming.locator('wa-input.efs-label-text input').fill('Sunset photos');
    await naming.locator('wa-button.efs-label-review').click();
    await expect(naming.locator('.efs-label-says')).toContainText(
      /Name\W+\/photos\/sunsets\W+“\W*Sunset photos\W*”\W+in\W+English/,
    );
    await expect(naming.locator('.efs-label-public')).toContainText(
      'Names are public and permanent',
    );
    await expect(naming.locator('wa-button.efs-folder-send')).toHaveText('Save the name');
    chain.step('Name this tag: "Sunset photos" in English; the review says names are public');

    await naming.locator('wa-button.efs-folder-send').click();
    await expect(naming).not.toHaveAttribute('open');
    await expect(title).toContainText('/photos/Sunset photos', { timeout: 20_000 });
    await expect(topic(page).locator('.efs-topic-words')).toContainText('/photos/sunsets');
    await expect(topic(page).locator('.efs-topic-mine')).toContainText(
      /You call it\W+Sunset photos\W+in\W+English/,
    );
    await settled(page);
    await expect(plansOf(page, 'efs-topic-tag-dialog')).toHaveAttribute('data-plans', '1');
    chain.step('Send: the title shows your name; the words stay below it');

    // Again: your name is offered to change, unchanged it can't be reviewed; Remove my name.
    await topic(page).locator('wa-button.efs-topic-name').click();
    await expect(naming.locator('wa-input.efs-label-text')).toHaveJSProperty(
      'value',
      'Sunset photos',
    );
    await expect(naming.locator('wa-button.efs-label-review')).toHaveAttribute('disabled', '');
    await naming.locator('wa-button.efs-label-remove').click();
    await expect(naming.locator('.efs-label-says')).toContainText(
      /Your name for\W+\/photos\/sunsets\W+in\W+English\W+goes/,
    );
    await expect(naming.locator('wa-button.efs-folder-send')).toHaveText('Remove my name');
    await naming.locator('wa-button.efs-folder-send').click();
    await expect(naming).not.toHaveAttribute('open');
    await expect(topic(page).locator('.efs-topic-mine')).toHaveCount(0, { timeout: 20_000 });
    await expect(title).toContainText('/photos/sunsets');
    await settled(page);
    await chain.idle(500);
    chain.step('Remove my name: one send; the title is the words again');
  } finally {
    await chain.finish();
  }
});

/**
 * Whether anything in the Entries pane runs past the right edge: the page scrolling sideways, or
 * an element (a long path, an address) wider than the screen inside a pane that clips it.
 */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const scroll = Math.max(0, document.documentElement.scrollWidth - innerWidth);
    const past = [
      ...document.querySelectorAll('efs-files-topic *, efs-files-word *, efs-files-listing *'),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > innerWidth + 0.5;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${el.className}` : ''}`);
    return { scroll, past };
  });

test('320 px: a tag, a word page and an address view fit with no sideways scroll', async ({
  page,
}) => {
  const chain = await testChain(
    'client-views-320',
    'c.txt tagged /photos/sunsets and /sunsets by anvil #0; note.txt at anvil #0’s address.',
  );
  try {
    await taggedFile(chain, 0, 'c.txt', [['photos', 'sunsets'], ['sunsets']]);
    await chain.actAs?.(0, async ({ files, lens, writer, efs, account, save }) => {
      await save(
        await files.planCreateFile(efs, writer, {
          folder: { kind: 'home', address: account as `0x${string}` },
          name: 'a-rather-long-note-name-for-a-narrow-screen.txt',
          content: new TextEncoder().encode('note\n'),
          lens,
        }),
      );
      return { account0: account };
    });
    const zero = chain.ids.account0 as string;
    await page.setViewportSize({ width: 320, height: 640 });

    await open(page, chain, './#/r/testnet/photos/sunsets');
    await page.getByRole('tab', { name: 'Entries' }).click();
    await expect(section(page, 'public').or(section(page, 'lens'))).toHaveCount(1);
    await settled(page);
    expect(await sideways(page)).toEqual({ scroll: 0, past: [] });
    chain.step('The tag /photos/sunsets at 320 px: nothing runs past the edge');

    await go(page, '#/r/testnet/sunsets');
    await expect(page.locator('efs-files-word .efs-word-group').first()).toBeVisible();
    await settled(page);
    expect(await sideways(page)).toEqual({ scroll: 0, past: [] });
    chain.step('The word page sunsets at 320 px');

    await go(page, `#/r/testnet/${zero}`);
    await expect(row(page, 'a-rather-long-note-name-for-a-narrow-screen.txt')).toBeVisible();
    await settled(page);
    await chain.idle(500);
    expect(await sideways(page)).toEqual({ scroll: 0, past: [] });
    chain.step("anvil #0's address at 320 px: its full address and a long name fit");
  } finally {
    await chain.finish();
  }
});

test('Synonyms: "Same as…" lists the other tag as yours (a link, never merged), "Under…", the word level, then Remove yours', async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-same',
    'c.txt tagged /cars/tesla by anvil #0, who also says the word tesla is the same as tsla; anvil #6 (the wallet) joins /cars/tesla to /auto/tesla, puts it under /vehicles, then removes both.',
  );
  const d = page.locator('efs-files-folder-save.efs-topic-tag-dialog wa-dialog');
  const synonyms = topic(page).locator('[data-section="synonyms"]');
  try {
    await taggedFile(chain, 0, 'c.txt', [['cars', 'tesla']]);
    await chain.actAs?.(0, async ({ efs, writer, save }) => {
      const tags = await import('@efs/sdk/tags');
      await save(await tags.planSame(efs, writer, { topic: ['tesla'], other: ['tsla'] }));
    });
    await openRoot(page, chain);
    await go(page, '#/r/testnet/cars/tesla');
    await expect(section(page, 'lens')).toHaveCount(1);
    await settled(page);
    // The word level, from the default view's author: tesla is the same as tsla, a link of its own.
    await expect(synonyms).toContainText('Same word elsewhere');
    await expect(synonyms).toContainText(/Tags with the word\W+tesla\W+are the same as tags with/);
    await expect(synonyms.locator('.efs-synonym')).toHaveCount(1);
    await expect(synonyms.locator('.efs-synonym')).toContainText(/tsla[\s\S]*said by\W+0xf39F/);
    await expect(synonyms).not.toContainText('Also called');
    await expect(synonyms.locator('.efs-synonyms-more')).toHaveCount(0);
    chain.step('/cars/tesla: the word tesla is the same as tsla (said by #0); nothing else');

    await topic(page).locator('wa-button.efs-topic-same').click();
    await expect(d).toHaveAttribute('open', '');
    await expect(d.locator('wa-input.efs-tag-path')).toHaveAttribute(
      'label',
      /The tag\W+\/cars\/tesla\W+is the same as/,
    );
    await expect(d.locator('.efs-tag-stance')).toHaveCount(0);
    await d.locator('wa-input.efs-tag-path input').fill('cars/tesla');
    await expect(d.locator('.efs-folder-name-error')).toContainText("can't be joined to itself");
    await expect(d.locator('wa-button.efs-join-review')).toHaveAttribute('disabled', '');
    await d.locator('wa-input.efs-tag-path input').fill('auto/tesla');
    await d.locator('wa-button.efs-join-review').click();
    await expect(d.locator('.efs-label-says')).toContainText(
      /\/cars\/tesla\W+is the same as\W+\/auto\/tesla/,
    );
    await expect(d.locator('.efs-label-public')).toContainText(
      'others decide whether to follow you',
    );
    await expect(d.locator('wa-button.efs-folder-send')).toHaveText("Say they're the same");
    await d.locator('wa-button.efs-folder-send').click();
    await expect(d).not.toHaveAttribute('open');
    const also = synonyms.locator('.efs-synonym', { hasText: '/auto/tesla' });
    await expect(also).toContainText('said by you', { timeout: 20_000 });
    await expect(synonyms).toContainText('Also called');
    await settled(page);
    await expect(plansOf(page, 'efs-topic-tag-dialog')).toHaveAttribute('data-plans', '1');
    chain.step('Same as /auto/tesla: the review says others decide; it lists as yours');

    await topic(page).locator('wa-button.efs-topic-under').click();
    await d.locator('wa-input.efs-tag-path input').fill('vehicles');
    await d.locator('wa-button.efs-join-review').click();
    await expect(d.locator('.efs-label-says')).toContainText(
      /\/cars\/tesla\W+is under\W+\/vehicles/,
    );
    await expect(d.locator('wa-button.efs-folder-send')).toHaveText("Say it's under");
    await d.locator('wa-button.efs-folder-send').click();
    await expect(d).not.toHaveAttribute('open');
    const under = topic(page).locator(
      '[data-section="broader"] [data-group="under"] .efs-synonym',
      {
        hasText: '/vehicles',
      },
    );
    await expect(under).toContainText('said by you', { timeout: 20_000 });
    await settled(page);
    chain.step('Under /vehicles: one send; "This tag is under" lists it as yours');

    await also.locator('wa-button.efs-synonym-remove').click();
    await expect(d.locator('.efs-label-says')).toContainText(
      /Your\W+\/cars\/tesla\W+is the same as\W+\/auto\/tesla\W+goes/,
    );
    await expect(d.locator('wa-button.efs-folder-send')).toHaveText('Remove mine');
    await d.locator('wa-button.efs-folder-send').click();
    await expect(d).not.toHaveAttribute('open');
    await expect(also).toHaveCount(0, { timeout: 20_000 });
    await settled(page);
    chain.step('Remove yours: one send; /auto/tesla is no longer listed');

    await under.locator('wa-button.efs-synonym-remove').click();
    await expect(d.locator('.efs-label-says')).toContainText(
      /Your\W+\/cars\/tesla\W+is under\W+\/vehicles\W+goes/,
    );
    await d.locator('wa-button.efs-folder-send').click();
    await expect(d).not.toHaveAttribute('open');
    await expect(under).toHaveCount(0, { timeout: 20_000 });
    await settled(page);
    await chain.idle(500);
    chain.step('Remove your "under": one send; /vehicles is no longer listed');
  } finally {
    await chain.finish();
  }
});

test('Kind filter on a tag and its word page: Files, Folders, Addresses and Other, each said with what it left out', async ({
  page,
}) => {
  const chain = await testChain(
    'client-tags-kinds',
    'At /cars/models, anvil #0 tags c.txt (a file), pics/ (a folder) and anvil #5 (an address).',
  );
  const kind = (value: string) => page.locator(`wa-option[value="${value}"]`);
  const names = () => topic(page).locator('.efs-topic-row .efs-entry-name').allTextContents();
  try {
    await chain.actAs?.(5, async ({ account }) => ({ account5: account }));
    const five = chain.ids.account5 as `0x${string}`;
    await chain.actAs?.(0, async ({ files, root, lens, writer, efs, save }) => {
      const tags = await import('@efs/sdk/tags');
      const file = (
        (await save(
          await files.planCreateFile(efs, writer, {
            folder: root,
            name: 'c.txt',
            content: new TextEncoder().encode('c\n'),
            lens,
          }),
        )) as { file: { subject: `0x${string}` } }
      ).file;
      const pics = (
        (await save(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'pics', lens }),
        )) as { created: import('@efs/sdk/files').FolderRef }
      ).created;
      await save(
        await tags.planTag(efs, writer, {
          topic: ['cars', 'models'],
          targets: [
            { kind: 'file', subject: file.subject },
            pics,
            { kind: 'address', address: five },
          ],
        }),
      );
    });
    await open(page, chain, './#/r/testnet/cars/models');
    await expect(topic(page).locator('.efs-topic-row')).toHaveCount(3);
    await settled(page);
    chain.step('/cars/models: a file, a folder and an address, all shown');

    await topic(page).locator('wa-select.efs-topic-kind').click();
    await kind('file').click();
    await expect(topic(page).locator('.efs-topic-row')).toHaveCount(1);
    await expect(topic(page).locator('.efs-topic-filtered')).toContainText(
      /2\W+other entries hidden by the filter/,
    );
    await settled(page);
    chain.step('Files: only the file; the other two are said as hidden by the filter');

    await topic(page).locator('wa-select.efs-topic-kind').click();
    await kind('address').click();
    await expect(topic(page).locator('.efs-topic-row')).toHaveCount(1);
    expect(await names()).toEqual([expect.stringMatching(/^0x/)]);
    await settled(page);
    chain.step('Addresses: only the address, its own choice');

    await topic(page).locator('wa-select.efs-topic-kind').click();
    await kind('other').click();
    await expect(topic(page).locator('.efs-topic-filtered')).toContainText(
      /3\W+other entries hidden by the filter/,
    );
    await expect(topic(page).locator('.efs-topic-row')).toHaveCount(0);
    // Things were left out: never "Nothing is tagged here".
    await expect(topic(page).locator('.efs-topic-empty')).toHaveCount(0);
    await settled(page);
    chain.step('Other: nothing of another app here; said as filtered, never as "nothing tagged"');

    // The word page's groups take the same filter.
    await go(page, '#/r/testnet/models');
    const group = page.locator('efs-files-word .efs-word-group', { hasText: '/cars/models' });
    await expect(group.locator('.efs-entry')).toHaveCount(3);
    await settled(page);
    await page.locator('efs-files-word wa-select.efs-topic-kind').click();
    await kind('folder').click();
    await expect(group.locator('.efs-entry')).toHaveCount(1);
    await expect(group.locator('.efs-entry')).toContainText('pics');
    await settled(page);
    await chain.idle(500);
    chain.step('The word page models: its /cars/models group, filtered to Folders, shows pics');
  } finally {
    await chain.finish();
  }
});

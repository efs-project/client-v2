// Folder listings (folder operations, reads): the realm's shared root lists its folder, folders open
// from rows and stay in this tab's memory, files open by their permanent link, and nothing reads as
// empty unless the SDK proved it. Anvil account #0 (the root's owner and the default Lens) creates
// `notes/` with `todo.txt`, and #6 (the test wallet) creates `mine/`, from Node (live and record);
// the replay carries the result. The fixture seed already has `docs/` at the root.

import { AxeBuilder } from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import { expect, objectLink, preview } from './edit-support.ts';
import { booted, serveConfig, serveDeployment } from './support.ts';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const entries = (page: Page) => page.locator('efs-files-listing');
const row = (page: Page, name: string) =>
  entries(page).locator('.efs-entry', { has: page.locator('.efs-entry-name', { hasText: name }) });
const crumbs = (page: Page) => page.locator('wa-breadcrumb wa-breadcrumb-item');

/** `notes/todo.txt` under the realm's root, created by anvil #0 (live and record). */
async function withNotes(chain: TestChain): Promise<void> {
  await chain.actAs?.(0, async ({ files, root, lens, writer, efs, save }) => {
    const made = (await save(
      await files.planCreateFolder(efs, writer, { folder: root, name: 'notes', lens }),
    )) as { created: import('@efs/sdk/files').FolderRef };
    await save(
      await files.planCreateFile(efs, writer, {
        folder: made.created,
        name: 'todo.txt',
        content: new TextEncoder().encode('buy milk\n'),
        lens,
      }),
    );
    return { notes: made.created.subject as string };
  });
  // The test wallet's account (anvil #6), which isn't in the default Lens.
  await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save }) => {
    await save(await files.planCreateFolder(efs, writer, { folder: root, name: 'mine', lens }));
  });
  chain.step('anvil #0 creates notes/ and notes/todo.txt under the realm root; #6 creates mine/');
}

async function open(page: Page, chain: TestChain, route: string): Promise<void> {
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await page.goto(route);
  await booted(page);
}

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

test('the bare root becomes the realm root and lists its shared folder; folders open from rows, files by their link', async ({
  page,
}) => {
  const chain = await testChain('client-folders-list', 'notes/todo.txt under the realm root.');
  try {
    await withNotes(chain);
    await open(page, chain, './');
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/');
    chain.step('The bare root becomes the realm root, which lists its shared folder');

    // The root's own folders carry no label. A guest's Lens doesn't include #6, so mine/ isn't
    // shown; once #6 connects, the place Lens puts them first and their entry says "yours".
    await expect(row(page, 'docs')).toContainText('Folder');
    await expect(row(page, 'notes')).toContainText('Folder');
    await expect(row(page, 'notes').locator('.efs-entry-whose')).toHaveCount(0);
    await expect(row(page, 'mine')).toHaveCount(0);
    await page.locator('efs-wallet wa-button.efs-wallet-button').click();
    const wallet = page.locator('wa-dialog.efs-wallet-dialog');
    await expect(wallet).toContainText(/Your wallet is on .*Testnet/);
    await page.keyboard.press('Escape');
    await expect(row(page, 'mine').locator('.efs-entry-whose')).toHaveText('yours');
    await expect(row(page, 'notes').locator('.efs-entry-whose')).toHaveCount(0);
    chain.step('Connect as #6: the place Lens is #6, then the root owner, then the default');

    // Into the folder: the URL stays at the root (folders stay in this tab's memory).
    await row(page, 'notes').getByRole('button').click();
    await expect(row(page, 'todo.txt')).toContainText('File');
    await expect(crumbs(page)).toHaveCount(2);
    await expect(crumbs(page).last()).toContainText('notes');
    expect(new URL(page.url()).hash).toBe('#/r/testnet/');

    // A file opens by its permanent link, in the Preview; the listing stays where it was.
    await row(page, 'todo.txt').getByRole('link').click();
    await expect.poll(() => new URL(page.url()).hash).toContain('/~efs/o/');
    await expect(preview(page).locator('.efs-preview-text')).toHaveText('buy milk\n');
    await expect(row(page, 'todo.txt')).toBeVisible();

    // The kind filter inside notes/: folders only. The file is counted, never silently dropped,
    // and a page with everything filtered out is never "empty".
    await entries(page).locator('wa-select.efs-entries-filter').click();
    await page.locator('wa-option[value="folder"]').click();
    await expect(row(page, 'todo.txt')).toHaveCount(0);
    await expect(entries(page)).toContainText(/1\W+other entries hidden by the filter/);
    await expect(entries(page)).toContainText('Nothing to show here.');
    await expect(entries(page)).not.toContainText('This folder is empty');

    // The breadcrumb goes back to the root.
    await crumbs(page).first().click();
    await expect(row(page, 'notes')).toBeVisible();
    await expect(crumbs(page)).toHaveCount(1);
  } finally {
    await chain.finish();
  }
});

test('a file link opened fresh lists nothing until the person asks to browse; a reload goes back to the root', async ({
  page,
}) => {
  const chain = await testChain(
    'client-folders-fresh-link',
    'notes/todo.txt under the realm root.',
  );
  try {
    await withNotes(chain);
    await open(page, chain, `./#/r/testnet/${objectLink(chain.ids.file as string)}`);
    await expect(preview(page).locator('.efs-preview-text')).toBeVisible();
    await expect(entries(page)).toContainText('opened by its link');
    await expect(entries(page).locator('.efs-entry')).toHaveCount(0);
    chain.step('A file link: its Preview only, with no folder read');

    await entries(page).getByRole('button', { name: 'Browse the shared folder' }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/r/testnet/');
    await row(page, 'notes').getByRole('button').click();
    await expect(row(page, 'todo.txt')).toBeVisible();

    // Folders aren't in the URL until the SDK can tell a folder from a file by its link alone:
    // a reload is back at the root, never a folder read as "Confirmed not present".
    await page.reload();
    await booted(page);
    await expect(row(page, 'notes')).toBeVisible();
    await expect(page.getByText('Confirmed not present')).toHaveCount(0);
    chain.step('Browse, open notes/, reload: back at the root');
  } finally {
    await chain.finish();
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`320 px: the listing fits with no sideways scroll; keyboard opens a folder; axe clean (${scheme})`, async ({
    page,
  }) => {
    const chain = await testChain(
      `client-folders-narrow-${scheme}`,
      'notes/todo.txt under the realm root.',
    );
    try {
      await withNotes(chain);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page, chain, './#/r/testnet/');
      await page.getByRole('tab', { name: 'Entries' }).click();
      await expect(row(page, 'notes')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      await row(page, 'notes').getByRole('button').focus();
      await page.keyboard.press('Enter');
      await expect(row(page, 'todo.txt')).toBeVisible();
      const violations = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      );
      expect(violations).toEqual([]);
    } finally {
      await chain.finish();
    }
  });
}

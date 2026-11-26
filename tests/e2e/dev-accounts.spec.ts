// "EFS dev accounts": the local test chain's personas, offered in the wallet picker when the
// config is a local dev chain's (its RPC on this computer, with devAccounts). The chain signs for
// them: here the harness's chain (anvil #0 and #6, unlocked), answered from its own transcript on
// replay. Switching persona is an identity change: whose labels and own-entry actions follow it.
// Inside inbox/ (Adam Back's), so the default view's author (Satoshi, anvil #0) shows to Adam.

import { link } from '@efs/sdk';
import { test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect } from './edit-support.ts';
import { dialog, entries, row, seededRandom, send } from './folder-support.ts';
import { booted, serveConfig, serveDeployment, TEST_CONFIG } from './support.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

const SATOSHI = { name: 'Satoshi Nakamoto', address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' };
const ADAM = { name: 'Adam Back', address: '0x976ea74026e726554db657fa54763abd0c3a0aa9' };

/** The test network as `pnpm dev` would serve it: a local RPC and its dev accounts. */
const DEV_CONFIG = {
  ...TEST_CONFIG,
  networks: TEST_CONFIG.networks.map((n) => ({
    ...n,
    rpcs: [{ url: 'http://127.0.0.1:8545/', label: 'Local test chain' }],
    devAccounts: [SATOSHI, ADAM],
  })),
};

test('EFS dev accounts: pick a persona, save as it, switch persona (an identity change), save as the other', async ({
  page,
}) => {
  const chain = await testChain(
    'client-dev-accounts',
    'inbox/ by anvil #6 (Adam Back), opened by its link on a local dev config; Satoshi Nakamoto (anvil #0, the default view) then Adam Back each create a folder in it.',
  );
  const persona = (name: string) =>
    page.locator('wa-dialog.efs-dev-accounts button.efs-entry-open', { hasText: name });
  const walletButton = page.locator('efs-wallet wa-button.efs-wallet-button');
  try {
    // inbox/ by Adam Back (anvil #6), opened by its own link: a folder's view includes its creator.
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save }) => {
      const made = (await save(
        await files.planCreateFolder(efs, writer, { folder: root, name: 'inbox', lens }),
      )) as { created: { directory: string } };
      return { inbox: made.created.directory };
    });
    await seededRandom(page);
    await chain.attach(page);
    await serveConfig(page, DEV_CONFIG);
    await serveDeployment(page, chain.deployment);
    await page.goto(
      `./#/r/testnet/${link({ kind: 'object', subject: chain.ids.inbox as `0x${string}` })}`,
    );
    await booted(page);
    await expect(entries(page)).toContainText('This folder is empty.');

    // The dev accounts sit beside the installed wallet in the picker.
    await walletButton.click();
    const choose = page.locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-option', {
      hasText: 'EFS dev accounts',
    });
    await expect(choose).toBeVisible();
    await choose.click();
    await expect(page.locator('wa-dialog.efs-dev-accounts')).toContainText(
      'Dev account: local test chain only',
    );
    await persona(SATOSHI.name).click();
    await expect(walletButton).toContainText(SATOSHI.name);
    await page.keyboard.press('Escape');
    chain.step(
      "In inbox/ (Adam Back's): Connect with EFS dev accounts, labelled local-only; pick Satoshi",
    );

    await entries(page).locator('wa-button.efs-new-folder').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('satoshi-notes');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    await expect(row(page, 'satoshi-notes').locator('.efs-entry-whose')).toHaveText('yours');
    await expect(row(page, 'satoshi-notes').locator('wa-button.efs-entry-remove')).toHaveCount(1);
    // The folder's own rows are Adam Back's: named beside his address.
    chain.step('As Satoshi: New folder satoshi-notes, one send; it is yours');

    // Switch persona from the wallet panel: the chooser again, then Adam.
    await walletButton.click();
    const panel = page.locator('wa-dialog.efs-wallet-dialog');
    await expect(panel).toContainText('Dev account: local test chain only');
    await expect(panel.locator('.efs-wallet-persona-name')).toHaveText(SATOSHI.name);
    await panel.locator('wa-button.efs-wallet-switch-persona').click();
    await persona(ADAM.name).click();
    await expect(walletButton).toContainText(ADAM.name);
    await page.keyboard.press('Escape');
    // Satoshi's folder is now someone else's: named, not Adam's to change, and Adam (who owns
    // inbox/) may block it.
    const theirs = row(page, 'satoshi-notes');
    await expect(theirs.locator('.efs-entry-whose')).toHaveText(/Satoshi Nakamoto · 0xf39F…2266/);
    await expect(theirs.locator('wa-button.efs-entry-remove')).toHaveCount(0);
    await expect(theirs.locator('wa-button.efs-entry-block')).toHaveCount(1);
    chain.step(
      'Switch persona to Adam Back: satoshi-notes is "Satoshi Nakamoto · 0xf39F…2266\'s", blockable',
    );

    await entries(page).locator('wa-button.efs-new-folder').click();
    await dialog(page).locator('wa-input.efs-folder-name input').fill('adam-notes');
    await dialog(page).locator('wa-button.efs-folder-review').click();
    await send(page).click();
    await expect(dialog(page)).not.toHaveAttribute('open');
    // The folder's owner's own rows carry no label; his to change.
    await expect(row(page, 'adam-notes')).toBeVisible();
    await expect(row(page, 'adam-notes').locator('.efs-entry-whose')).toHaveCount(0);
    await expect(row(page, 'adam-notes').locator('wa-button.efs-entry-remove')).toHaveCount(1);
    await chain.idle(500);
    chain.step("As Adam: New folder adam-notes, one send; the owner's, his to change");
  } finally {
    await chain.finish();
  }
});

test('whose names, synonyms and hidden tags apply: the default curator for a guest, then "you" first; the chooser says who curates', async ({
  page,
}) => {
  const chain = await testChain(
    'client-dev-curators',
    'A tag page (/notes/todo) and a word page (notes) on a local dev config: as a guest, Satoshi Nakamoto (the default Lens); as Satoshi, you; as Adam Back, you, then Satoshi Nakamoto. The persona chooser marks Satoshi, and only Satoshi, as the default curator. At 320 px nothing scrolls sideways.',
  );
  const walletButton = page.locator('efs-wallet wa-button.efs-wallet-button');
  const chooser = page.locator('wa-dialog.efs-dev-accounts');
  const persona = (name: string) => chooser.locator('button.efs-entry-open', { hasText: name });
  const tagLine = page.locator('efs-files-topic .efs-lens-curators');
  try {
    await seededRandom(page);
    await chain.attach(page);
    await serveConfig(page, DEV_CONFIG);
    await serveDeployment(page, chain.deployment);
    await page.goto('./#/r/testnet/notes/todo');
    await booted(page);
    await expect(tagLine).toHaveText(
      /Names, synonyms and hidden tags from:\s+Satoshi Nakamoto\s*$/,
    );
    chain.step('A guest on /notes/todo: the default Lens, Satoshi Nakamoto');

    await walletButton.click();
    await page
      .locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-option', {
        hasText: 'EFS dev accounts',
      })
      .click();
    await expect(chooser.locator('li.efs-dev-account', { hasText: SATOSHI.name })).toContainText(
      "This chain's default curator: everyone sees what they name, join or hide.",
    );
    await expect(chooser.locator('.efs-dev-curator')).toHaveCount(1);
    await persona(SATOSHI.name).click();
    await expect(walletButton).toContainText(SATOSHI.name);
    await page.keyboard.press('Escape');
    await expect(tagLine).toHaveText(/from:\s+you\s*$/);
    chain.step('Connect as Satoshi (the chooser marks the default curator): from you');

    await walletButton.click();
    await page.locator('wa-dialog.efs-wallet-dialog wa-button.efs-wallet-switch-persona').click();
    await persona(ADAM.name).click();
    await expect(walletButton).toContainText(ADAM.name);
    await page.keyboard.press('Escape');
    await expect(tagLine).toHaveText(/from:\s+you, Satoshi Nakamoto\s*$/);
    chain.step('Switch to Adam Back: from you, Satoshi Nakamoto');

    // Narrow first, then the word page: its reads are sized to the view, so it reads once, at 320.
    await page.setViewportSize({ width: 320, height: 640 });
    // The tag page reads again for the narrow view first; the word page opens once that's done.
    await chain.idle(500);
    await page.evaluate(() => {
      location.hash = '#/r/testnet/notes';
    });
    const wordLine = page.locator('efs-files-word .efs-lens-curators');
    await expect(wordLine).toHaveText(
      /Names, synonyms and hidden tags from:\s+you, Satoshi Nakamoto\s*$/,
    );
    // Measured once the narrow layout has settled (the panes become tabs as it reflows).
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { message: 'the word page at 320 px' },
      )
      .toBeLessThanOrEqual(0);
    await chain.idle(500);
    chain.step('The word page notes says the same; at 320 px it fits');
  } finally {
    await chain.finish();
  }
});

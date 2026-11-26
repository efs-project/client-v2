import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { press } from './press.ts';
import { booted, type FakeWallet, installWallets, serveConfig, walletCalls } from './support.ts';

const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const FIXTURE: FakeWallet = {
  name: 'Test Wallet',
  rdns: 'test.wallet',
  account: ACCOUNT,
  chainId: 31337,
};
const dialog = (page: Page) => page.locator('wa-dialog.efs-wallet-dialog');
const connectButton = (page: Page) => page.locator('efs-wallet wa-button.efs-wallet-button');

test('nothing touches a wallet until the person clicks Connect', async ({ page }) => {
  await installWallets(page, [FIXTURE]);
  await serveConfig(page);
  await page.goto('./#/files');
  await booted(page);
  await page.waitForTimeout(300);
  expect(await walletCalls(page)).toEqual([]);
  await press(connectButton(page));
  await expect(connectButton(page)).toContainText('0x1234…5678');
  expect(await walletCalls(page)).toEqual([
    'eip6963:requestProvider',
    'test.wallet:eth_requestAccounts',
    'test.wallet:eth_chainId',
  ]);
  await expect(dialog(page)).toContainText(ACCOUNT);
  await expect(dialog(page)).toContainText(/on\W*Testnet/);
});

test('a wallet on another chain is flagged; switching is one explicit prompt', async ({ page }) => {
  await installWallets(page, [{ ...FIXTURE, chainId: 1 }]);
  await serveConfig(page);
  await page.goto('./#/files');
  await booted(page);
  await press(connectButton(page));
  await expect(connectButton(page)).toHaveAttribute('variant', 'warning');
  await expect(dialog(page)).toContainText('your wallet is on chain');
  await press(dialog(page).getByRole('button', { name: /Switch wallet to\W*Testnet/ }));
  await expect(dialog(page)).toContainText(/on\W*Testnet/);
  await expect(connectButton(page)).toHaveAttribute('variant', 'neutral');
  expect(
    (await walletCalls(page)).filter((c) => c.endsWith('wallet_switchEthereumChain')),
  ).toHaveLength(1);
});

test('with several wallets the person chooses one', async ({ page }) => {
  await installWallets(page, [
    FIXTURE,
    { ...FIXTURE, name: 'Second Wallet', rdns: 'second.wallet' },
  ]);
  await page.goto('./#/files');
  await booted(page);
  await press(connectButton(page));
  await expect(dialog(page)).toContainText('Choose a wallet');
  await press(dialog(page).getByRole('button', { name: 'Second Wallet' }));
  await expect(connectButton(page)).toContainText('0x1234…5678');
  expect(await walletCalls(page)).toContain('second.wallet:eth_requestAccounts');
  expect(await walletCalls(page)).not.toContain('test.wallet:eth_requestAccounts');
});

test('a declined connection and a missing wallet are reported plainly', async ({ page }) => {
  await installWallets(page, [{ ...FIXTURE, refuse: true }]);
  await page.goto('./#/files');
  await booted(page);
  await press(connectButton(page));
  await expect(dialog(page)).toContainText(/declined in\W*Test Wallet/);
  await expect(dialog(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('no wallet in the browser says so', async ({ page }) => {
  await page.goto('./#/files');
  await booted(page);
  await press(connectButton(page));
  await expect(dialog(page)).toContainText('No wallet was found in this browser');
});

test('disconnect forgets the wallet in this tab; the dialog passes axe', async ({ page }) => {
  await installWallets(page, [FIXTURE]);
  await serveConfig(page);
  await page.goto('./#/files');
  await booted(page);
  await press(connectButton(page));
  await expect(dialog(page)).toContainText(ACCOUNT);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await press(dialog(page).getByRole('button', { name: 'Disconnect' }));
  await expect(connectButton(page)).toContainText('Connect');
});

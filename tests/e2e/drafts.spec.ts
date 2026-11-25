// Unsaved edits across in-app navigation (slice H): leaving a file keeps the edit in this tab's
// memory, coming back reopens it, and it's discarded only after asking. A reload or closing the
// tab would lose it, so the page asks first while one exists. Reads are replayed; nothing here
// saves (the saving cases are in edit-drafts.spec.ts, against the chain).

import { AxeBuilder } from '@axe-core/playwright';
import { link } from '@efs/sdk';
import { type Page, test } from '@playwright/test';
import { editor, expect, preview, SEEDED } from './edit-support.ts';
import { booted, replayRpc, serveConfig, serveDeployment, transcript } from './support.ts';

const textarea = (page: Page) => page.locator('textarea.efs-edit-text');
const discardDialog = (page: Page) => page.locator('wa-dialog.efs-edit-discard');

async function openSeeded(page: Page) {
  await serveConfig(page);
  await serveDeployment(page);
  const replay = await replayRpc(page, ['pin-verified', 'open-inline']);
  const { ids } = transcript('open-inline');
  await page.goto(`./#/r/testnet/${link({ kind: 'object', subject: ids.file as `0x${string}` })}`);
  await booted(page);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
  return replay;
}

/** Another app route, then back: in-app navigation, never a page load. */
async function leaveAndComeBack(page: Page) {
  const loads: string[] = [];
  page.on('load', () => loads.push(page.url()));
  await page.evaluate(() => {
    location.hash = '#/files';
  });
  await expect(preview(page).locator('.efs-preview-text')).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await page.goBack();
  expect(loads).toEqual([]);
}

/** Whether leaving the page now would ask first (a cancelable beforeunload, as the browser sends). */
const leavingAsks = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  });

test('an unsaved edit survives leaving the file, and is discarded only after asking', async ({
  page,
}) => {
  // Keeping an edit writes signals from the editor's lifecycle: none of it may throw.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const replay = await openSeeded(page);
  await preview(page).locator('wa-button.efs-edit-start').click();
  await textarea(page).fill('Meeting moved to 11:00.\n');

  await leaveAndComeBack(page);
  // Back as it was left: the editor open on the same text, and said so.
  await expect(textarea(page)).toHaveValue('Meeting moved to 11:00.\n');
  await expect(editor(page).locator('.efs-edit-kept')).toHaveText('Your unsaved edit is back.');

  // Cancel asks; Keep editing (the default) keeps the edit and returns to the text.
  await editor(page).locator('wa-button.efs-edit-cancel').click();
  await expect(discardDialog(page)).toHaveAttribute('open', '');
  await expect(discardDialog(page)).toContainText('Discard your edit?');
  await expect(discardDialog(page).locator('wa-button.efs-edit-keep')).toBeFocused();
  await discardDialog(page).locator('wa-button.efs-edit-keep').click();
  await expect(discardDialog(page)).not.toHaveAttribute('open');
  await expect(textarea(page)).toBeFocused();
  await expect(textarea(page)).toHaveValue('Meeting moved to 11:00.\n');

  // Escape keeps it too.
  await editor(page).locator('wa-button.efs-edit-cancel').click();
  await expect(discardDialog(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(discardDialog(page)).not.toHaveAttribute('open');
  await expect(textarea(page)).toHaveValue('Meeting moved to 11:00.\n');

  // Discard: the file as it is, focus on Edit, and nothing comes back later.
  await editor(page).locator('wa-button.efs-edit-cancel').click();
  await discardDialog(page).locator('wa-button.efs-edit-discard-yes').click();
  await expect(editor(page)).toHaveCount(0);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
  await expect(preview(page).locator('wa-button.efs-edit-start')).toBeFocused();
  await leaveAndComeBack(page);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
  await expect(editor(page)).toHaveCount(0);
  expect(replay.misses).toEqual([]);
  expect(errors).toEqual([]);
});

test('an edit with no changes closes at once and keeps nothing', async ({ page }) => {
  await openSeeded(page);
  await preview(page).locator('wa-button.efs-edit-start').click();
  // Changed, then changed back: nothing to keep.
  await textarea(page).fill('Something else.\n');
  await textarea(page).fill(SEEDED);
  expect(await leavingAsks(page)).toBe(false);
  await editor(page).locator('wa-button.efs-edit-cancel').click();
  await expect(editor(page)).toHaveCount(0);
  await expect(discardDialog(page)).toHaveCount(0);
  await leaveAndComeBack(page);
  await expect(preview(page).locator('.efs-preview-text')).toHaveText(SEEDED);
  await expect(editor(page)).toHaveCount(0);
});

test('leaving the page asks first only while an edit is unsaved', async ({ page }) => {
  await openSeeded(page);
  expect(await leavingAsks(page)).toBe(false);
  await preview(page).locator('wa-button.efs-edit-start').click();
  await textarea(page).fill('Unsaved.\n');
  expect(await leavingAsks(page)).toBe(true);
  // Still unsaved while another app is open: it's kept, so leaving still asks.
  await page.evaluate(() => {
    location.hash = '#/files';
  });
  await expect(editor(page)).toHaveCount(0);
  expect(await leavingAsks(page)).toBe(true);
  await page.goBack();
  await editor(page).locator('wa-button.efs-edit-cancel').click();
  await discardDialog(page).locator('wa-button.efs-edit-discard-yes').click();
  await expect(editor(page)).toHaveCount(0);
  expect(await leavingAsks(page)).toBe(false);
});

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );

for (const scheme of ['light', 'dark'] as const) {
  test(`"Discard your edit?" by keyboard alone; focus kept; axe clean (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openSeeded(page);
    await preview(page).locator('wa-button.efs-edit-start').click();
    await expect(textarea(page)).toBeFocused();
    await page.keyboard.type('Typed.');
    const cancel = editor(page).locator('wa-button.efs-edit-cancel');
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(discardDialog(page)).toHaveAttribute('open', '');
    // Enter on the focused default keeps the edit.
    await expect(discardDialog(page).locator('wa-button.efs-edit-keep')).toBeFocused();
    expect(await axe(page), 'discard dialog').toEqual([]);
    await page.keyboard.press('Enter');
    await expect(textarea(page)).toBeFocused();
    // Discard takes a deliberate Tab to reach.
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(discardDialog(page).locator('wa-button.efs-edit-keep')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(discardDialog(page).locator('wa-button.efs-edit-discard-yes')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(preview(page).locator('wa-button.efs-edit-start')).toBeFocused();
    expect(await axe(page), 'after discard').toEqual([]);
  });
}

test('at 320 px the kept-edit note and "Discard your edit?" fit without scrolling sideways', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openSeeded(page);
  // Narrow: the panes are tabs, and the Preview is one of them.
  await page.getByRole('tab', { name: 'Preview' }).click();
  await preview(page).locator('wa-button.efs-edit-start').click();
  await textarea(page).fill('Meeting moved to 11:00.\n');
  await leaveAndComeBack(page);
  await expect(editor(page).locator('.efs-edit-kept')).toBeVisible();
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow(), 'kept note').toBeLessThanOrEqual(0);
  await editor(page).locator('wa-button.efs-edit-cancel').click();
  await expect(discardDialog(page)).toHaveAttribute('open', '');
  await expect(discardDialog(page).locator('wa-button.efs-edit-keep')).toBeFocused();
  expect(await overflow(), 'discard dialog').toBeLessThanOrEqual(0);
  // The dialog fades in (Web Awesome animates it under a `show` class): picture it once shown.
  await page.waitForFunction(
    () =>
      document
        .querySelector('wa-dialog.efs-edit-discard')
        ?.shadowRoot?.querySelector('dialog')
        ?.classList.contains('show') === false,
  );
  const shot = await page.screenshot();
  await info.attach('discard-dialog-320.png', { body: shot, contentType: 'image/png' });
  if (process.env.EFS_SHOT_DIR) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${process.env.EFS_SHOT_DIR}/discard-320-${info.project.name}.png`, shot);
  }
});

test('closing the tab with an unsaved edit shows the browser\'s "leave site?" prompt @chromium-only', async ({
  page,
}) => {
  await openSeeded(page);
  await preview(page).locator('wa-button.efs-edit-start').click();
  // Typed by the person: the browser asks only after a real interaction with the page.
  await textarea(page).click();
  await page.keyboard.type('x');
  const asked = new Promise<string>((resolve) =>
    page.once('dialog', (dialog) => {
      resolve(dialog.type());
      void dialog.accept();
    }),
  );
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe('beforeunload');
});

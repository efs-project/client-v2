// Screenshots of the location bar's walked names for review (PM, 2026-11-27): a name an older
// entry could still outrank ("?", complete: false) with "named by", a loop, and names that lead
// elsewhere on the way down; light and dark, 320 px and desktop.
//
// Not a test: skipped unless EFS_SHOTS is set, on a live fixture chain in Chromium:
//   EFS_SHOTS=1 EFS_CHAIN=live pnpm exec playwright test tests/e2e/trail-shots --project=chromium
// The PNGs go to shots/trail/ (gitignored), named <view>-<mode>-<width>.png.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FolderRef } from '@efs/sdk/files';
import { type Page, test } from '@playwright/test';
import { CHAIN_MODE, testChain } from './chain.ts';
import { expect, objectLink } from './edit-support.ts';
import { entries, openRoot } from './folder-support.ts';

test.skip(
  !process.env.EFS_SHOTS || CHAIN_MODE !== 'live',
  'screenshots only: EFS_SHOTS=1 EFS_CHAIN=live',
);

const OUT = fileURLToPath(new URL('../../shots/trail/', import.meta.url));
const SIZES = [
  ['desktop', { width: 1440, height: 900 }],
  ['320', { width: 320, height: 720 }],
] as const;
const MODES = ['light', 'dark'] as const;

async function openByLink(page: Page, directory: string): Promise<void> {
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `#/r/testnet/${objectLink(directory)}`,
  );
}

test('walked-name screenshots: "?" and "named by", a loop, elsewhere @chromium-only', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const chain = await testChain('client-trail-shots', 'Screenshots only, never recorded.');
  try {
    // #0 makes guides/ at the root, then puts it in the root under 16 more names: its creator's
    // newest name (g16) is in a scan that didn't reach the list's end, so it isn't settled.
    await chain.actAs?.(0, async ({ files, root, lens, writer, efs, save }) => {
      const guides = (
        (await save(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'guides', lens }),
        )) as { created: FolderRef }
      ).created;
      const { planFolderEntry } = await import('@efs/sdk/testing');
      for (let i = 1; i <= 16; i++) {
        await save(
          await planFolderEntry(efs, writer, { folder: root, name: `g${i}`, target: guides }),
        );
      }
      return { guides: guides.directory as string };
    });
    // The loop: #6 makes lx/ and lx/ly/, and puts lx2 (→ lx/) in ly/.
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save }) => {
      const made = async (parent: FolderRef, name: string) =>
        (
          (await save(
            await files.planCreateFolder(efs, writer, { folder: parent, name, lens }),
          )) as { created: FolderRef }
        ).created;
      const lx = await made(root, 'lx');
      const ly = await made(lx, 'ly');
      const { planFolderEntry } = await import('@efs/sdk/testing');
      await save(await planFolderEntry(efs, writer, { folder: ly, name: 'lx2', target: lx }));
      return { ly: ly.directory as string };
    });
    // Elsewhere: #0 makes ea/eb/; #6 makes ez/ and puts its own eb (→ ez/) in ea/.
    await chain.actAs?.(0, async ({ files, root, lens, writer, efs, save }) => {
      const ea = (
        (await save(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'ea', lens }),
        )) as { created: FolderRef }
      ).created;
      const eb = (
        (await save(
          await files.planCreateFolder(efs, writer, { folder: ea, name: 'eb', lens }),
        )) as { created: FolderRef }
      ).created;
      return { ea: ea.directory as string, eb: eb.directory as string };
    });
    await chain.actAs?.(6, async ({ files, root, lens, writer, efs, save }) => {
      const ez = (
        (await save(
          await files.planCreateFolder(efs, writer, { folder: root, name: 'ez', lens }),
        )) as { created: FolderRef }
      ).created;
      const { planFolderEntry } = await import('@efs/sdk/testing');
      await save(
        await planFolderEntry(efs, writer, {
          folder: { kind: 'folder', directory: chain.ids.ea as never },
          name: 'eb',
          target: ez,
        }),
      );
    });
    mkdirSync(OUT, { recursive: true });
    await openRoot(page, chain);
    await expect(page.locator('wa-dialog.efs-wallet-dialog')).not.toHaveAttribute('open');
    const bar = page.locator('efs-files-view wa-breadcrumb-item');
    const views = [
      ['unsettled', chain.ids.guides as string, '?'],
      ['loop', chain.ids.ly as string, 'Loop'],
      ['elsewhere', chain.ids.eb as string, 'lead to a different folder'],
    ] as const;
    for (const mode of MODES) {
      await page.emulateMedia({ colorScheme: mode });
      for (const [size, viewport] of SIZES) {
        await page.setViewportSize(viewport);
        for (const [view, directory, says] of views) {
          await openByLink(page, directory);
          await expect(page.locator('efs-files-view wa-breadcrumb')).toContainText(says);
          await expect(entries(page)).toContainText(/This folder is empty|lx2|ly/);
          await expect(page.locator('efs-files-tag-picker[data-reading]')).toHaveCount(0);
          await page.screenshot({ path: `${OUT}${view}-${mode}-${size}.png` });
          // Back to the root between views, so each is a fresh walk from its own link.
          await page.evaluate(() => {
            location.hash = '#/r/testnet/';
          });
          await expect(bar).toHaveCount(1);
        }
      }
    }
  } finally {
    await chain.finish();
  }
});

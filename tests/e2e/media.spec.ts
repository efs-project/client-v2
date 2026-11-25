// Slice G: the Preview shows a file's VERIFIED bytes as an image, audio or video by what the bytes
// are (their own signature), from blob: URLs made only after verification; SVG only as an image;
// anything it can't show says so and offers Save a copy. The file's author (anvil #0, first in the
// default Lens) writes each case's bytes into the seeded readme from Node (live and record); the
// replay carries the result.

import { expect, type Page, test } from '@playwright/test';
import { CHAIN_MODE, type TestChain, testChain } from './chain.ts';
import { objectLink, preview } from './edit-support.ts';
import { booted, serveConfig, serveDeployment } from './support.ts';

test.skip(
  ({ browserName }) => CHAIN_MODE !== 'replay' && browserName !== 'chromium',
  'the live chain runs in Chromium only',
);

const fromBase64 = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));
/** A 1×1 PNG. */
const PNG = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);
/** A 10×10 SVG that would set a flag if its script ever ran. */
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="teal"/><script>parent.__efsSvgRan = true; window.__efsSvgRan = true</script></svg>',
);
/** 0.1 s of 8 kHz mono 8-bit silence, as WAV. */
function wav(): Uint8Array {
  const samples = 800;
  const b = Buffer.alloc(44 + samples, 0x80);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples, 40);
  return new Uint8Array(b);
}
/** A WebM signature with nothing playable after it. */
const BROKEN_WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02]);

async function openWith(page: Page, chain: TestChain, bytes: Uint8Array): Promise<void> {
  await chain.editAs?.(0, bytes);
  chain.step("The readme's author saves new bytes into it");
  await chain.attach(page);
  await serveConfig(page);
  await serveDeployment(page, chain.deployment);
  await page.goto(`./#/r/testnet/${objectLink(chain.ids.file as string)}`);
  await booted(page);
  chain.step('Open the readme by object link: pin, openFile, readBytes');
}

test('a verified PNG shows as an image from a blob: URL; it is not editable', async ({ page }) => {
  const chain = await testChain('client-media-png', 'The readme holds a 1×1 PNG.');
  try {
    await openWith(page, chain, PNG);
    const img = preview(page).locator('img.efs-preview-media');
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
    await expect(preview(page).locator('wa-button.efs-edit-start')).toHaveCount(0);
    await expect(preview(page).locator('wa-button', { hasText: 'Save a copy' })).toBeVisible();
  } finally {
    await chain.finish();
  }
});

test('an SVG shows only as an image, from a data: URL: its script never runs, nothing is inlined, no blob: is made', async ({
  page,
}) => {
  const chain = await testChain('client-media-svg', 'The readme holds an SVG with a script.');
  try {
    // Records the type of every blob: URL the page makes.
    await page.addInitScript(() => {
      const types: string[] = [];
      Object.defineProperty(window, '__efsBlobTypes', { value: types });
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (object: Blob | MediaSource) => {
        types.push(object instanceof Blob ? object.type : 'media-source');
        return create(object);
      };
    });
    await openWith(page, chain, SVG);
    const img = preview(page).locator('img.efs-preview-media');
    // data:, never blob: (a blob: URL has the app's origin if opened in a new tab).
    await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
    expect(
      await page.evaluate(() => (window as unknown as { __efsBlobTypes: string[] }).__efsBlobTypes),
    ).not.toContain('image/svg+xml');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(10);
    await expect(preview(page).locator('svg rect')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __efsSvgRan?: boolean }).__efsSvgRan)).toBe(
      undefined,
    );
  } finally {
    await chain.finish();
  }
});

test('verified WAV plays in the native audio player', async ({ page }) => {
  const chain = await testChain('client-media-wav', 'The readme holds 0.1 s of WAV silence.');
  try {
    await openWith(page, chain, wav());
    const audio = preview(page).locator('audio.efs-preview-media');
    await expect(audio).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration))
      .toBeGreaterThan(0);
  } finally {
    await chain.finish();
  }
});

test("media the browser can't decode says so and offers Save a copy", async ({ page }) => {
  const chain = await testChain(
    'client-media-broken',
    'The readme holds a WebM header and nothing playable.',
  );
  try {
    await openWith(page, chain, BROKEN_WEBM);
    await expect(preview(page)).toContainText("This browser couldn't show or play this file.");
    await expect(preview(page).locator('wa-button', { hasText: 'Save a copy' })).toBeVisible();
  } finally {
    await chain.finish();
  }
});

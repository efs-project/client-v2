import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { type Efs, fromJson } from '@efs/sdk';
import type { ByteRangeResult, OpenResult } from '@efs/sdk/files';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyContent,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_CHARS,
  type PreviewReads,
  type PreviewState,
  runPreview,
} from './preview-model.ts';

// The SDK's recorded results: exactly what it returned against a live fixture chain.
const FIXTURES = `${dirname(createRequire(import.meta.url).resolve('@efs/sdk/package.json'))}/fixtures/`;
function fixture<T>(name: string): T {
  const { result } = JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as {
    result: unknown;
  };
  return fromJson<T>(JSON.stringify(result));
}

const efs = {} as Efs;
const target = { kind: 'file', subject: `0x${'11'.repeat(32)}` } as const;

function reads(open: OpenResult, bytes?: ByteRangeResult) {
  return {
    openFile: vi.fn(async () => open),
    readBytes: vi.fn(async () => {
      if (!bytes) throw new Error('readBytes must not be called');
      return bytes;
    }),
  } satisfies PreviewReads;
}

async function run(r: PreviewReads, force = false, signal = new AbortController().signal) {
  const states: PreviewState[] = [];
  await runPreview(r, efs, target, signal, (s) => states.push(s), { force });
  return states;
}

describe('runPreview against the SDK fixtures', () => {
  it('shows verified inline bytes as text', async () => {
    const states = await run(reads(fixture('open-inline'), fixture('bytes-inline-verified')));
    expect(states.map((s) => s.phase)).toEqual(['opening', 'reading', 'read']);
    const last = states.at(-1);
    expect(last).toMatchObject({ phase: 'read', bytes: { grade: 'VERIFIED' } });
    expect(last?.phase === 'read' && last.content).toEqual({
      kind: 'text',
      text: 'Meeting at 10:00.\n',
      truncated: false,
    });
  });

  it('keeps "proven absent" and "couldn\'t tell" apart, and shows neither as empty', async () => {
    const absent = await run(reads(fixture('open-absent')));
    const unknown = await run(reads(fixture('open-unknown')));
    expect(absent.at(-1)).toMatchObject({
      phase: 'not-present',
      open: { status: 'ABSENT_PROVEN' },
    });
    expect(unknown.at(-1)).toMatchObject({
      phase: 'not-present',
      open: { status: 'UNKNOWN', reason: { retry: 'transient' } },
    });
  });

  it('shows web3:// contents verified through the RPC endpoints', async () => {
    const states = await run(reads(fixture('open-external'), fixture('bytes-web3-verified')));
    const last = states.at(-1);
    expect(last).toMatchObject({ phase: 'read', bytes: { grade: 'VERIFIED' } });
    expect(last?.phase === 'read' && last.content?.kind).toBeDefined();
  });

  for (const [name, grade] of [
    ['bytes-external-mismatch', 'MISMATCH'],
    ['bytes-external-unavailable', 'UNAVAILABLE'],
    ['bytes-web3-no-contract', 'UNAVAILABLE'],
    ['bytes-external-unsupported', 'UNSUPPORTED_LOCATOR'],
    ['bytes-policy-blocked', 'POLICY_BLOCKED'],
  ] as const) {
    it(`never shows contents for ${grade} bytes`, async () => {
      const states = await run(reads(fixture('open-external'), fixture(name)));
      const last = states.at(-1);
      expect(last).toMatchObject({ phase: 'read', bytes: { grade } });
      expect(last?.phase === 'read' && last.content).toBeUndefined();
    });
  }

  it('waits for an explicit load above the preview limit', async () => {
    const open = fixture<Extract<OpenResult, { status: 'PRESENT' }>>('open-span');
    const big = { ...open, file: { ...open.file, size: PREVIEW_MAX_BYTES + 1n } };
    const r = reads(big, fixture('bytes-inline-verified'));
    expect((await run(r)).at(-1)).toMatchObject({ phase: 'too-large' });
    expect(r.readBytes).not.toHaveBeenCalled();
    expect((await run(r, true)).at(-1)).toMatchObject({ phase: 'read' });
    expect(r.readBytes).toHaveBeenCalledTimes(1);
  });

  it('stops quietly when the target or session changes mid-read', async () => {
    const controller = new AbortController();
    const r = reads(fixture('open-inline'), fixture('bytes-inline-verified'));
    r.openFile.mockImplementation(async () => {
      controller.abort();
      return fixture('open-inline');
    });
    const states = await run(r, false, controller.signal);
    expect(states.map((s) => s.phase)).toEqual(['opening']);
    expect(r.readBytes).not.toHaveBeenCalled();
  });
});

describe('runPreview publisher origins', () => {
  it('a blocked publisher location names the origin that one click could allow', async () => {
    const states = await run(reads(fixture('open-external'), fixture('bytes-external-blocked')));
    const last = states.at(-1);
    expect(last).toMatchObject({
      phase: 'read',
      bytes: { grade: 'POLICY_BLOCKED', blockedOrigins: ['https://files.example'] },
    });
    expect(last?.phase === 'read' && last.content).toBeUndefined();
  });

  it('a one-time load passes exactly that origin to that read, and shows verified bytes', async () => {
    const r = reads(fixture('open-external'), fixture('bytes-external-allowed-once'));
    const states: PreviewState[] = [];
    await runPreview(r, efs, target, new AbortController().signal, (s) => states.push(s), {
      allowOrigins: ['https://files.example'],
    });
    expect((r.readBytes.mock.calls[0] as unknown[] | undefined)?.[2]).toMatchObject({
      allowOrigins: ['https://files.example'],
    });
    const last = states.at(-1);
    expect(last?.phase === 'read' && last.content).toEqual({
      kind: 'text',
      text: 'hello from a gateway\n',
      truncated: false,
    });
  });

  it('never sends allowOrigins unless asked', async () => {
    const r = reads(fixture('open-inline'), fixture('bytes-inline-verified'));
    await run(r);
    expect((r.readBytes.mock.calls[0] as unknown[] | undefined)?.[2]).not.toHaveProperty(
      'allowOrigins',
    );
  });
});

describe('runPreview Lens', () => {
  it("resolves the head under a shared link's Lens when one is given", async () => {
    const r = reads(fixture('open-absent'));
    const lens = { principals: [`0x${'00'.repeat(12)}${'12'.repeat(20)}`] } as never;
    await runPreview(r, efs, target, new AbortController().signal, () => {}, { lens });
    expect((r.openFile.mock.calls[0] as unknown[] | undefined)?.[2]).toMatchObject({ lens });
  });
});

describe('classifyContent', () => {
  it('media comes first: images by signature, and SVG (text) only as an image', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(classifyContent(png)).toEqual({
      kind: 'media',
      media: { kind: 'image', mime: 'image/png' },
    });
    expect(classifyContent(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual({
      kind: 'media',
      media: { kind: 'image', mime: 'image/svg+xml' },
    });
  });

  const utf8 = (s: string) => new TextEncoder().encode(s);
  it('decodes UTF-8 text, including non-ASCII', () => {
    expect(classifyContent(utf8('héllo ✓'))).toEqual({
      kind: 'text',
      text: 'héllo ✓',
      truncated: false,
    });
  });
  it('treats NUL bytes and invalid UTF-8 as binary rather than guessing', () => {
    expect(classifyContent(new Uint8Array([0x68, 0x00, 0x69]))).toEqual({ kind: 'binary' });
    expect(classifyContent(new Uint8Array([0xff, 0xfe, 0x41]))).toEqual({ kind: 'binary' });
  });
  it('cuts very long text for display and says so', () => {
    const content = classifyContent(utf8('a'.repeat(PREVIEW_MAX_CHARS + 5)));
    expect(content).toMatchObject({ kind: 'text', truncated: true });
    expect(content.kind === 'text' && content.text.length).toBe(PREVIEW_MAX_CHARS);
  });
});

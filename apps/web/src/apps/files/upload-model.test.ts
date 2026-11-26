import { describe, expect, it } from 'vitest';
import { declaredMediaType, uploadMediaType } from './upload-model.ts';

// The SDK's check, as far as these cases need it: lowercase the type, refuse a bad grammar.
const normalize = (input: string) =>
  /^[a-z0-9.+-]+\/[a-z0-9.+-]+(;.*)?$/i.test(input)
    ? ({ ok: true, mediaType: input.replace(/^[^;]*/, (m) => m.toLowerCase()) } as const)
    : ({ ok: false, code: 2, reason: 'a bad type name' } as const);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

describe('uploadMediaType: from the bytes, never from the name alone', () => {
  it("a known signature wins over the browser's type (taken from the extension)", () => {
    expect(uploadMediaType(PNG, 'text/plain', normalize)).toEqual({
      mediaType: 'image/png',
      from: 'signature',
    });
  });
  it("text keeps the browser's type unless it claims media or nothing; else text/plain", () => {
    expect(uploadMediaType(text('# hi\n'), 'text/markdown', normalize)).toEqual({
      mediaType: 'text/markdown',
      from: 'text',
    });
    expect(uploadMediaType(text('{}'), 'application/json', normalize).mediaType).toBe(
      'application/json',
    );
    for (const claimed of ['image/png', 'video/mp4', 'application/octet-stream', '']) {
      expect(uploadMediaType(text('plain words'), claimed, normalize).mediaType).toBe('text/plain');
    }
  });
  it('unknown binary stores no type; a type the chain refuses is dropped, and says why', () => {
    expect(uploadMediaType(new Uint8Array([0, 1, 2, 3]), 'application/pdf', normalize)).toEqual({
      mediaType: '',
      from: 'unknown',
    });
    expect(uploadMediaType(text('x'), 'Text/Weird Type', normalize)).toEqual({
      mediaType: '',
      from: 'unknown',
      refused: 'a bad type name',
    });
    expect(uploadMediaType(text('x'), 'TEXT/Markdown', normalize).mediaType).toBe('text/markdown');
  });
});

describe('a file too large to read here: its type as the device reports it', () => {
  const normalize = (input: string) =>
    /^[a-z]+\/[a-z0-9.+-]+$/i.test(input)
      ? ({ ok: true, mediaType: input.toLowerCase() } as const)
      : ({ ok: false, code: 1, reason: 'grammar' } as const);
  it('keeps what the grammar admits; drops octet-stream, nothing, and what it refuses', () => {
    expect(declaredMediaType('video/MP4', normalize)).toBe('video/mp4');
    expect(declaredMediaType('', normalize)).toBe('');
    expect(declaredMediaType('application/octet-stream', normalize)).toBe('');
    expect(declaredMediaType('not a type', normalize)).toBe('');
  });
});

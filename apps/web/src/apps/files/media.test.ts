import { describe, expect, it } from 'vitest';
import { agrees, dataUrl, sniffMedia } from './media.ts';

const bytes = (...parts: (string | number[])[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const pad = (n: number) => new Array<number>(n).fill(0);

describe('sniffMedia', () => {
  it('recognizes images by signature', () => {
    expect(sniffMedia(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pad(8)))).toEqual({
      kind: 'image',
      mime: 'image/png',
    });
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffMedia(bytes('GIF89a', pad(4)))?.mime).toBe('image/gif');
    expect(sniffMedia(bytes('RIFF', pad(4), 'WEBP'))?.mime).toBe('image/webp');
    expect(sniffMedia(bytes(pad(4), 'ftypavif', pad(4)))?.mime).toBe('image/avif');
  });

  it('recognizes audio and video by signature', () => {
    expect(sniffMedia(bytes('RIFF', pad(4), 'WAVE'))).toEqual({ kind: 'audio', mime: 'audio/wav' });
    expect(sniffMedia(bytes('fLaC', pad(4)))?.mime).toBe('audio/flac');
    expect(sniffMedia(bytes('OggS', pad(4)))?.mime).toBe('audio/ogg');
    expect(sniffMedia(bytes('ID3', pad(4)))?.mime).toBe('audio/mpeg');
    expect(sniffMedia(bytes([0xff, 0xfb, 0x90, 0x00]))?.mime).toBe('audio/mpeg');
    expect(sniffMedia(bytes(pad(4), 'ftypM4A ', pad(4)))?.mime).toBe('audio/mp4');
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3], pad(4)))).toEqual({
      kind: 'video',
      mime: 'video/webm',
    });
    expect(sniffMedia(bytes(pad(4), 'ftypisom', pad(4)))?.mime).toBe('video/mp4');
    expect(sniffMedia(bytes(pad(4), 'ftypqt  ', pad(4)))?.mime).toBe('video/quicktime');
  });

  it('SVG is an image (shown only through <img>), found past an XML declaration and comments', () => {
    const svg = '<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(sniffMedia(new TextEncoder().encode(svg))).toEqual({
      kind: 'image',
      mime: 'image/svg+xml',
    });
    expect(sniffMedia(new TextEncoder().encode('﻿  <svg viewBox="0 0 1 1"></svg>'))?.mime).toBe(
      'image/svg+xml',
    );
  });

  it('text, HTML and unknown bytes are not media', () => {
    expect(sniffMedia(new TextEncoder().encode('Meeting at 10:00.\n'))).toBeUndefined();
    expect(sniffMedia(new TextEncoder().encode('<html><svg></svg></html>'))).toBeUndefined();
    expect(sniffMedia(new TextEncoder().encode('<svgfoo>'))).toBeUndefined();
    expect(sniffMedia(bytes([0x00, 0x01, 0x02]))).toBeUndefined();
    expect(sniffMedia(new Uint8Array())).toBeUndefined();
  });
});

describe('agrees', () => {
  it('a declared type must name the same kind as the bytes', () => {
    expect(agrees(undefined, { kind: 'image', mime: 'image/png' })).toBe(true);
    expect(agrees('image/jpeg', { kind: 'image', mime: 'image/png' })).toBe(true);
    expect(agrees('video/mp4', { kind: 'image', mime: 'image/png' })).toBe(false);
    expect(agrees('text/plain', { kind: 'audio', mime: 'audio/wav' })).toBe(false);
  });
});

describe('dataUrl', () => {
  it('base64-encodes the bytes, also past one chunk', () => {
    expect(dataUrl('image/svg+xml', new TextEncoder().encode('<svg/>'))).toBe(
      `data:image/svg+xml;base64,${btoa('<svg/>')}`,
    );
    const big = new Uint8Array(100_000).fill(65);
    expect(dataUrl('image/svg+xml', big)).toBe(
      `data:image/svg+xml;base64,${btoa('A'.repeat(100_000))}`,
    );
  });
});

// Which native element can show a file's VERIFIED bytes, decided from the bytes' own signature.
// Pure, so every format is tested.
//
// The bytes decide, not a name or a declared type: a file's media type is a separate fact from
// its content (system constitution), and a wrong declared type must not make the browser parse
// bytes as something they aren't. When the SDK exposes the declared files-content/1 media type,
// it becomes a hint that must agree with this (see `agrees`).
//
// SVG is an image here and only ever an image: shown through <img>, where scripts don't run
// and nothing external loads; never inline in the page, never as a document.

export type MediaKind =
  | { readonly kind: 'image'; readonly mime: string }
  | { readonly kind: 'audio'; readonly mime: string }
  | { readonly kind: 'video'; readonly mime: string };

/** The largest file shown as each kind (bytes): bigger ones offer "Save a copy" instead. */
export const MEDIA_MAX_BYTES: Readonly<Record<MediaKind['kind'], number>> = {
  image: 25 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

/**
 * SVG is shown from a data: URL, never a blob: URL. A blob: URL carries this app's origin, so
 * "Open image in new tab" would make the SVG a top-level document on our origin, one CSP
 * inheritance rule away from its scripts reaching the app's storage. A data: URL can't be opened
 * as a top-level page, and its document would have an opaque origin anyway. Smaller cap, since
 * the bytes are base64-encoded into the page.
 */
export const SVG_MAX_BYTES = 5 * 1024 * 1024;
export const SVG_MIME = 'image/svg+xml';

/** A data: URL of `bytes` (base64), built in chunks so large inputs don't overflow the stack. */
export function dataUrl(mime: string, bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** An ISO-BMFF ("ftyp") file's major brand, if it is one. */
function ftypBrand(b: Uint8Array): string | undefined {
  return b.length >= 12 && ascii(b, 4, 8) === 'ftyp' ? ascii(b, 8, 12) : undefined;
}

/** SVG: text that, after a BOM, whitespace, an XML declaration, comments or a doctype, opens <svg. */
function isSvg(b: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, 4096));
  } catch {
    return false;
  }
  const head = text
    .replace(/^﻿/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/, '')
    .replace(/^\s*<!DOCTYPE\s+svg[^>]*>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/, '')
    .trimStart();
  return /^<svg[\s>]/i.test(head);
}

/** The media kind the verified bytes are, or undefined (text and everything else). */
export function sniffMedia(b: Uint8Array): MediaKind | undefined {
  // Images.
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mime: 'image/png' };
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') {
    return { kind: 'image', mime: 'image/gif' };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    return { kind: 'image', mime: 'image/webp' };
  }
  const brand = ftypBrand(b);
  if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif' };
  // Audio.
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') {
    return { kind: 'audio', mime: 'audio/wav' };
  }
  if (ascii(b, 0, 4) === 'fLaC') return { kind: 'audio', mime: 'audio/flac' };
  if (ascii(b, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg' };
  if (
    ascii(b, 0, 3) === 'ID3' ||
    (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe6) === 0xe2)
  ) {
    return { kind: 'audio', mime: 'audio/mpeg' };
  }
  if (brand === 'M4A ') return { kind: 'audio', mime: 'audio/mp4' };
  // Video.
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm' };
  if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
  if (brand !== undefined && /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |mmp4)$/.test(brand)) {
    return { kind: 'video', mime: 'video/mp4' };
  }
  // Last: SVG is text, so it's checked after every binary signature.
  if (isSvg(b)) return { kind: 'image', mime: 'image/svg+xml' };
  return undefined;
}

/**
 * Whether a declared media type (the SDK's files-content/1 media, when it exposes one) agrees with
 * what the bytes are. A disagreement means "can't preview this type", never trusting either.
 */
export function agrees(declared: string | undefined, sniffed: MediaKind): boolean {
  if (!declared) return true;
  const top = declared.split('/')[0]?.toLowerCase();
  return top === sniffed.kind;
}

// Upload: what a file's declared media type is, from its bytes. Pure, so each rule is tested.
//
// - A known byte signature (media.ts) decides, whatever the name or the browser says: a PNG
//   named "notes.txt" is image/png.
// - Text (valid UTF-8, no NUL) keeps the browser's type when it says something textual
//   ("text/markdown", "application/json"); a type claiming media or nothing becomes text/plain.
// - Anything else is unknown: no type is stored (the chain admits "" as unknown).
// - Every candidate goes through the SDK's normalizeMediaType (injected): its exact string is
//   stored; a type the chain would refuse is dropped (stored as unknown, said as "isn't
//   recognized"), with the chain's reason returned for diagnostics.
// The type is a hint for readers, never proof: the Preview checks bytes against it again.

import type { MediaTypeCheck } from '@efs/sdk/files';
import { classifyContent } from './preview-model.ts';

export interface UploadType {
  /** The exact string to store ("" when unknown). */
  readonly mediaType: string;
  readonly from: 'signature' | 'text' | 'unknown';
  /** Why the browser's type was dropped, when the chain's grammar refused it. */
  readonly refused?: string;
}

const MEDIA_CLAIM = /^(image|audio|video)\//i;

export function uploadMediaType(
  bytes: Uint8Array,
  browserType: string,
  normalize: (input: string) => MediaTypeCheck,
): UploadType {
  const content = classifyContent(bytes);
  let candidate: string;
  let from: UploadType['from'];
  if (content.kind === 'media') {
    candidate = content.media.mime;
    from = 'signature';
  } else if (content.kind === 'text') {
    const claimed = browserType.trim();
    candidate =
      claimed === '' || MEDIA_CLAIM.test(claimed) || /^application\/octet-stream/i.test(claimed)
        ? 'text/plain'
        : claimed;
    from = 'text';
  } else {
    return { mediaType: '', from: 'unknown' };
  }
  const check = normalize(candidate);
  return check.ok
    ? { mediaType: check.mediaType, from }
    : { mediaType: '', from: 'unknown', refused: check.reason };
}

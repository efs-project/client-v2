// The Preview pane's logic, kept free of Lit and of the SDK's runtime (types only) so it runs
// against the SDK's recorded fixtures in unit tests. The pane renders the states this emits.
//
// Two rules this file exists to keep:
// - Only bytes graded VERIFIED are ever shown as a file's contents.
// - "Proven absent" and "couldn't tell" are different states; neither is ever shown as empty.

import type { Efs, Lens } from '@efs/sdk';
import type {
  ByteRangeResult,
  BytesOpts,
  FileRef,
  OpenedFile,
  OpenResult,
  ReadOpts,
  RevisionRef,
} from '@efs/sdk/files';
import { agrees, type MediaKind, sniffMedia } from './media.ts';

export type PreviewTarget = FileRef | RevisionRef;

/** Largest file the pane reads by itself. Bigger files wait for an explicit "Load". */
export const PREVIEW_MAX_BYTES = 1024n * 1024n;
/** Text beyond this many characters is cut from the on-screen preview (never from a save). */
export const PREVIEW_MAX_CHARS = 200_000;

export type Content =
  | { readonly kind: 'text'; readonly text: string; readonly truncated: boolean }
  /** An image, audio or video the bytes' own signature names (see media.ts). */
  | { readonly kind: 'media'; readonly media: MediaKind }
  /**
   * The bytes are media, but the file declares a different kind of type (its descriptor's media
   * type, a hint only). Neither is trusted, so nothing is shown; the person can save a copy.
   */
  | { readonly kind: 'mismatch'; readonly declared: string; readonly media: MediaKind }
  | { readonly kind: 'binary' };

type Present = Extract<OpenResult, { status: 'PRESENT' }>;

export type PreviewState =
  | { readonly phase: 'opening' }
  /** The file couldn't be opened as PRESENT: ABSENT_PROVEN, MASKED, CONFLICT, UNKNOWN, INVALID. */
  | { readonly phase: 'not-present'; readonly open: Exclude<OpenResult, Present> }
  /** Opened; larger than the automatic preview limit, so nothing is fetched until asked. */
  | { readonly phase: 'too-large'; readonly open: Present }
  | { readonly phase: 'reading'; readonly open: Present }
  /** Read finished. `content` is present only when the bytes are VERIFIED. */
  | {
      readonly phase: 'read';
      readonly open: Present;
      readonly bytes: ByteRangeResult;
      readonly content?: Content;
    };

/** The two SDK functions the pane needs, injected so tests can replay recorded results. */
export interface PreviewReads {
  openFile(efs: Efs, target: PreviewTarget, o?: ReadOpts): Promise<OpenResult>;
  readBytes(efs: Efs, file: OpenedFile, o?: BytesOpts): Promise<ByteRangeResult>;
}

/**
 * Text if the bytes are valid UTF-8 without NUL; otherwise binary. Never guesses an encoding.
 * `declared` is the file's declared media type (`OpenedFile.mediaType`), a hint: it can stop a
 * preview when it disagrees with the bytes, but it never makes bytes count as something they
 * aren't, so text stays text whatever it declares.
 */
export function classifyContent(bytes: Uint8Array, declared?: string): Content {
  // Media first: SVG is text too, and is shown only as an image.
  const media = sniffMedia(bytes);
  if (media) {
    return declared !== undefined && !agrees(declared, media)
      ? { kind: 'mismatch', declared, media }
      : { kind: 'media', media };
  }
  if (bytes.includes(0)) return { kind: 'binary' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { kind: 'binary' };
  }
  return text.length > PREVIEW_MAX_CHARS
    ? { kind: 'text', text: text.slice(0, PREVIEW_MAX_CHARS), truncated: true }
    : { kind: 'text', text, truncated: false };
}

export interface PreviewOptions {
  /** Read past PREVIEW_MAX_BYTES (the person asked to load it). */
  readonly force?: boolean;
  /** The Lens to resolve the file's head under (a shared link's); the default otherwise. */
  readonly lens?: Lens;
  /**
   * Publisher origins the person allowed for this read only ("Load from example.com"). Each must
   * come from a previous result's `blockedOrigins`. Never remembered.
   */
  readonly allowOrigins?: readonly string[];
}

/**
 * Opens `target` and reads its bytes, reporting each step through `emit`. Stops quietly when
 * `signal` aborts (the target or the session changed).
 */
export async function runPreview(
  reads: PreviewReads,
  efs: Efs,
  target: PreviewTarget,
  signal: AbortSignal,
  emit: (state: PreviewState) => void,
  { force = false, lens, allowOrigins }: PreviewOptions = {},
): Promise<void> {
  emit({ phase: 'opening' });
  const open = await reads.openFile(efs, target, lens ? { signal, lens } : { signal });
  if (signal.aborted) return;
  if (open.status !== 'PRESENT') {
    emit({ phase: 'not-present', open });
    return;
  }
  if (!force && open.file.size > PREVIEW_MAX_BYTES) {
    emit({ phase: 'too-large', open });
    return;
  }
  emit({ phase: 'reading', open });
  const bytes = await reads.readBytes(efs, open.file, {
    signal,
    ...(force ? {} : { maxBytes: PREVIEW_MAX_BYTES }),
    ...(allowOrigins && allowOrigins.length > 0 ? { allowOrigins } : {}),
  });
  if (signal.aborted) return;
  emit(
    bytes.grade === 'VERIFIED' && bytes.bytes
      ? { phase: 'read', open, bytes, content: classifyContent(bytes.bytes, open.file.mediaType) }
      : { phase: 'read', open, bytes },
  );
}

// The Preview pane: one file's verified contents and the evidence for them. All logic is in
// preview-model.ts; this element only renders its states and the reader session's.

import type { Efs, Lens } from '@efs/sdk';
import { link } from '@efs/sdk/links';
import { formatRealmRoute } from '../../boot/route.ts';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { draftKey } from '../../shell/drafts.ts';
import { openSettings } from '../../shell/network-indicator.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { sharedGatewayNotice } from '../../shell/shared-gateway.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, keyed, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { type Composer, type NewFile, newFileKey } from './compose.ts';
import type { EditDoneDetail } from './editor.ts';
import { placeLens } from './folder-model.ts';
import type { EfsFolderSave } from './folder-save.ts';
import { dataUrl, MEDIA_MAX_BYTES, SVG_MAX_BYTES, SVG_MIME } from './media.ts';
import type { FolderNav } from './navigation.ts';
import { readerNotice } from './notice.ts';
import { type ObjectKind, type ObjectKindState, readerOf, readLens } from './object-kind.ts';
import { type Content, type PreviewReads, type PreviewState, runPreview } from './preview-model.ts';
import type { LinkState } from './target.ts';
import { authorLabel, shortId } from './who.ts';

/**
 * The SDK's byte reads load only when there is a verified session to read through, so opening
 * the File Browser on a site with no usable network never downloads the SDK.
 */
/** A file extension for "Save a copy", from what the bytes are. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/mp4': 'mp4',
};
const extensionOf = (content: Content | undefined): string =>
  content?.kind === 'text'
    ? 'txt'
    : content?.kind === 'media'
      ? (EXTENSIONS[content.media.mime] ?? 'bin')
      : 'bin';

/** "files.example.org" from "https://files.example.org": what the person recognizes. */
const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/** Two Lenses read the same: both the default, or the same principals in the same order. */
const sameLens = (a: Lens | undefined, b: Lens | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.principals.length === b.principals.length &&
    a.principals.every((p, i) => p.toLowerCase() === b.principals[i]?.toLowerCase()));

const loadReads = async (): Promise<PreviewReads> => {
  const { openFile, readBytes } = await import('@efs/sdk/files');
  return { openFile, readBytes };
};

/** `load-failed`: the SDK's chunk didn't load (only a page reload can retry it). */
type PaneState = PreviewState | { readonly phase: 'failed' } | { readonly phase: 'load-failed' };

export class EfsFilesPreview extends EfsElement {
  static override properties = {
    host: { attribute: false },
    target: { attribute: false },
    nav: { attribute: false },
    object: { attribute: false },
    composer: { attribute: false },
  };
  declare host: AppHost;
  /** The new text file being written, if any: shown here instead of the route's link. */
  declare composer: Composer | undefined;
  /** What the route's object link names: a file is read here only once openObject says so. */
  declare object: ObjectKindState | undefined;
  /** Where the person browsed in this tab: a file opened from a listing reads in its Lens. */
  declare nav: FolderNav | undefined;
  /** What the route's link asks for. */
  declare target: ReadonlySignal<LinkState>;

  #state = state<PaneState | undefined>(undefined);
  #run: OwnerScope | undefined;
  #scope: OwnerScope | undefined;
  #loaded: { efs: Efs; key: string } | undefined;
  /** The editor is open on the file shown. */
  #editing = state(false);
  /** "Show my version": the view's Lens with this account first, for this file, in this tab. */
  #mine = state<string | undefined>(undefined);
  /** After a save this view won't show: whose version it shows instead. */
  #notInView = state<string | undefined>(undefined);
  /** The person's own text, brought back by the banner's "Review changes". */
  #draftText = state<string | undefined>(undefined);
  /** The editor is open because the person came back to an unsaved edit of this file. */
  #resumed = false;
  /**
   * The URL of the VERIFIED bytes being shown as media: blob: (revoked when the read is
   * replaced), or data: for SVG.
   */
  #mediaUrl = state<string | undefined>(undefined);
  /** The browser couldn't decode the media it was given (unsupported codec or a broken file). */
  #mediaFailed = state(false);
  /** Saves handed off from this pane, and those already refreshed for (once each). */
  #handedOff = new Set<string>();
  /** Open results from the object-kind resolver already shown once (never reused after). */
  #usedOpens = new WeakSet<object>();
  #refreshed = new Set<string>();
  /** The version shown last (which file, under which account, by whom): to tell a reorder. */
  #lastShown: { canonical: string; reader: string | undefined; author: string | null } | undefined;
  /** After "you first" reordered this file's view: whose version showed before. */
  #reordered = state<{ readonly canonical: string; readonly author: string } | undefined>(
    undefined,
  );
  /** New files handed to the banner from here: opened by their link once Saved, if still here. */
  #created = new Map<
    string,
    { readonly subject: string; readonly route: string; readonly lens: Lens | undefined }
  >();

  protected override createRenderRoot() {
    return this;
  }

  /** Starts following the session and the target. Everything stops when `scope` is disposed. */
  start(scope: OwnerScope): void {
    this.#scope = scope;
    // Focus can be handed to the pane itself (after a new file is sent, before it opens).
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
    effect(scope, () => {
      const efs = verifiedEfs(this.host.reader.get());
      const link = this.target.get();
      // An object link is read as a file only once openObject says it is one.
      const kind = this.object?.kind.get().status;
      const key = link.status === 'target' ? `${link.canonical}|${kind ?? ''}` : undefined;
      if (efs === this.#loaded?.efs && key === this.#loaded?.key) return;
      this.#loaded = efs && key ? { efs, key } : undefined;
      // Another file (or session): drop this file's view choices. The editor stays open only if
      // the person left an unsaved edit of the new file here earlier: it comes back as they left it.
      const draft = this.#draftKey();
      const resumed = draft !== undefined && this.host.saving.drafts.get(draft) !== undefined;
      this.#editing.set(resumed);
      this.#resumed = resumed;
      this.#draftText.set(undefined);
      this.#mine.set(undefined);
      this.#notInView.set(undefined);
      queueMicrotask(() => this.#load(efs, link, false));
    });
    // A save handed off from here reached the ledger (Saved · confirming, then Saved): show the
    // file as it is now, once.
    effect(scope, () => {
      for (const p of this.host.saving.saves.get()) {
        if (p.state !== 'COMPLETE' || !this.#handedOff.has(p.sequenceId)) continue;
        if (this.#refreshed.has(p.sequenceId)) continue;
        this.#refreshed.add(p.sequenceId);
        queueMicrotask(() => this.#reload());
      }
    });
    // A new file handed off from here is Saved: open it by its link, if the person is still where
    // it was written (elsewhere, its row shows in its folder anyway).
    effect(scope, () => {
      for (const p of this.host.saving.saves.get()) {
        const made = this.#created.get(p.sequenceId);
        if (!made || p.state !== 'COMPLETE') continue;
        this.#created.delete(p.sequenceId);
        const location = this.host.location.get();
        if (location.kind === 'realm' && location.link === made.route) {
          queueMicrotask(() => {
            // Read in the folder's place Lens, as a row click does: under the default Lens the
            // person's own new file may have no HEAD yet ("not present").
            if (made.lens) this.nav?.rememberLens(made.subject, made.lens);
            this.host.openLink(link({ kind: 'object', subject: made.subject as never }));
          });
        }
      }
    });
    // "Review changes" for a new file: back to its folder, with its text, in the editor.
    effect(scope, () => {
      const draft = this.host.saving.reopening.get();
      const location = this.host.location.get();
      if (!draft?.create || location.kind !== 'realm') return;
      if (formatRealmRoute(location.realm, location.link) !== draft.route) return;
      queueMicrotask(() => {
        const taken = this.host.saving.takeReopen(draft.link);
        if (!taken?.create) return;
        this.#draftText.set(taken.text);
        this.composer?.start({ ...taken.create, route: location.link });
      });
    });
    // "Review changes" in the banner: the person's edit back in the editor, on the current file.
    effect(scope, () => {
      const draft = this.host.saving.reopening.get();
      const link = this.target.get();
      if (!draft || link.status !== 'target' || link.canonical !== draft.link) return;
      queueMicrotask(() => {
        const taken = this.host.saving.takeReopen(link.canonical);
        if (!taken) return;
        this.#notInView.set(undefined);
        this.#draftText.set(taken.text);
        this.#resumed = false;
        this.#editing.set(true);
        this.#reload();
      });
    });
  }

  #load(
    efs: Efs | undefined,
    link: LinkState,
    force: boolean,
    allowOrigins?: readonly string[],
  ): void {
    this.#run?.dispose();
    this.#run = undefined;
    if (!efs || link.status !== 'target' || !this.#scope || this.#scope.signal.aborted) {
      this.#state.set(undefined);
      return;
    }
    if (link.target.kind === 'file' && this.object && this.object.kind.get().status !== 'file') {
      this.#state.set(undefined);
      return;
    }
    const run = this.#scope.child();
    this.#run = run;
    // Opening from now on, not when the first read answers: until then the pane would still
    // show the previous result, and anything waiting for "read" (focus returning to Edit after
    // a save) would act on content that is about to be replaced.
    this.#state.set({ phase: 'opening' });
    loadReads()
      .catch((error: unknown) => {
        if (!run.signal.aborted) {
          console.error(error);
          this.#state.set({ phase: 'load-failed' });
        }
        return undefined;
      })
      .then((reads) => {
        if (!reads || run.signal.aborted) return undefined;
        const lens = this.#viewLens(efs, link);
        // The resolver's openFile, reused once and only in the same Lens: a reload (after a save,
        // "Show my version", Try again) always opens the file afresh.
        const kind = this.object?.kind.get();
        const opened =
          kind?.status === 'file' &&
          !this.#usedOpens.has(kind.open) &&
          sameLens(kind.lens, lens) &&
          link.target.kind === 'file'
            ? kind.open
            : undefined;
        if (opened) this.#usedOpens.add(opened);
        const show = (s: PreviewState) => {
          this.#mediaUrl.set(this.#mediaUrlFor(s, run));
          this.#mediaFailed.set(false);
          this.#state.set(s);
          if ('open' in s && s.open.status === 'PRESENT' && !this.#mine.get()) {
            this.#noteReorder(efs, link.canonical, s.open.file.author);
          }
        };
        // The media gate: a file opened from a tag's public tier fetches nothing until asked.
        const gated =
          link.target.kind === 'file' &&
          (this.nav?.gated.get().has(link.target.subject.toLowerCase()) ?? false);
        return runPreview(reads, efs, link.target, run.signal, show, {
          force,
          ...(gated ? { gated } : {}),
          ...(opened ? { opened } : {}),
          ...(lens ? { lens } : {}),
          ...(allowOrigins ? { allowOrigins } : {}),
        });
      })
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#state.set({ phase: 'failed' });
      });
  }

  /**
   * A URL for VERIFIED media within its size cap: a blob: URL owned by `run` (revoked when the
   * read is replaced or the pane goes away), or for SVG a data: URL. Never for unverified bytes:
   * there are none in `content`.
   */
  #mediaUrlFor(s: PreviewState, run: OwnerScope): string | undefined {
    if (s.phase !== 'read' || s.content?.kind !== 'media' || !s.bytes.bytes) return undefined;
    if (s.bytes.grade !== 'VERIFIED') return undefined;
    const { media } = s.content;
    // SVG: a data: URL only (see media.ts), never blob:.
    if (media.mime === SVG_MIME) {
      return s.bytes.bytes.length > SVG_MAX_BYTES ? undefined : dataUrl(SVG_MIME, s.bytes.bytes);
    }
    if (s.bytes.bytes.length > MEDIA_MAX_BYTES[media.kind]) return undefined;
    const url = URL.createObjectURL(new Blob([s.bytes.bytes as BlobPart], { type: media.mime }));
    run.defer(() => URL.revokeObjectURL(url));
    return url;
  }

  #mediaView(content: Extract<Content, { kind: 'media' }>, size: number, t: Translator['t']) {
    const url = this.#mediaUrl.get();
    const failed = () => this.#mediaFailed.set(true);
    if (this.#mediaFailed.get()) return html`<p>${t('files.preview.mediaFailed')}</p>`;
    if (!url) return html`<p>${t('files.preview.mediaTooLarge', { size })}</p>`;
    switch (content.media.kind) {
      case 'image':
        // <img> even for SVG: no script runs and nothing external loads there.
        return html`<img
          class="efs-preview-media"
          src=${url}
          alt=${t('files.preview.imageAlt')}
          decoding="async"
          @error=${failed}
        />`;
      case 'audio':
        return html`<audio class="efs-preview-media" controls preload="metadata" src=${url} @error=${failed}></audio>`;
      case 'video':
        return html`<video
          class="efs-preview-media"
          controls
          playsinline
          preload="metadata"
          src=${url}
          @error=${failed}
        ></video>`;
    }
  }

  /**
   * The Lens this pane reads under: the link's; else, for a file opened from a listing in this
   * tab, the Lens it was listed in; else the default. "Mine first" goes in front of that.
   */
  #viewLens(efs: Efs, link: Extract<LinkState, { status: 'target' }>): Lens | undefined {
    const mine = this.#mine.get();
    if (!mine) return readLens(efs, link, this.nav, readerOf(this.host));
    const listed = link.target.kind === 'file' ? this.nav?.lensFor(link.target.subject) : undefined;
    return efs.lens.mineFirst(mine as never, link.lens ?? listed ?? efs.lens.default);
  }

  /**
   * "You first" put the person's own version in front of the one shown before (they connected or
   * switched account): said, never silent. Called with each version shown.
   */
  #noteReorder(efs: Efs, canonical: string, author: string | null): void {
    const reader = readerOf(this.host);
    const me = reader ? efs.lens.principalOf(reader as never).toLowerCase() : undefined;
    const last = this.#lastShown;
    this.#lastShown = { canonical, reader, author };
    const now = this.#reordered.get();
    if (now && (now.canonical !== canonical || author?.toLowerCase() !== me)) {
      this.#reordered.set(undefined);
    }
    if (
      last?.canonical === canonical &&
      last.reader !== reader &&
      me !== undefined &&
      author?.toLowerCase() === me &&
      last.author !== null &&
      last.author.toLowerCase() !== me
    ) {
      this.#reordered.set({ canonical, author: last.author });
    }
  }

  /** Set when the editor closes: focus goes back to Edit once the file is on screen again. */
  #returnFocus = false;
  /** A new file handed to the banner from here: focus goes to its Edit once it opens. */
  #focusNew: string | undefined;

  /** Marked once per page: the first verified contents on screen (the Preview's budget). */
  static #markedVerified = false;

  override updated(): void {
    const shown = this.#state.get();
    if (!EfsFilesPreview.#markedVerified && shown?.phase === 'read' && shown.content) {
      EfsFilesPreview.#markedVerified = true;
      performance.mark('efs:preview-verified');
    }
    const s = this.#state.get();
    if (
      this.#focusNew &&
      s?.phase === 'read' &&
      s.open.file.file.toLowerCase() === this.#focusNew.toLowerCase()
    ) {
      this.#focusNew = undefined;
      this.#returnFocus = true;
    }
    if (!this.#returnFocus) return;
    if (s && s.phase !== 'read' && s.phase !== 'not-present' && s.phase !== 'failed') return;
    this.#returnFocus = false;
    // Edit when it's offered; otherwise the pane itself, so focus is never dropped on the page.
    const target =
      this.querySelector<HTMLElement>('wa-button.efs-edit-start') ??
      this.querySelector<HTMLElement>('.efs-preview');
    // A freshly rendered <wa-button> focuses its inner button only once its own first render
    // is done; before that, focus() is a silent no-op.
    const ready = (target as { updateComplete?: Promise<unknown> } | null)?.updateComplete;
    void Promise.resolve(ready).then(() => target?.focus());
  }

  /** The new-file editor closed: cancelled, or handed the new file to the banner. */
  #onNewFileDone = (event: Event): void => {
    const detail = (event as CustomEvent<EditDoneDetail>).detail;
    event.stopPropagation();
    const c = this.composer?.current.get();
    this.#draftText.set(undefined);
    const p = detail.progress;
    // The editor handed the save to the banner (with its text, for "Review changes"); it opens
    // here once Saved (the effect above), including when it's Saved already.
    // The editor is gone: focus goes to this pane now (after the review dialog's own focus
    // return, to a control that no longer exists), and to the new file's Edit once it opens.
    this.#focusNew = detail.created;
    setTimeout(() => {
      if (
        this.isConnected &&
        (document.activeElement === document.body || !document.activeElement)
      ) {
        this.focus();
      }
    });
    if (p && detail.created && c) {
      const efs = verifiedEfs(this.host.reader.get());
      this.#created.set(p.sequenceId, {
        subject: detail.created,
        route: c.route,
        lens: efs ? placeLens(efs, c.folder, p.account) : undefined,
      });
    }
    this.composer?.end();
  };

  /** The editor for a new text file, at the place it was started. */
  #compose(c: NewFile) {
    const efs = verifiedEfs(this.host.reader.get());
    const location = this.host.location.get();
    if (!efs || location.kind !== 'realm') return nothing;
    const a = this.host.saving.availability.get();
    const reader = a.status === 'READY' ? a.account : undefined;
    const key = newFileKey(location.realm, c.folder, c.name);
    return html`<div class="wa-stack wa-gap-m efs-preview efs-compose" tabindex="-1">
      ${keyed(
        key,
        html`<efs-file-editor
          .host=${this.host}
          .efs=${efs}
          .create=${{ folder: c.folder, folderName: c.folderName, name: c.name }}
          .realm=${location.realm}
          .route=${formatRealmRoute(location.realm, c.route)}
          .link=${''}
          .original=${''}
          .draft=${this.#draftText.get()}
          .draftKey=${key}
          .resumed=${this.host.saving.drafts.get(key) !== undefined}
          .lens=${placeLens(efs, c.folder, reader)}
          @efs-edit-done=${this.#onNewFileDone}
        ></efs-file-editor>`,
      )}
    </div>`;
  }

  #onEditDone = (event: Event): void => {
    const detail = (event as CustomEvent<EditDoneDetail>).detail;
    event.stopPropagation();
    this.#returnFocus = true;
    const shown = this.#state.get();
    const author =
      shown && 'open' in shown && shown.open.status === 'PRESENT' ? shown.open.file.author : null;
    this.#editing.set(false);
    this.#resumed = false;
    this.#draftText.set(undefined);
    const p = detail.progress;
    // Whatever state the save is in, this view won't show it: say so now, with "Show my version".
    this.#notInView.set(p && detail.visibleInLens === false ? (author ?? '—') : undefined);
    if (p) {
      this.#lastAccount = p.account;
      this.#handedOff.add(p.sequenceId);
      if (p.state === 'COMPLETE') this.#refreshed.add(p.sequenceId);
    }
    // Saved already, or the person asked for the newer version: show the file as it is now.
    // Otherwise the refresh comes when the banner sees the save reach the ledger.
    if (p?.state === 'COMPLETE' || detail.showLatest) this.#reload();
  };

  /** The account of the last save from this pane (for "Show my version"). */
  #lastAccount: string | undefined;

  #reload(force = false, allowOrigins?: readonly string[]): void {
    this.#load(verifiedEfs(this.host.reader.get()), this.target.get(), force, allowOrigins);
  }

  #save(bytes: Uint8Array, sha256: string, content: Content | undefined): void {
    const name = `efs-${sha256.slice(2, 14)}.${extensionOf(content)}`;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  #facts(open: Extract<PreviewState, { open: unknown }>['open'], t: Translator['t']) {
    if (open.status !== 'PRESENT') return nothing;
    const { file, basis } = open;
    return html`<dl class="efs-facts efs-preview-facts">
      <dt>${t('files.preview.meta.size')}</dt>
      <dd>${t('files.preview.sizeValue', { size: Number(file.size) })}</dd>
      <dt>${t('files.preview.meta.sha256')}</dt>
      <dd><code translate="no" dir="ltr" class="efs-hash">${file.sha256}</code></dd>
      <dt>${t('files.preview.meta.layout')}</dt>
      <dd><code translate="no">${file.layout}</code></dd>
      <dt>${t('files.preview.meta.revision')}</dt>
      <dd><code translate="no" dir="ltr" class="efs-hash">${file.revision}</code></dd>
      <dt>${t('files.preview.meta.basis')}</dt>
      <dd translate="no" dir="ltr">${basis.blockNumber.toString()} · ${basis.endpoint}</dd>
    </dl>`;
  }

  /** Text the editor can round-trip: verified, shown in full, and opened by object link. */
  #editable(content: Content | undefined): boolean {
    const link = this.target.get();
    return (
      content?.kind === 'text' &&
      !content.truncated &&
      link.status === 'target' &&
      link.target.kind === 'file'
    );
  }

  #canonical(): string {
    const link = this.target.get();
    return link.status === 'target' ? link.canonical : '';
  }

  /**
   * An unsaved edit of this file that the editor can't show, because the file can't be opened
   * as editable text now: gone, no longer text, too large, or unreadable right now. Said, with a
   * way to discard it, so the leave prompt never stays with no way to clear it. If a later read
   * gets the text, the editor reopens on the edit as usual.
   */
  /**
   * `elsewhere`: the link settled as something other than a readable file (a folder, nothing,
   * UNKNOWN), so the kept edit can't be shown either.
   */
  #unreachableDraft(s: PaneState | undefined, t: Translator['t'], elsewhere = false) {
    const drafts = this.host.saving.drafts;
    const key = this.#draftKey();
    // Read the count so this re-renders when the edit is dropped.
    if (drafts.count.get() === 0 || key === undefined || !drafts.get(key)) return nothing;
    if (!elsewhere && (!s || s.phase === 'opening' || s.phase === 'reading')) return nothing;
    const editable =
      !elsewhere &&
      s !== undefined &&
      s.phase === 'read' &&
      s.bytes.grade === 'VERIFIED' &&
      s.bytes.bytes !== undefined &&
      this.#editable(s.content);
    if (editable) return nothing;
    return html`<wa-callout variant="warning" size="small" class="efs-draft-unreachable">
      <span slot="icon">${appIcon('triangle-exclamation')}</span>
      <div class="wa-stack wa-gap-xs">
        <p>${t('files.edit.unreachable')}</p>
        <div>
          <wa-button
            size="s"
            appearance="outlined"
            class="efs-draft-discard"
            @click=${() => {
              drafts.drop(key);
              this.#editing.set(false);
              this.#resumed = false;
              // The button goes away with the notice: keep focus in the pane.
              void this.updateComplete.then(() =>
                this.querySelector<HTMLElement>('.efs-preview')?.focus(),
              );
            }}
            >${t('files.edit.discardUnreachable')}</wa-button
          >
        </div>
      </div>
    </wa-callout>`;
  }

  /** The key of this file's unsaved edit: its canonical route in the realm in view. */
  /**
   * An unsaved edit's key: the file, never a route carrying a Lens. The same file opened with and
   * without `?lens=` is one edit, not two.
   */
  #draftKey(): string | undefined {
    const location = this.host.location.get();
    const target = this.target.get();
    if (location.kind !== 'realm' || target.status !== 'target') return undefined;
    const file =
      target.target.kind === 'file'
        ? link({ kind: 'object', subject: target.target.subject })
        : target.canonical;
    return draftKey(location.realm, file);
  }

  #currentLens(): Lens | undefined {
    const efs = verifiedEfs(this.host.reader.get());
    const link = this.target.get();
    return efs && link.status === 'target' ? this.#viewLens(efs, link) : undefined;
  }

  #viewNotices(t: Translator['t']) {
    const other = this.#notInView.get();
    if (other !== undefined && !this.#mine.get()) {
      return html`<wa-callout variant="neutral" size="small" class="efs-edit-not-in-view">
        <span slot="icon">${appIcon('circle-info')}</span>
        <div class="wa-split wa-gap-s">
          <p>${t('files.edit.notInView', {
            author: authorLabel(verifiedEfs(this.host.reader.get()), other),
          })}</p>
          <wa-button
            size="s"
            class="efs-edit-show-mine"
            @click=${() => {
              this.#mine.set(this.#lastAccount);
              this.#notInView.set(undefined);
              this.#reload();
            }}
            >${t('files.edit.showMine')}</wa-button
          >
        </div>
      </wa-callout>`;
    }
    if (this.#mine.get()) {
      return html`<p class="wa-cluster wa-gap-xs efs-quiet efs-viewing-mine">
        ${t('files.edit.viewingMine')}
        <wa-button
          size="s"
          appearance="plain"
          @click=${() => {
            this.#mine.set(undefined);
            this.#reload();
          }}
          >${t('files.edit.showShared')}</wa-button
        >
      </p>`;
    }
    return nothing;
  }

  /** An object link that isn't (yet) known to be a file: never read as one. */
  #object(named: ObjectKind, t: Translator['t']) {
    switch (named.status) {
      case 'folder':
        return html`<p class="efs-quiet efs-preview-folder">${t('files.preview.isFolder')}</p>`;
      case 'noPath':
        return html`<div class="wa-stack wa-gap-xs efs-preview-no-path" role="status">
          <p>
            ${t(
              named.why === 'masked'
                ? 'files.preview.pathMasked'
                : named.why === 'notFolder'
                  ? 'files.preview.pathNotFolder'
                  : 'files.preview.pathAbsent',
              { name: named.name },
            )}
          </p>
          <div>
            <wa-button size="s" appearance="outlined" @click=${() => this.object?.retry()}
              ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
            >
          </div>
        </div>`;
      case 'absent':
      case 'invalid':
      case 'unknown':
        return html`<efs-outcome
          .kind=${'read'}
          .code=${named.status === 'absent' ? 'ABSENT_PROVEN' : named.status === 'invalid' ? 'INVALID' : 'UNKNOWN'}
          .translator=${this.host.translator}
          retryable
          @efs-retry=${() => this.object?.retry()}
        ></efs-outcome>`;
      default:
        return html`<p class="wa-cluster wa-gap-xs" role="status">
          <wa-spinner></wa-spinner>${t('files.preview.opening')}
        </p>`;
    }
  }

  #body(s: PaneState, t: Translator['t']) {
    const retry = () => this.#reload();
    switch (s.phase) {
      case 'opening':
      case 'reading':
        return html`<p class="wa-cluster wa-gap-xs" role="status">
          <wa-spinner></wa-spinner>${t(s.phase === 'opening' ? 'files.preview.opening' : 'files.preview.reading')}
        </p>`;
      case 'load-failed':
        return html`<wa-callout variant="danger">
          <span slot="icon">${appIcon('circle-exclamation')}</span>
          <div class="wa-stack wa-gap-xs">
            <p>${t('files.preview.loadFailed')}</p>
            <div>
              <wa-button size="s" @click=${() => location.reload()}
                ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
              >
            </div>
          </div>
        </wa-callout>`;
      case 'failed':
        return html`<wa-callout variant="danger">
          <span slot="icon">${appIcon('circle-exclamation')}</span>
          <div class="wa-stack wa-gap-xs">
            <p>${t('files.preview.failed')}</p>
            <div>
              <wa-button size="s" @click=${retry}
                ><span slot="start">${appIcon('rotate-right')}</span>${t('outcome.retry')}</wa-button
              >
            </div>
          </div>
        </wa-callout>`;
      case 'not-present':
        return html`<efs-outcome
          .kind=${'read'}
          .code=${s.open.status}
          .translator=${this.host.translator}
          retryable
          @efs-retry=${retry}
        ></efs-outcome>`;
      case 'gated':
        return html`${this.#facts(s.open, t)}
          <div class="wa-stack wa-gap-xs efs-preview-gated">
            <p>${t('files.preview.gated')}</p>
            <div>
              <wa-button
                size="s"
                class="efs-preview-show"
                @click=${() => {
                  this.nav?.ungate(s.open.file.file);
                  this.#reload();
                }}
                >${t('files.preview.showPreview')}</wa-button
              >
            </div>
          </div>`;
      case 'too-large':
        return html`${this.#facts(s.open, t)}
          <div class="wa-stack wa-gap-xs">
            <p>${t('files.preview.tooLarge', { size: Number(s.open.file.size) })}</p>
            <div>
              <wa-button size="s" @click=${() => this.#reload(true)}
                ><span slot="start">${appIcon('download')}</span>${t('files.preview.load')}</wa-button
              >
            </div>
          </div>`;
      case 'read': {
        const { bytes, content, open } = s;
        const verified = bytes.grade === 'VERIFIED' && bytes.bytes ? bytes.bytes : undefined;
        return html`<efs-outcome
            compact
            .kind=${'bytes'}
            .code=${bytes.grade}
            .translator=${this.host.translator}
            retryable
            @efs-retry=${retry}
          ></efs-outcome>
          ${this.#facts(open, t)}
          ${this.#viewNotices(t)}
          ${
            verified
              ? this.#editing.get() && this.#editable(content)
                ? html`<efs-file-editor
                    .host=${this.host}
                    .efs=${verifiedEfs(this.host.reader.get())}
                    .file=${open.file}
                    .since=${open.basis.admissions}
                    .link=${this.#canonical()}
                    .original=${content?.kind === 'text' ? content.text : ''}
                    .draft=${this.#draftText.get()}
                    .draftKey=${this.#draftKey() ?? ''}
                    .resumed=${this.#resumed}
                    .lens=${this.#currentLens()}
                    @efs-edit-done=${this.#onEditDone}
                  ></efs-file-editor>`
                : html`${
                    content?.kind === 'text'
                      ? html`<pre class="efs-preview-text" translate="no">${content.text}</pre>
                          ${content.truncated ? html`<p class="efs-quiet">${t('files.preview.truncated')}</p>` : nothing}`
                      : content?.kind === 'media'
                        ? this.#mediaView(content, verified.length, t)
                        : content?.kind === 'mismatch'
                          ? html`<p class="efs-preview-mismatch">
                              ${t('files.preview.mismatch', { declared: content.declared })}
                            </p>`
                          : html`<p>${t('files.preview.binary')}</p>`
                  }
                  <div class="wa-cluster wa-gap-xs">
                    ${
                      this.#editable(content) && !this.host.saving.hosting.shared
                        ? html`<wa-button
                            size="s"
                            variant="brand"
                            class="efs-edit-start"
                            @click=${() => {
                              this.#notInView.set(undefined);
                              this.#resumed = false;
                              this.#editing.set(true);
                            }}
                            ><span slot="start">${appIcon('pen-to-square')}</span>${t('files.edit.start')}</wa-button
                          >`
                        : nothing
                    }
                    <wa-button
                      size="s"
                      @click=${() => this.#save(verified, open.file.sha256, content)}
                      ><span slot="start">${appIcon('download')}</span>${t('files.preview.save')}</wa-button
                    >
                    ${
                      this.host.saving.hosting.shared
                        ? nothing
                        : html`<wa-button
                            size="s"
                            class="efs-preview-tag"
                            @click=${() => this.#tag(open.file.file)}
                            ><span slot="start">${appIcon('tag')}</span>${t('files.tag.button')}</wa-button
                          >`
                    }
                  </div>
                  ${
                    this.#editable(content) && this.host.saving.hosting.shared
                      ? sharedGatewayNotice(this.host.saving.hosting, t)
                      : nothing
                  }`
              : bytes.blockedOrigins && bytes.blockedOrigins.length > 0
                ? html`<div class="wa-stack wa-gap-xs efs-publisher-hosts">
                    ${bytes.blockedOrigins.map(
                      (
                        origin,
                      ) => html`<p>${t('files.preview.publisherHost', { host: hostOf(origin) })}</p>
                        <div class="wa-cluster wa-gap-xs">
                          <wa-button
                            size="s"
                            @click=${() => this.#reload(true, [origin])}
                            ><span slot="start">${appIcon('download')}</span>${t(
                              'files.preview.loadFromHost',
                              {
                                host: hostOf(origin),
                              },
                            )}</wa-button
                          >
                        </div>`,
                    )}
                    <div>
                      <wa-button
                        size="s"
                        appearance="outlined"
                        @click=${() => openSettings(this, 'network')}
                        ><span slot="start">${appIcon('gear')}</span>${t('files.preview.alwaysAllow')}</wa-button
                      >
                    </div>
                  </div>`
                : bytes.attempts.length > 0
                  ? html`<div class="wa-stack wa-gap-3xs">
                    <p class="efs-quiet">${t('files.preview.attempts')}</p>
                    <ul class="efs-attempts">
                      ${bytes.attempts.map(
                        (a) => html`<li translate="no" dir="ltr">
                          <code>${a.location}</code> · ${a.outcome}${a.detail ? ` (${a.detail})` : ''}
                        </li>`,
                      )}
                    </ul>
                  </div>`
                  : nothing
          }`;
      }
    }
  }

  /**
   * Tag: the file shown, by its permanent subject. It's named by its short id until the SDK names
   * files in lists (a file's name isn't part of its link).
   */
  #tag(subject: string): void {
    const dialog = this.querySelector<EfsFolderSave>(
      'efs-files-folder-save.efs-preview-tag-dialog',
    );
    dialog?.open({
      kind: 'tag',
      targets: [{ kind: 'file', subject: subject as never }],
      names: [shortId(subject)],
    });
  }

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const link = this.target.get();
    const composing = this.composer?.current.get();
    if (composing) return readerNotice(this, this.host, t) ?? this.#compose(composing);
    if (link.status === 'none') return html`<p class="efs-quiet">${t('files.preview.empty')}</p>`;
    // A tag or an address lists in Entries; a row opened from it shows here. Names under an
    // address are looked up first, then opened by their own link (or said why not), as paths are.
    if (link.status === 'topic' || (link.status === 'home' && link.names.length === 0)) {
      return html`<p class="efs-quiet">${t('files.preview.empty')}</p>`;
    }
    if (link.status === 'invalid') {
      return html`<wa-callout variant="warning">
        <span slot="icon">${appIcon('triangle-exclamation')}</span>
        <p>
          ${t('files.preview.invalidLink')}
          <code translate="no" dir="ltr">${link.rule}</code>
        </p>
      </wa-callout>`;
    }
    const notice = readerNotice(this, this.host, t);
    if (notice) return notice;
    // A path link: looked up, then replaced by the link of what it leads to; until then (or when
    // it leads nowhere) this pane says so.
    if (link.status === 'path' || link.status === 'home') {
      return html`<div class="wa-stack wa-gap-m efs-preview" tabindex="-1">
        ${this.#object(this.object?.kind.get() ?? { status: 'pending' }, t)}
      </div>`;
    }
    const named = link.target.kind === 'file' ? this.object?.kind.get() : undefined;
    const s = this.#state.get();
    if (named && named.status !== 'file' && named.status !== 'none') {
      return html`<div class="wa-stack wa-gap-m efs-preview" tabindex="-1">
        ${this.#unreachableDraft(s, t, named.status !== 'pending')} ${this.#object(named, t)}
      </div>`;
    }
    const reordered = this.#reordered.get();
    const efs = verifiedEfs(this.host.reader.get());
    return html`<div class="wa-stack wa-gap-m efs-preview" tabindex="-1">
      <efs-files-folder-save
        class="efs-preview-tag-dialog"
        .host=${this.host}
        .efs=${efs}
        .lens=${efs?.lens.default}
      ></efs-files-folder-save>
      ${
        reordered?.canonical === link.canonical
          ? html`<p class="efs-quiet efs-preview-reordered" role="status">
              ${t('files.preview.reordered', {
                author: authorLabel(verifiedEfs(this.host.reader.get()), reordered.author),
              })}
            </p>`
          : nothing
      }
      ${this.#unreachableDraft(s, t)}
      ${s ? this.#body(s, t) : html`<p class="wa-cluster wa-gap-xs" role="status"><wa-spinner></wa-spinner>${t('files.preview.opening')}</p>`}
    </div>`;
  }
}

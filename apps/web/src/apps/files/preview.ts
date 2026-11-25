// The Preview pane: one file's verified contents and the evidence for them. All logic is in
// preview-model.ts; this element only renders its states and the reader session's.

import type { Efs, Lens } from '@efs/sdk';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { openSettings } from '../../shell/network-indicator.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { sharedGatewayNotice } from '../../shell/shared-gateway.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
import { type EditDoneDetail, shortId } from './editor.ts';
import { readerNotice } from './notice.ts';
import { type Content, type PreviewReads, type PreviewState, runPreview } from './preview-model.ts';
import type { LinkState } from './target.ts';

/**
 * The SDK's byte reads load only when there is a verified session to read through, so opening
 * the File Browser on a site with no usable network never downloads the SDK.
 */
/** "files.example.org" from "https://files.example.org": what the person recognizes. */
const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

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
  };
  declare host: AppHost;
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
  /** Saves handed off from this pane, and those already refreshed for (once each). */
  #handedOff = new Set<string>();
  #refreshed = new Set<string>();

  protected override createRenderRoot() {
    return this;
  }

  /** Starts following the session and the target. Everything stops when `scope` is disposed. */
  start(scope: OwnerScope): void {
    this.#scope = scope;
    effect(scope, () => {
      const efs = verifiedEfs(this.host.reader.get());
      const link = this.target.get();
      const key = link.status === 'target' ? link.canonical : undefined;
      if (efs === this.#loaded?.efs && key === this.#loaded?.key) return;
      this.#loaded = efs && key ? { efs, key } : undefined;
      // Another file (or session): close the editor and drop this file's view choices.
      this.#editing.set(false);
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
    const run = this.#scope.child();
    this.#run = run;
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
        return runPreview(reads, efs, link.target, run.signal, (s) => this.#state.set(s), {
          force,
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

  /** The Lens this pane reads under: the link's (else the default), or that with "mine first". */
  #viewLens(efs: Efs, link: Extract<LinkState, { status: 'target' }>): Lens | undefined {
    const mine = this.#mine.get();
    return mine ? efs.lens.mineFirst(mine as never, link.lens ?? efs.lens.default) : link.lens;
  }

  #onEditDone = (event: Event): void => {
    const detail = (event as CustomEvent<EditDoneDetail>).detail;
    event.stopPropagation();
    const shown = this.#state.get();
    const author =
      shown && 'open' in shown && shown.open.status === 'PRESENT' ? shown.open.file.author : null;
    this.#editing.set(false);
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
    const name = `efs-${sha256.slice(2, 14)}.${content?.kind === 'text' ? 'txt' : 'bin'}`;
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
          <p>${t('files.edit.notInView', { author: shortId(other) })}</p>
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
                    .link=${this.#canonical()}
                    .original=${content?.kind === 'text' ? content.text : ''}
                    .draft=${this.#draftText.get()}
                    .lens=${this.#currentLens()}
                    @efs-edit-done=${this.#onEditDone}
                  ></efs-file-editor>`
                : html`${
                    content?.kind === 'text'
                      ? html`<pre class="efs-preview-text" translate="no">${content.text}</pre>
                          ${content.truncated ? html`<p class="efs-quiet">${t('files.preview.truncated')}</p>` : nothing}`
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

  override render() {
    const t = this.host.translator.t.bind(this.host.translator);
    const link = this.target.get();
    if (link.status === 'none') return html`<p class="efs-quiet">${t('files.preview.empty')}</p>`;
    if (link.status === 'path')
      return html`<p class="efs-quiet">${t('files.preview.pathLink')}</p>`;
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
    const s = this.#state.get();
    return html`<div class="wa-stack wa-gap-m efs-preview">
      ${s ? this.#body(s, t) : html`<p class="wa-cluster wa-gap-xs" role="status"><wa-spinner></wa-spinner>${t('files.preview.opening')}</p>`}
    </div>`;
  }
}

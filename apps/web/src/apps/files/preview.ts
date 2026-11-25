// The Preview pane: one file's verified contents and the evidence for them. All logic is in
// preview-model.ts; this element only renders its states and the reader session's.

import type { Efs } from '@efs/sdk';
import type { OwnerScope } from '../../platform/scope.ts';
import type { AppHost } from '../../shell/apps.ts';
import { openSettings } from '../../shell/network-indicator.ts';
import { verifiedEfs } from '../../shell/reader-state.ts';
import { effect } from '../../state/effect.ts';
import { type ReadonlySignal, state } from '../../state/signals.ts';
import { EfsElement, html, nothing } from '../../ui/element.ts';
import type { Translator } from '../../ui/i18n.ts';
import { appIcon } from '../../ui/icons.ts';
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
      queueMicrotask(() => this.#load(efs, link, false));
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
      .then((reads) =>
        !reads || run.signal.aborted
          ? undefined
          : runPreview(reads, efs, link.target, run.signal, (s) => this.#state.set(s), {
              force,
              ...(link.lens ? { lens: link.lens } : {}),
              ...(allowOrigins ? { allowOrigins } : {}),
            }),
      )
      .catch((error: unknown) => {
        if (run.signal.aborted) return;
        console.error(error);
        this.#state.set({ phase: 'failed' });
      });
  }

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
          ${
            verified
              ? html`${
                  content?.kind === 'text'
                    ? html`<pre class="efs-preview-text" translate="no">${content.text}</pre>
                        ${content.truncated ? html`<p class="efs-quiet">${t('files.preview.truncated')}</p>` : nothing}`
                    : html`<p>${t('files.preview.binary')}</p>`
                }
                <div>
                  <wa-button
                    size="s"
                    @click=${() => this.#save(verified, open.file.sha256, content)}
                    ><span slot="start">${appIcon('download')}</span>${t('files.preview.save')}</wa-button
                  >
                </div>`
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

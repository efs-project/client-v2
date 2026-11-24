// System settings: appearance, network endpoints, and the settings data itself. Part of the
// shell (conserved System Chrome), not of any app. Every change goes through OsState's
// compare-and-set save; the result is announced politely, never by a native dialog.

import {
  COLOR_MODES,
  type ColorMode,
  DEFAULT_SETTINGS,
  type Endpoint,
  type NetworkDefinition,
  type NetworkOverrides,
  readSettings,
  THEMES,
  type ThemeId,
  type UserSettings,
} from '../platform/settings/model.ts';
import type { SaveResult } from '../platform/settings/store.ts';
import { state } from '../state/signals.ts';
import { EfsElement, html, nothing } from '../ui/element.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';
import { appIcon } from '../ui/icons.ts';
import type { OsState } from './os-state.ts';

type Section = 'appearance' | 'network' | 'data' | 'about';

type ReleaseState =
  | { readonly kind: 'idle' | 'loading' | 'unavailable' }
  | { readonly kind: 'ready'; readonly digest: string; readonly commit: string };

/** Hashes release.json exactly as served. Self-reported: it can't prove the page is genuine. */
async function readRelease(signal: AbortSignal): Promise<ReleaseState> {
  const response = await fetch(new URL('release.json', document.baseURI), { signal });
  if (!response.ok) return { kind: 'unavailable' };
  const bytes = await response.arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const source =
    typeof manifest === 'object' && manifest !== null && 'source' in manifest
      ? manifest.source
      : undefined;
  const commit =
    typeof source === 'object' &&
    source !== null &&
    'commit' in source &&
    typeof source.commit === 'string'
      ? source.commit
      : '';
  return { kind: 'ready', digest, commit };
}
type Pending = { kind: 'import'; settings: UserSettings } | { kind: 'reset' };

const MODE_LABEL: Readonly<Record<ColorMode, MessageId>> = {
  system: 'settings.appearance.mode.system',
  light: 'settings.appearance.mode.light',
  dark: 'settings.appearance.mode.dark',
};
const THEME_LABEL: Readonly<Record<ThemeId, MessageId>> = {
  cypher: 'settings.appearance.theme.cypher',
  paper: 'settings.appearance.theme.paper',
};
const SAVE_MESSAGE: Readonly<Record<Exclude<SaveResult['status'], 'SAVED'>, MessageId>> = {
  CONFLICT: 'settings.save.conflict',
  READ_ONLY: 'settings.save.readOnly',
  FAILED: 'settings.save.failed',
};

type ListKey = keyof NetworkOverrides;

export class EfsSettingsPanel extends EfsElement {
  static override properties = {
    os: { attribute: false },
    translator: { attribute: false },
  };
  declare os: OsState;
  declare translator: Translator;

  #notice = state<MessageId | undefined>(undefined);
  #pending = state<Pending | undefined>(undefined);
  #release = state<ReleaseState>({ kind: 'idle' });
  #releaseAbort: AbortController | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#releaseAbort?.abort();
  }

  /** The manifest is fetched only when someone opens settings, never at boot. */
  #loadRelease(): void {
    if (this.#release.get().kind !== 'idle') return;
    this.#release.set({ kind: 'loading' });
    this.#releaseAbort = new AbortController();
    readRelease(this.#releaseAbort.signal).then(
      (result) => this.#release.set(result),
      () => {
        if (!this.#releaseAbort?.signal.aborted) this.#release.set({ kind: 'unavailable' });
      },
    );
  }

  protected override createRenderRoot() {
    return this;
  }

  /** Opens the drawer and moves focus to the requested section. */
  open(section: Section = 'appearance'): void {
    const drawer = this.querySelector<HTMLElement & { open: boolean }>('wa-drawer');
    if (!drawer) return;
    drawer.open = true;
    this.#loadRelease();
    drawer.addEventListener(
      'wa-after-show',
      () => this.querySelector<HTMLElement>(`[data-section="${section}"] h3`)?.focus(),
      { once: true },
    );
  }

  async #save(change: (s: UserSettings) => UserSettings): Promise<void> {
    const result = await this.os.updateSettings(change);
    this.#notice.set(
      result.status === 'SAVED' ? 'settings.save.saved' : SAVE_MESSAGE[result.status],
    );
  }

  #selectedNetwork(): NetworkDefinition | undefined {
    const network = this.os.network.get();
    return 'network' in network ? network.network.definition : undefined;
  }

  #editList(definition: NetworkDefinition, key: ListKey, next: readonly Endpoint[] | undefined) {
    void this.#save((s) => {
      const current: NetworkOverrides = s.network.overrides[definition.id] ?? {};
      const { [key]: _removed, ...others } = current;
      const updated: NetworkOverrides = next === undefined ? others : { ...others, [key]: next };
      return {
        ...s,
        network: { ...s.network, overrides: { ...s.network.overrides, [definition.id]: updated } },
      };
    });
  }

  #export(): void {
    const settings = this.os.settings.get();
    const blob = new Blob([`${JSON.stringify(settings, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'efs-settings.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async #importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 256 * 1024) return this.#notice.set('settings.data.import.invalid');
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return this.#notice.set('settings.data.import.invalid');
    }
    const read = readSettings(raw);
    if (read.status !== 'OK') return this.#notice.set('settings.data.import.invalid');
    this.#pending.set({ kind: 'import', settings: read.settings });
  }

  #confirm(): void {
    const pending = this.#pending.get();
    this.#pending.set(undefined);
    if (!pending) return;
    const replacement = pending.kind === 'import' ? pending.settings : DEFAULT_SETTINGS;
    // Keep the compare-and-set revision of what we're replacing.
    void this.#save((current) => ({ ...replacement, revision: current.revision }));
  }

  #appearance() {
    const t = this.translator.t.bind(this.translator);
    const { mode, theme } = this.os.appearance.get();
    const readOnly = this.os.settingsInfo.get().readOnly;
    return html`<section class="wa-stack wa-gap-m" data-section="appearance">
      <h3 tabindex="-1">${t('settings.appearance.heading')}</h3>
      <wa-radio-group
        label=${t('settings.appearance.mode')}
        orientation="horizontal"
        .value=${mode}
        ?disabled=${readOnly}
        @change=${(event: Event) => {
          const value = (event.target as HTMLElement & { value: string }).value;
          const next = COLOR_MODES.find((m) => m === value);
          if (next) void this.#save((s) => ({ ...s, appearance: { ...s.appearance, mode: next } }));
        }}
      >
        ${COLOR_MODES.map(
          (m) => html`<wa-radio appearance="button" value=${m}>${t(MODE_LABEL[m])}</wa-radio>`,
        )}
      </wa-radio-group>
      <wa-select
        label=${t('settings.appearance.theme')}
        .value=${theme}
        ?disabled=${readOnly}
        @change=${(event: Event) => {
          const value = (event.target as HTMLElement & { value: string }).value;
          const next = THEMES.find((x) => x === value);
          if (next)
            void this.#save((s) => ({ ...s, appearance: { ...s.appearance, theme: next } }));
        }}
      >
        ${THEMES.map((x) => html`<wa-option value=${x}>${t(THEME_LABEL[x])}</wa-option>`)}
      </wa-select>
    </section>`;
  }

  #network() {
    const t = this.translator.t.bind(this.translator);
    const config = this.os.config.get();
    const networks = config.status === 'OK' ? config.config.networks : [];
    const definition = this.#selectedNetwork();
    const settings = this.os.settings.get();
    const readOnly = this.os.settingsInfo.get().readOnly;
    const overrides = definition ? (settings.network.overrides[definition.id] ?? {}) : {};
    const list = (key: ListKey, heading: MessageId, kind: 'rpc' | 'gateway') =>
      definition
        ? html`<efs-endpoint-list
            .endpoints=${overrides[key] ?? definition[key]}
            .kind=${kind}
            .heading=${t(heading)}
            .customized=${overrides[key] !== undefined}
            .disabled=${readOnly}
            .translator=${this.translator}
            @efs-endpoints-change=${(event: CustomEvent<{ endpoints?: readonly Endpoint[] }>) =>
              this.#editList(definition, key, event.detail.endpoints)}
          ></efs-endpoint-list>`
        : nothing;
    return html`<section class="wa-stack wa-gap-m" data-section="network">
      <h3 tabindex="-1">${t('settings.network.heading')}</h3>
      ${
        config.status === 'INVALID'
          ? html`<wa-callout variant="danger"
              ><span slot="icon">${appIcon('circle-exclamation')}</span>${t('settings.network.configInvalid')}</wa-callout
            >`
          : nothing
      }
      ${
        networks.length === 0
          ? html`<p>${t('settings.network.none')}</p>`
          : html`<wa-select
              label=${t('settings.network.select')}
              .value=${definition?.id ?? ''}
              ?disabled=${readOnly || networks.length < 2}
              @change=${(event: Event) => {
                const id = (event.target as HTMLElement & { value: string }).value;
                void this.#save((s) => ({ ...s, network: { ...s.network, selected: id } }));
              }}
            >
              ${networks.map(
                (n) => html`<wa-option value=${n.id}
                  >${n.label} <span class="efs-quiet" translate="no">(${n.chainId})</span></wa-option
                >`,
              )}
            </wa-select>`
      }
      <p class="efs-quiet">${t('settings.network.privacy')}</p>
      ${list('rpcs', 'settings.network.rpcs', 'rpc')}
      ${list('ipfsGateways', 'settings.network.ipfs', 'gateway')}
      ${list('arweaveGateways', 'settings.network.arweave', 'gateway')}
    </section>`;
  }

  #data() {
    const t = this.translator.t.bind(this.translator);
    const info = this.os.settingsInfo.get();
    const pending = this.#pending.get();
    return html`<section class="wa-stack wa-gap-m" data-section="data">
      <h3 tabindex="-1">${t('settings.data.heading')}</h3>
      <p>
        ${t(
          info.readOnly
            ? 'settings.data.readOnly'
            : info.persistent
              ? 'settings.data.persistent'
              : 'settings.data.notPersistent',
        )}
      </p>
      <p class="efs-quiet">${t('settings.data.perSite')}</p>
      <div class="wa-cluster wa-gap-xs">
        <wa-button size="s" @click=${() => this.#export()}
          ><span slot="start">${appIcon('download')}</span>${t('settings.data.export')}</wa-button
        >
        <wa-button
          size="s"
          ?disabled=${info.readOnly}
          @click=${() => this.querySelector<HTMLInputElement>('input[type=file]')?.click()}
          ><span slot="start">${appIcon('upload')}</span>${t('settings.data.import')}</wa-button
        >
        <wa-button size="s" appearance="outlined" variant="danger" ?disabled=${info.readOnly}
          @click=${() => this.#pending.set({ kind: 'reset' })}>${t('settings.data.reset')}</wa-button
        >
        <input
          type="file"
          accept="application/json,.json"
          hidden
          @change=${(event: Event) => {
            const input = event.target as HTMLInputElement;
            void this.#importFile(input.files?.[0]);
            input.value = '';
          }}
        />
      </div>
      <p class="efs-quiet">${t('settings.data.exportWarning')}</p>
      ${
        pending
          ? html`<wa-callout variant="warning">
              <span slot="icon">${appIcon('triangle-exclamation')}</span>
              <div class="wa-stack wa-gap-s">
                <p>${t(pending.kind === 'import' ? 'settings.data.import.confirm' : 'settings.data.reset.confirm')}</p>
                <div class="wa-cluster wa-gap-xs">
                  <wa-button size="s" variant="danger" @click=${() => this.#confirm()}
                    >${t(pending.kind === 'import' ? 'settings.data.import.replace' : 'settings.data.reset.confirmButton')}</wa-button
                  >
                  <wa-button size="s" appearance="outlined" @click=${() => this.#pending.set(undefined)}
                    >${t('settings.data.cancel')}</wa-button
                  >
                </div>
              </div>
            </wa-callout>`
          : nothing
      }
    </section>`;
  }

  #about() {
    const t = this.translator.t.bind(this.translator);
    const release = this.#release.get();
    const probeCount = Number(document.documentElement.dataset.efsProbeCount ?? 0);
    return html`<section class="wa-stack wa-gap-s" data-section="about">
      <h3 tabindex="-1">${t('settings.about.heading')}</h3>
      <dl class="wa-stack wa-gap-xs efs-about">
        <dt>${t('diag.profile')}</dt>
        <dd>${t('diag.profile.value', { count: probeCount })}</dd>
        <dt>${t('diag.language')}</dt>
        <dd><code translate="no">${this.translator.locale} (${this.translator.dir})</code></dd>
        <dt>${t('diag.release')}</dt>
        <dd>
          ${
            release.kind === 'ready'
              ? html`<p>${t('diag.release.digestLabel')}</p>
                  <p><code translate="no" dir="ltr" class="efs-digest">${release.digest}</code></p>
                  <p class="efs-quiet">${t('diag.release.caveat')}</p>
                  <p>${t('diag.commit')}</p>
                  <p><code translate="no" dir="ltr">${release.commit}</code></p>`
              : release.kind === 'unavailable'
                ? html`<p>${t('diag.release.unavailable')}</p>`
                : html`<p>${t('diag.release.loading')}</p>`
          }
        </dd>
      </dl>
    </section>`;
  }

  override render() {
    const t = this.translator.t.bind(this.translator);
    const notice = this.#notice.get();
    return html`<wa-drawer label=${t('settings.title')} placement="end" class="efs-settings">
      <div class="wa-stack wa-gap-xl">
        <p class="wa-visually-hidden" role="status" aria-live="polite">${notice ? t(notice) : ''}</p>
        ${
          notice && notice !== 'settings.save.saved'
            ? html`<wa-callout variant="warning"><span slot="icon">${appIcon('circle-info')}</span>${t(notice)}</wa-callout>`
            : nothing
        }
        ${this.#appearance()} <wa-divider></wa-divider> ${this.#network()} <wa-divider></wa-divider>
        ${this.#data()} <wa-divider></wa-divider> ${this.#about()}
      </div>
    </wa-drawer>`;
  }
}

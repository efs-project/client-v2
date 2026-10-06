import type { BootRoute } from '../boot/route.ts';
import { createScope, type OwnerScope } from '../platform/scope.ts';
import { effect } from '../state/effect.ts';
import { type ReadonlySignal, state } from '../state/signals.ts';
import type { MessageId, Translator } from '../ui/i18n.ts';

/** Internal to this app; attributes and properties here are not a public API. */
export interface FrameContext {
  readonly route: ReadonlySignal<BootRoute>;
  readonly translator: Translator;
  readonly probeCount: number;
}

type Child = Node | string;

function h(tag: string, props: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

type ReleaseState =
  | { readonly kind: 'idle' | 'loading' | 'unavailable' }
  | { readonly kind: 'ready'; readonly digest: string; readonly commit: string };

async function readRelease(signal: AbortSignal): Promise<ReleaseState> {
  const response = await fetch(new URL('release.json', document.baseURI), { signal });
  if (!response.ok) return { kind: 'unavailable' };
  const bytes = await response.arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const commit =
    typeof manifest === 'object' &&
    manifest !== null &&
    'source' in manifest &&
    typeof manifest.source === 'object' &&
    manifest.source !== null &&
    'commit' in manifest.source &&
    typeof manifest.source.commit === 'string'
      ? manifest.source.commit
      : '';
  return { kind: 'ready', digest, commit };
}

export class EfsViewerFrame extends HTMLElement {
  #scope: OwnerScope | undefined;

  mount(context: FrameContext): void {
    this.#scope?.dispose();
    const scope = createScope();
    this.#scope = scope;
    const { translator, route } = context;
    const t = (id: MessageId, values?: Record<string, string | number>) => translator.t(id, values);

    const main = h('main', { id: 'efs-main', tabindex: '-1' });
    const skip = h('a', { class: 'efs-skip', href: '#efs-main' }, t('frame.skipLink'));
    const onSkip = (event: Event) => {
      event.preventDefault();
      main.focus();
    };
    skip.addEventListener('click', onSkip);
    scope.defer(() => skip.removeEventListener('click', onSkip));

    const routeView = h('div', { class: 'efs-route' });
    effect(scope, () => {
      const current = route.get();
      if (current.kind === 'none') {
        routeView.replaceChildren(h('p', {}, t('frame.route.none')));
        return;
      }
      const parts: Child[] = [
        h('p', {}, t('frame.route.label')),
        h('p', {}, h('code', { translate: 'no', dir: 'ltr' }, current.raw)),
      ];
      if (current.truncated) parts.push(h('p', {}, t('frame.route.truncated')));
      routeView.replaceChildren(...parts);
    });

    main.append(h('h1', {}, t('frame.title')), h('p', {}, t('frame.intro')), routeView);

    const release = state<ReleaseState>({ kind: 'idle' });
    const releaseView = h('div', { class: 'efs-release' });
    effect(scope, () => {
      const current = release.get();
      if (current.kind === 'ready') {
        releaseView.replaceChildren(
          h('p', {}, t('diag.release.digestLabel')),
          h(
            'p',
            {},
            h('code', { translate: 'no', dir: 'ltr', class: 'efs-digest' }, current.digest),
          ),
          h('p', {}, t('diag.release.caveat')),
          h('p', {}, t('diag.commit')),
          h('p', {}, h('code', { translate: 'no', dir: 'ltr' }, current.commit)),
        );
      } else if (current.kind === 'unavailable') {
        releaseView.replaceChildren(h('p', {}, t('diag.release.unavailable')));
      } else if (current.kind === 'loading') {
        releaseView.replaceChildren(h('p', {}, t('diag.release.loading')));
      } else {
        releaseView.replaceChildren();
      }
    });

    const details = h(
      'details',
      { class: 'efs-diagnostics' },
      h('summary', {}, t('diag.summary')),
      h(
        'dl',
        {},
        h('dt', {}, t('diag.profile')),
        h('dd', {}, t('diag.profile.value', { count: context.probeCount })),
        h('dt', {}, t('diag.language')),
        h('dd', {}, h('code', { translate: 'no' }, `${translator.locale} (${translator.dir})`)),
        h('dt', {}, t('diag.release')),
        h('dd', {}, releaseView),
      ),
    );
    // The manifest is fetched only when someone asks for diagnostics.
    const onToggle = () => {
      if (!(details as HTMLDetailsElement).open || release.get().kind !== 'idle') return;
      release.set({ kind: 'loading' });
      readRelease(scope.signal).then(
        (result) => {
          if (!scope.signal.aborted) release.set(result);
        },
        () => {
          if (!scope.signal.aborted) release.set({ kind: 'unavailable' });
        },
      );
    };
    details.addEventListener('toggle', onToggle);
    scope.defer(() => details.removeEventListener('toggle', onToggle));

    const header = h(
      'header',
      { class: 'efs-bar' },
      h('span', { class: 'efs-wordmark', translate: 'no' }, 'EFS'),
    );
    const aside = h('aside', { class: 'efs-side' }, details);
    this.replaceChildren(skip, header, h('div', { class: 'efs-layout' }, main, aside));
  }

  disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
  }
}

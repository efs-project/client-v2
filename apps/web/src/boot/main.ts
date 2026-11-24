// Boot entry. Order: the classic probe has already checked the browser and painted the color
// scheme; here we read local settings and the operator's config, then mount the shell.
// Wallet-free. Writes nothing to storage unless the user saves a setting. Network: only this
// site's static files until an app reads through the selected RPC.

import '../ui/app.css';
import { APPS } from '../apps/registry.ts';
import { followSystemScheme, readMirroredAppearance } from '../platform/appearance.ts';
import { negotiateLocale } from '../platform/locale.ts';
import { createScope } from '../platform/scope.ts';
import { loadOperatorConfig } from '../platform/settings/config.ts';
import { DEFAULT_SETTINGS } from '../platform/settings/model.ts';
import { openSettingsStore } from '../platform/settings/store.ts';
import { registerShellElements } from '../shell/define.ts';
import { createOsState } from '../shell/os-state.ts';
import { createReaderSession } from '../shell/reader-state.ts';
import type { EfsShell } from '../shell/shell.ts';
import { computed } from '../state/signals.ts';
import { AVAILABLE_LOCALES, loadTranslator, PSEUDO_LOCALES, SOURCE_LOCALE } from '../ui/i18n.ts';
import { registerIconLibraries, watchIconSprite } from '../ui/wa/define.ts';
import { parseRoute } from './route.ts';

const root = document.documentElement;

function showUnsupported(reason: string): void {
  root.setAttribute('data-efs-unsupported', reason);
  document.querySelector('efs-shell')?.remove();
  document.getElementById('efs-boot')?.remove();
  const fallback = document.getElementById('efs-unsupported');
  if (fallback) fallback.hidden = false;
  const browserMessage = document.querySelector<HTMLElement>('.efs-unsupported-browser');
  if (browserMessage) browserMessage.hidden = true;
  // Reload this document; a link that differs only by fragment would not reload.
  document.querySelector('.efs-reload')?.setAttribute('href', location.href.split('#')[0] ?? './');
}

async function boot(): Promise<void> {
  if (root.hasAttribute('data-efs-unsupported')) return;
  registerIconLibraries();
  registerShellElements();
  const scope = createScope();
  void watchIconSprite(root, scope.signal);

  const locale = negotiateLocale(
    navigator.languages,
    AVAILABLE_LOCALES,
    PSEUDO_LOCALES,
    SOURCE_LOCALE,
  );
  const [translator, store, config] = await Promise.all([
    loadTranslator(locale),
    openSettingsStore(),
    loadOperatorConfig(document.baseURI, scope.signal),
  ]);
  const snapshot = await store.load().catch(() => undefined);
  const read = snapshot?.read;
  const settings =
    read && read.status !== 'INVALID'
      ? read.settings
      : {
          ...DEFAULT_SETTINGS,
          appearance: readMirroredAppearance() ?? DEFAULT_SETTINGS.appearance,
        };

  root.lang = translator.locale;
  root.dir = translator.dir;

  const os = createOsState(
    {
      store,
      settings,
      settingsInfo: {
        persistent: snapshot?.persistent ?? false,
        readOnly: read?.status === 'NEWER',
        issues: read?.status === 'OK' ? read.issues : read?.status === 'INVALID' ? read.issues : [],
      },
      config,
      route: parseRoute(new URL(location.href)),
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      root,
    },
    scope,
  );
  followSystemScheme(scope, (dark) => os.prefersDark.set(dark));
  const onHashChange = () => {
    // In-page anchors (#something, no leading slash) never change which app or location is open.
    if (location.hash.length > 1 && !location.hash.startsWith('#/')) return;
    os.route.set(parseRoute(new URL(location.href)));
  };
  addEventListener('hashchange', onHashChange);
  scope.defer(() => removeEventListener('hashchange', onHashChange));

  // A stylesheet or module that failed while boot was awaiting has already shown the fallback.
  if (root.hasAttribute('data-efs-unsupported')) {
    scope.dispose();
    return;
  }
  // Opens the SDK (a lazy chunk) only when a usable network is configured.
  const reader = createReaderSession(os.network, document.baseURI, scope, {
    publisherLocations: computed(() => os.settings.get().content.publisherLocations),
  });

  const shell = document.createElement('efs-shell') as EfsShell;
  shell.os = os;
  shell.reader = reader;
  shell.translator = translator;
  shell.apps = APPS;
  document.getElementById('efs-boot')?.replaceWith(shell);
  root.setAttribute('data-efs-booted', '');
}

boot().catch((error: unknown) => {
  showUnsupported('boot-failed');
  throw error;
});

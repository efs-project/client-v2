// Boot entry. Order: the classic probe has already checked the browser and painted the color
// scheme; here we read local settings and the operator's config, then mount the shell.
// Wallet-free. Writes nothing to storage unless the user saves a setting. Network: only this
// site's static files until an app reads through the selected RPC.

import '../ui/app.css';
import { APPS } from '../apps/registry.ts';
import { followSystemScheme, readMirroredAppearance } from '../platform/appearance.ts';
import { hostingOf } from '../platform/hosting.ts';
import { negotiateLocale } from '../platform/locale.ts';
import { createScope } from '../platform/scope.ts';
import { loadOperatorConfig } from '../platform/settings/config.ts';
import { DEFAULT_SETTINGS } from '../platform/settings/model.ts';
import { memorySettingsStore, openSettingsStore } from '../platform/settings/store.ts';
import { registerShellElements } from '../shell/define.ts';
import { createOsState } from '../shell/os-state.ts';
import { createReaderSession } from '../shell/reader-state.ts';
import { createSavesSession } from '../shell/saves-state.ts';
import type { EfsShell } from '../shell/shell.ts';
import { createWalletSession } from '../shell/wallet-state.ts';
import { createWriterSession } from '../shell/writer-state.ts';
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
  // A shared IPFS path gateway shares this origin with unrelated sites: nothing is stored there
  // (settings last for the tab), and saving is off. Decided from the address alone, before any
  // storage is opened.
  const sharedGateway = hostingOf(location).shared;
  const [translator, store, config] = await Promise.all([
    loadTranslator(locale),
    sharedGateway ? Promise.resolve(memorySettingsStore()) : openSettingsStore(),
    loadOperatorConfig(document.baseURI, scope.signal),
  ]);
  const delivery = config.status === 'OK' ? config.config.delivery : undefined;
  const hosting = hostingOf(location, delivery?.isolatedCopy);
  // Install metadata only on the operator's stable origin: an install anywhere else would be
  // tied to the wrong origin for good (docs/design/offline-brief.md §7).
  if (!hosting.shared && delivery?.stableOrigin === location.origin) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.webmanifest';
    document.head.append(manifest);
  }
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
        sharedGateway: hosting.shared,
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
  // Touches no wallet until the person clicks Connect.
  const wallet = createWalletSession(scope);
  shell.wallet = wallet;
  // Write code loads only when the person saves, or (wallet-free) when this browser has a save
  // to settle from an earlier visit.
  shell.writer = createWriterSession(reader.state, wallet.state, os.network, {
    sharedGateway: hosting.shared,
  });
  shell.saves = createSavesSession(reader.state, scope, { enabled: !hosting.shared });
  shell.hosting = hosting;
  shell.translator = translator;
  shell.apps = APPS;
  document.getElementById('efs-boot')?.replaceWith(shell);
  root.setAttribute('data-efs-booted', '');
  // Startup budget (tests/e2e/budgets.spec.ts): the shell is on screen.
  performance.mark('efs:booted');
}

boot().catch((error: unknown) => {
  showUnsupported('boot-failed');
  throw error;
});

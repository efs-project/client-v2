// Guest entry. Must stay wallet-free and network-free until an explicit action.
import '../ui/app.css';
import { negotiateLocale } from '../platform/locale.ts';
import { createScope } from '../platform/scope.ts';
import { registerViewerFrame } from '../shell/define.ts';
import type { EfsViewerFrame } from '../shell/viewer-frame.ts';
import { state } from '../state/signals.ts';
import { AVAILABLE_LOCALES, loadTranslator, PSEUDO_LOCALES, SOURCE_LOCALE } from '../ui/i18n.ts';
import { parseRoute } from './route.ts';

const root = document.documentElement;

function showUnsupported(reason: string): void {
  root.setAttribute('data-efs-unsupported', reason);
  document.querySelector('efs-viewer-frame')?.remove();
  const fallback = document.getElementById('efs-unsupported');
  if (fallback) fallback.hidden = false;
}

async function boot(): Promise<void> {
  if (root.hasAttribute('data-efs-unsupported')) return;
  registerViewerFrame();
  const scope = createScope();
  const route = state(parseRoute(new URL(location.href)));
  const onHashChange = () => route.set(parseRoute(new URL(location.href)));
  addEventListener('hashchange', onHashChange);
  scope.defer(() => removeEventListener('hashchange', onHashChange));

  const locale = negotiateLocale(
    navigator.languages,
    AVAILABLE_LOCALES,
    PSEUDO_LOCALES,
    SOURCE_LOCALE,
  );
  const translator = await loadTranslator(locale);
  root.lang = translator.locale;
  root.dir = translator.dir;

  const frame = document.createElement('efs-viewer-frame') as EfsViewerFrame;
  document.body.append(frame);
  frame.mount({ route, translator, probeCount: Number(root.dataset.efsProbeCount ?? 0) });

  // C2 seam: the pinned-context ReaderSession is created here, after config is
  // verified. Nothing in C0 contacts a network, a wallet or storage.
  root.setAttribute('data-efs-booted', '');
}

boot().catch((error: unknown) => {
  showUnsupported('boot-failed');
  throw error;
});

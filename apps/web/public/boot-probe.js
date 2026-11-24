/* Classic ES5 script: runs on engines that cannot parse the app's modules.
   Checks the Guest Reader profile and reveals the static fallback instead of
   leaving a blank or half-working page. Keep this list in step with
   docs/web-platform/feature-policy.md. */
(function () {
  var root = document.documentElement;
  var missing = [];
  var i;
  var checks = [
    [
      'module-scripts',
      function () {
        return 'noModule' in document.createElement('script');
      }
    ],
    [
      'custom-elements',
      function () {
        return !!window.customElements && typeof window.customElements.define === 'function';
      }
    ],
    [
      'abortsignal-any',
      function () {
        return typeof AbortSignal === 'function' && typeof AbortSignal.any === 'function';
      }
    ],
    [
      'intl-locale',
      function () {
        return typeof Intl === 'object' && typeof Intl.Locale === 'function';
      }
    ],
    [
      'nesting',
      function () {
        return CSS.supports('selector(&)');
      }
    ],
    [
      'cascade-layers',
      function () {
        return typeof window.CSSLayerBlockRule === 'function';
      }
    ],
    [
      'container-queries',
      function () {
        return CSS.supports('container-type: inline-size');
      }
    ],
    [
      'logical-properties',
      function () {
        return CSS.supports('margin-inline-start: 0');
      }
    ],
    [
      'viewport-unit-variants',
      function () {
        return CSS.supports('block-size: 100dvh');
      }
    ]
  ];
  for (i = 0; i < checks.length; i++) {
    try {
      if (!checks[i][1]()) missing.push(checks[i][0]);
    } catch (e) {
      missing.push(checks[i][0]);
    }
  }
  root.setAttribute('data-efs-probe-count', String(checks.length));

  // Pre-paint color scheme, mirroring src/platform/appearance.ts, so a dark system (or a saved
  // dark choice) never flashes light while modules load. IndexedDB settings stay the truth.
  (function () {
    var mode = 'system';
    var theme = 'cypher';
    var dark = false;
    var saved;
    try {
      saved = JSON.parse(window.localStorage.getItem('efs.appearance') || 'null');
      if (saved && (saved.mode === 'light' || saved.mode === 'dark')) mode = saved.mode;
      if (saved && (saved.theme === 'cypher' || saved.theme === 'paper')) theme = saved.theme;
    } catch (e) {}
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {}
    var scheme = mode === 'system' ? (dark ? 'dark' : 'light') : mode;
    var brand = theme === 'paper' ? 'indigo' : 'green';
    root.className +=
      ' wa-theme-default wa-palette-default wa-brand-' +
      brand +
      ' efs-theme-' +
      theme +
      ' wa-' +
      scheme;
    root.style.colorScheme = scheme;
  })();

  function reveal(reason) {
    if (root.hasAttribute('data-efs-unsupported')) return;
    root.setAttribute('data-efs-unsupported', reason);
    var show = function () {
      var el = document.getElementById('efs-unsupported');
      var browserIssue = reason.indexOf('missing:') === 0;
      var remove = ['efs-shell', '#efs-boot'];
      var hide, link, node, r;
      if (el) el.hidden = false;
      // Show only the message that applies; works even if the stylesheet itself failed.
      hide = document.querySelector(
        browserIssue ? '.efs-unsupported-load' : '.efs-unsupported-browser'
      );
      if (hide) hide.hidden = true;
      // Reload this document; a link that differs only by fragment would not reload.
      link = document.querySelector('.efs-reload');
      if (link) link.setAttribute('href', String(location.href).split('#')[0]);
      for (r = 0; r < remove.length; r++) {
        node = document.querySelector(remove[r]);
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  }

  if (missing.length) reveal('missing:' + missing.join(','));
  // A module that fails to parse or load before boot completes must not leave a blank page.
  window.addEventListener(
    'error',
    function () {
      if (!root.hasAttribute('data-efs-booted')) reveal('load-error');
    },
    true
  );
})();

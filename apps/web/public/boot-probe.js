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

  function reveal(reason) {
    if (root.hasAttribute('data-efs-unsupported')) return;
    root.setAttribute('data-efs-unsupported', reason);
    var show = function () {
      var el = document.getElementById('efs-unsupported');
      if (el) el.hidden = false;
      var frame = document.querySelector('efs-viewer-frame');
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
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

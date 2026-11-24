import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { provenance } from '../../tools/build/provenance.ts';

// Browser floor derived from web-features 3.40.0 for the features in
// docs/web-platform/feature-policy.md (CSS nesting and AbortSignal.any set it).
const TARGET = ['chrome120', 'edge120', 'firefox124', 'safari17.4'];

/**
 * sha256 of the one inline <style> Web Awesome's <wa-page> injects (its mobile breakpoint rules,
 * rendered through Lit's unsafeHTML for SSR). It depends on the Web Awesome version and on
 * `mobile-breakpoint` in shell.ts; tests/e2e/csp.spec.ts recomputes it from the live page and
 * fails with the new value when either changes.
 */
export const WA_PAGE_STYLE_HASH = 'sha256-5QexDz4MCAlG+maTPq7mDQOdrdkJYbAt6hIzY4FLazc=';
/**
 * sha256 of the one inline style attribute Web Awesome renders from markup: <wa-page>'s
 * `style="display: block; height: 0;"` on an empty measuring div. Allowed by exact value
 * ('unsafe-hashes' admits only attributes whose whole text hashes to this) so pages don't log a
 * CSP error on every load; every other inline style attribute stays blocked. Pinned by
 * tests/e2e/privacy-security.spec.ts.
 */
export const WA_PAGE_ATTR_HASH = 'sha256-U+fdpMMqJFUn3CaaOyX7RJpOZSW+QawBaw8v9AJwEVI=';

/** RPC and gateway endpoints are user-configurable, so connect-src is scheme-wide (https/wss),
 * plus plain http/ws on this computer only, matching platform/settings/model.ts checkEndpoint. */
const CONNECT_SRC = [
  "'self'",
  'https:',
  'wss:',
  ...['http', 'ws'].flatMap((scheme) =>
    ['localhost', '127.0.0.1', '*.localhost'].map((host) => `${scheme}://${host}:*`),
  ),
];

// Portable meta policy. Header-only directives (frame-ancestors, report-to) are
// hosting-profile items.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // 'report-sample' puts the offending text in violation reports, so tests can name it.
  `style-src 'self' '${WA_PAGE_STYLE_HASH}' 'report-sample'`,
  `style-src-attr 'unsafe-hashes' '${WA_PAGE_ATTR_HASH}' 'report-sample'`,
  // Web Awesome's native.css draws form-control glyphs with data: SVG images.
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${CONNECT_SRC.join(' ')}`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  // Lit's own policy (lit-html 3.x, pass-through). The default no-duplicates rule makes a second
  // Lit copy fail loudly; unsafeHTML/unsafeSVG are banned in our source (biome.json).
  'trusted-types lit-html',
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'efs-csp',
    apply: 'build',
    // Placed right after <meta charset> so it precedes every script.
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      ),
  };
}

const evidenceDir = fileURLToPath(new URL('./dist-evidence/', import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: 'hidden',
    target: TARGET,
  },
  worker: { format: 'es' },
  plugins: [contentSecurityPolicy(), provenance({ outFile: `${evidenceDir}provenance.json` })],
});

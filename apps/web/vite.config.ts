import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { provenance } from '../../tools/build/provenance.ts';

// Browser floor derived from web-features 3.40.0 for the features in
// docs/web-platform/feature-policy.md (CSS nesting and AbortSignal.any set it).
const TARGET = ['chrome120', 'edge120', 'firefox124', 'safari17.4'];

// Portable meta policy. Header-only directives (frame-ancestors, report-to) are
// hosting-profile items; connect-src widens in C2 (see c0-slice Flag 2).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
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

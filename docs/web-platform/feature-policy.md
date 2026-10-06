# Web feature policy

One row per web-platform feature the client **actually uses**. A PR that adds a feature adds its row, citing the primary spec, its status, and the guidance consulted (see `guidance.lock.json`). Support data: web-features 3.40.0.

**Guest Reader browser floor (C0):** Chrome/Edge 120, Firefox 124, Safari 17.4 (iOS 17.4). It's set by CSS nesting (Chrome 120) and `AbortSignal.any` (Firefox 124, Safari 17.4), and matches the Vite `build.target`. Browsers below the floor get the static "unsupported browser" message from `boot-probe.js`, never a half-working app.

| Feature (web-features id) | Primary spec | Status | Criticality | Profile disposition | Where used | Guidance |
|---|---|---|---|---|---|---|
| JS modules (`js-modules`) | HTML | Baseline high | required | Guest Reader: full; others: rescue message | entry | html/html |
| Autonomous custom elements (`autonomous-custom-elements`) | HTML | Baseline high | required | full; missing → rescue message | `efs-viewer-frame` | accessibility/accessibility (custom-element semantics) |
| `AbortSignal.any` (`abortsignal-any`) | DOM | Baseline high (2024-03) | required | full; missing → rescue message | `platform/scope.ts` | — (NO_GUIDANCE_MATCH) |
| `Intl.Locale` (`intl-locale`) | ECMA-402 | Baseline high | required | full | locale negotiation | js/* (no direct match) |
| `Intl.Locale` text info (`intl-locale-info`) | ECMA-402 | Baseline low (2026-07) | enhancement | used when present; RTL table fallback | `directionOf` | — |
| CSS nesting (`nesting`) | CSS Nesting | Baseline high (2023-12) | required | full; missing → rescue message | `app.css` | css/css |
| Cascade layers (`cascade-layers`) | CSS Cascade 5 | Baseline high | required | full | `app.css` | css/css |
| Container size queries (`container-queries`) | CSS Contain 3 | Baseline high | required | full | frame layout | css/size-aware-styling |
| Logical properties (`logical-properties`) | CSS Logical 1 | Baseline high | required | full | all layout | css/css (logical properties, with judgment) |
| Dynamic viewport units (`viewport-unit-variants`) | CSS Values 4 | Baseline high | required | full | frame `min-block-size` | css/css |
| Safe-area insets (`env()`) | CSS Env 1 | Baseline high | enhancement | ignored where absent | frame padding | — |
| `prefers-color-scheme` / `color-scheme` | Media Queries 5 / CSS Color Adjust | Baseline high | enhancement | light theme where absent | tokens | ui-atoms/component-specific-light-dark-theme |
| `forced-colors` | Media Queries 5 | Baseline high | enhancement | system colors | diagnostics border | accessibility/accessibility |
| `<details>`/`<summary>` (`details`) | HTML | Baseline high | required | full | diagnostics | html/html §5 (no headings in summary) |
| Web Crypto `digest` (`web-cryptography`) | WebCrypto | Baseline high | enhancement | secure contexts only; diagnostics says "unavailable" otherwise | diagnostics digest | — |
| CSP Level 3 via meta (`csp`) | CSP3 | Baseline high | required defense-in-depth | portable meta subset; header-only directives are hosting items | `index.html` | security/security |
| Trusted Types (`trusted-types`) | Trusted Types | Baseline low (2026-02) | enhancement (required-forward in the spec set) | enforced where supported (Chromium 83+, Firefox 148+, Safari 26+) | `index.html` CSP | security/security §1.2 |

Features deliberately **not** used in C0: Service Worker, Web App Manifest, storage APIs (all deferred, see the C0 slice), Navigation API, View Transitions, Popover, `light-dark()` (above the floor), `@scope` (not needed yet).

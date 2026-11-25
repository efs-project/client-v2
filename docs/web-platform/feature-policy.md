# Web feature policy

One row per web-platform feature the client **actually uses**. A PR that adds a feature adds its row, citing the primary spec, its status, and the guidance consulted (see `guidance.lock.json`). Support data: web-features 3.40.0.

**Guest Reader browser floor (C0):** Chrome/Edge 120, Firefox 124, Safari 17.4 (iOS 17.4). It's set by CSS nesting (Chrome 120) and `AbortSignal.any` (Firefox 124, Safari 17.4), and matches the Vite `build.target`. Browsers below the floor get the static "unsupported browser" message from `boot-probe.js`, never a half-working app.

| Feature (web-features id) | Primary spec | Status | Criticality | Profile disposition | Where used | Guidance |
|---|---|---|---|---|---|---|
| JS modules (`js-modules`) | HTML | Baseline high | required | Guest Reader: full; others: rescue message | entry | html/html |
| Autonomous custom elements (`autonomous-custom-elements`) | HTML | Baseline high | required | full; missing → rescue message | `efs-*` (shell, panes, settings) and Web Awesome's `wa-*` | accessibility/accessibility (custom-element semantics) |
| Shadow DOM, constructable stylesheets (`shadow-dom`, `constructed-stylesheets`) | DOM / CSSOM | Baseline high | required | full | Web Awesome components (Lit) | — |
| CSS shadow parts (`css-shadow-parts`) | CSS Shadow Parts | Baseline high | enhancement | full | `::part()` fixes for Web Awesome (`app.css`) | css/css |
| Form-associated custom elements (`form-associated-custom-elements`) | HTML | Baseline high (2023-03) | required | full | Web Awesome inputs, selects, switches, radios | accessibility/accessibility |
| Custom element states (`custom-state-pseudo-class`) | HTML | Baseline low (2024-05) | enhancement | Web Awesome guards it; styling degrades | Web Awesome internals | — |
| `AbortSignal.any` (`abortsignal-any`) | DOM | Baseline high (2024-03) | required | full; missing → rescue message | `platform/scope.ts` | — (NO_GUIDANCE_MATCH) |
| `Intl.Locale` (`intl-locale`) | ECMA-402 | Baseline high | required | full | locale negotiation | js/* (no direct match) |
| `Intl.Locale` text info (`intl-locale-info`) | ECMA-402 | Baseline low (2026-07) | enhancement | used when present; RTL table fallback | `directionOf` | — |
| CSS nesting (`nesting`) | CSS Nesting | Baseline high (2023-12) | required | full; missing → rescue message | `app.css` | css/css |
| Cascade layers (`cascade-layers`) | CSS Cascade 5 | Baseline high | required | full | `app.css` | css/css |
| Container size queries (`container-queries`) | CSS Contain 3 | Baseline high | required | full | `main` (panes), named `efs-header` container (indicator text) | css/size-aware-styling |
| `:has()` (`has`) | Selectors 4 | Baseline high (2023-12) | enhancement | icon fallback only | `[data-efs-icons='missing']` rules | css/css |
| `color-mix()` (`color-mix`) | CSS Color 5 | Baseline high | required | full | Web Awesome theme tokens | css/css |
| `ResizeObserver` (`resize-observer`) | Resize Observer | Baseline high | required | full | pane host (split panels vs tabs); `<wa-page>` | — |
| `<dialog>` (`dialog`) | HTML | Baseline high | required | full | `<wa-drawer>` (settings, mobile navigation) | html/html |
| Logical properties (`logical-properties`) | CSS Logical 1 | Baseline high | required | full | all layout | css/css (logical properties, with judgment) |
| Dynamic viewport units (`viewport-unit-variants`) | CSS Values 4 | Baseline high | required | full | `main` `min-block-size` | css/css |
| Safe-area insets (`env()`) | CSS Env 1 | Baseline high | enhancement | ignored where absent | page and header padding (`viewport-fit=cover`) | — |
| `prefers-color-scheme` / `color-scheme` (`prefers-color-scheme`, `color-scheme`) | Media Queries 5 / CSS Color Adjust | Baseline high | enhancement | light where absent | `wa-light`/`wa-dark` follow it live (`matchMedia` change events) unless the user picks a mode | ui-atoms/component-specific-light-dark-theme |
| `prefers-contrast: more` (`prefers-contrast`) | Media Queries 5 | Baseline low | enhancement | the theme's normal contrast where unsupported | quiet text and borders take the normal text color, thicker focus ring (`efs-themes.css`) | accessibility/accessibility |
| `prefers-reduced-transparency` (`prefers-reduced-transparency`) | Media Queries 5 | limited (Chromium) | enhancement | translucent overlays where unsupported | dialog and drawer overlays become solid (`efs-themes.css`) | accessibility/accessibility |
| User Timing marks (`user-timing`) | User Timing 3 | Baseline high | test-only measurement | — | `efs:booted`, `efs:preview-verified`, read by `tests/e2e/budgets.spec.ts` | performance/* |
| `forced-colors` | Media Queries 5 | Baseline high | enhancement | system colors | theme overrides (`efs-themes.css`) | accessibility/accessibility |
| Web Crypto `digest` (`web-cryptography`) | WebCrypto | Baseline high | enhancement | secure contexts only; Settings → About says "unavailable" otherwise | release digest | — |
| IndexedDB (`indexeddb`) | IndexedDB 3 | Baseline high | enhancement | in-memory settings for the tab where refused | user settings, opened without creating it on read | — |
| IndexedDB for the SDK's save journal (`indexeddb`) | IndexedDB 3 | Baseline high | required for saving; reads never need it | where refused (some private windows) saving is off and says so (`JOURNAL_UNAVAILABLE`); reading is unaffected | `efs-sdk-journal`, via `@efs/sdk/web/journal`: a non-creating "is anything open?" check on every verified session, created only at the first real submission | — |
| EIP-6963 wallet discovery (window `CustomEvent`s; `customevent`) | EIP-6963 (Final ERC); DOM | Baseline high (events) | enhancement (writes only) | none found → "No wallet was found"; a lone injected `window.ethereum` is used when no wallet announces | `platform/wallet/discovery.ts`, only after a Connect click; announcements are untrusted input (validated, name capped, icon only as a `data:image` in an `<img>`) | security/security |
| EIP-1193 provider requests | EIP-1193 (Final ERC) | — (wallet-provided) | required for saving | 4001 refused, -32002 pending, 4902 unknown chain are named to the person | `platform/wallet/connect.ts`; the SDK writer's `eth_sendTransaction` | — (NO_GUIDANCE_MATCH) |
| EIP-5792 atomic batches (`wallet_getCapabilities`, `wallet_sendCalls`) | EIP-5792 (ERC) | — (wallet-provided) | enhancement | part by part (one approval each) where absent | the SDK decides for saves of 2+ parts (`batch: "auto"`); the client never calls it directly | — (NO_GUIDANCE_MATCH) |
| Web App Manifest (`web-app-manifest`) | Web App Manifest (W3C) | Baseline: partial (install varies by browser) | enhancement | linked only on the operator's `delivery.stableOrigin`; elsewhere absent, so no install binds to the wrong origin | `public/manifest.webmanifest` (fixed `id` `/`; `start_url` and `scope` `./`), linked by `boot/main.ts` | html/html |
| Blob URLs for media (`blob-urls`), CSP `img-src blob:` / `media-src blob:` | File API / CSP3 | Baseline high | enhancement | "Save a copy" where blocked | Preview: `blob:` URLs only from VERIFIED bytes, revoked when the read is replaced (`apps/files/preview.ts`) | security/security |
| Native `<img>`, `<audio>`, `<video>` (`audio`, `video`) | HTML | Baseline high | enhancement | "can't show or play this file", then Save a copy | Preview media, chosen by the bytes' signature (`apps/files/media.ts`); SVG only through `<img>` | html/html |
| `<textarea>` (`textarea`) | HTML | Baseline high | required for editing | full | the file editor (native control, styled by Web Awesome's `native.css`; no `wa-textarea` in startup) | accessibility/accessibility |
| `BroadcastChannel` (`broadcast-channel`) | HTML | Baseline high (2022-03) | enhancement | other tabs see changes on reload where absent | settings change notice between tabs | — |
| `localStorage` (`localstorage`) | HTML | Baseline high | enhancement | first paint follows the system where blocked | appearance mirror read by the boot probe (written only when the user saves) | — |
| `structuredClone` (`structured-clone`) | HTML | Baseline high (2022-03) | required | full | in-memory settings store | — |
| SVG `<use>` same-origin sprite (`svg`) | SVG 2 | Baseline high | enhancement | text labels when the sprite fails | `<wa-icon>` sprite-sheet mode | — |
| Data URL images | Fetch / CSP `img-src data:` | Baseline high | enhancement | form glyphs (and wallet icons) missing where blocked | Web Awesome `native.css`; wallet icons from EIP-6963 announcements | security/security |
| Blob URLs + `a[download]`, `<input type=file>` + `Blob.text()` (`download`, `blob-text`) | HTML / File API | Baseline high | enhancement | — | settings export and import | — |
| CSP Level 3 via meta (`csp`), incl. `style-src-attr` + `'unsafe-hashes'` | CSP3 | Baseline high | required defense-in-depth | portable meta subset; header-only directives are hosting items. A browser that doesn't apply `'unsafe-hashes'` to style attributes blocks one harmless Web Awesome attribute | `index.html` (see `docs/design/shell.md`) | security/security |
| Trusted Types (`trusted-types`) | Trusted Types | Baseline low (2026-02) | enhancement (required-forward in the spec set) | enforced where supported (Chromium 83+, Firefox 148+, Safari 26+) | `index.html` CSP | security/security §1.2 |

**Library:** Web Awesome 3.15.0 (free components only, MIT; icons Font Awesome Free, CC BY 4.0). Loaded and themed only through `apps/web/src/ui/wa/`. Consult its two release-matched skills in the installed package (`dist/skills/webawesome`, `dist/skills/webawesome-design`), never a floating copy.

Features deliberately **not** used yet: Service Worker, Web App Manifest, Navigation API, View Transitions, Popover (Web Awesome positions its own popups), `light-dark()`, `@scope`.

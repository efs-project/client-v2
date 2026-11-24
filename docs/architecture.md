# Architecture (C0 + slice A)

This is the smallest structure that keeps the Web OS direction open. The full design lives in the EFS planning vault (web-client-os design set); this page covers what exists in this repository.

## Layout

```text
apps/web/            static SPA (the only thing that ships)
  index.html         CSP (injected at build), classic boot-probe.js, module entry
  public/boot-probe.js  ES5 feature probe + no-blank-page fallback
  public/efs.config.json  operator networks (efs-config/1); ships empty, replaced per deployment
  public/icons/      generated icon sprite (pnpm icons)
  src/boot/          main.ts (guest entry), route.ts (internal, unfrozen #/<app>/<rest> route)
  src/state/         signals.ts (sole Signals import), effect.ts (scope-owned effects)
  src/platform/      scope, locale, appearance, settings/ (model, IndexedDB store, operator config)
                     no Lit or Web Awesome here (Biome-enforced)
  src/shell/         efs-shell (<wa-page>), pane host, settings panel, endpoint list,
                     network indicator, os-state (per-tab state), apps.ts (app contract)
  src/apps/          registry.ts; files/ (the File Browser: lazy entry, views)
  src/ui/            element.ts (EfsElement), wa/ (the only Web Awesome imports, themes),
                     icons.ts, outcome.ts, app.css, i18n.ts, messages/*.json
tools/               Node-only: build checks, provenance plugin, static server
tests/e2e/           Playwright suite against the built artifact
```

## Rules that keep later work cheap

- **Guest path.** No wallet or Service Worker during guest boot; it reads the settings record and `efs.config.json`, writes nothing until the user saves a setting, and requests only its own static files. Checked in the browser (`tests/e2e/guest-boot.spec.ts`, `privacy-security.spec.ts`) and on the output (`tools/build/check-graph.ts`, which also gates the 250 KiB startup budget). Shell design: `docs/design/shell.md`.
- **No Kernel object, no ambient authority.** There is no module-level account, network or provider. Module evaluation does no I/O (`tools/checks/source-rules.test.ts`).
- **Registration is explicit.** Only `define.ts` files may call `customElements.define` (only `efs-*` names), and only entry modules may import them.
- **SDK owns protocol semantics.** `viem`, `ethers` and codecs are banned in `apps/web` (Biome). From C2 the client talks to EFS through the SDK only.
- **Plain data at boundaries.** Signals and element instances never go into storage, messages or public interfaces.
- **Imports stay inside `apps/web/src`.** Tools and tests can't be imported; `node:*` can't be imported.

## Seams reserved for later slices

| Later | Where it plugs in |
|---|---|
| Reader session (C2: the SDK's first reads) | the File Browser's lazy entry (`apps/files/entry.ts`), given the effective network from `os-state` |
| Write slice, wallet, action review (C3) | a lazy `features/files/write/entry.ts` (already an allowed entry in the source rules) |
| Service Worker, manifest, rescue, upgrades (R) | nothing registered today; `release.json` identity is independent of hosting CIDs |
| Dev supervisor, chain, gateway (C1) | `tools/dev/`; never importable from `apps/web` |

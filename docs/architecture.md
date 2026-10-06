# Architecture (C0)

This is the smallest structure that keeps the Web OS direction open. The full design lives in the EFS planning vault (web-client-os design set); this page covers what exists in this repository.

## Layout

```text
apps/web/            static SPA (the only thing that ships)
  index.html         CSP (injected at build), classic boot-probe.js, module entry
  public/boot-probe.js  ES5 feature probe + no-blank-page fallback
  src/boot/          main.ts (guest entry), route.ts (internal, unfrozen route value)
  src/state/         signals.ts (sole Signals import), effect.ts (scope-owned effects)
  src/platform/      scope.ts (OwnerScope lifecycle), locale.ts (negotiation, direction)
  src/shell/         viewer-frame.ts (efs-viewer-frame), define.ts (registration)
  src/ui/            app.css (tokens/layers), i18n.ts, messages/*.json
tools/               Node-only: build checks, provenance plugin, static server
tests/e2e/           Playwright suite against the built artifact
```

## Rules that keep later work cheap

- **Guest path.** No wallet, storage, network (beyond the static files), Service Worker or OS service during guest boot. Checked in the browser (`tests/e2e/guest-boot.spec.ts`) and on the output (`tools/build/check-graph.ts`).
- **No Kernel object, no ambient authority.** There is no module-level account, network or provider. Module evaluation does no I/O (`tools/checks/source-rules.test.ts`).
- **Registration is explicit.** Only `define.ts` files may call `customElements.define` (only `efs-*` names), and only entry modules may import them.
- **SDK owns protocol semantics.** `viem`, `ethers` and codecs are banned in `apps/web` (Biome). From C2 the client talks to EFS through the SDK only.
- **Plain data at boundaries.** Signals and element instances never go into storage, messages or public interfaces.
- **Imports stay inside `apps/web/src`.** Tools and tests can't be imported; `node:*` can't be imported.

## Seams reserved for later slices

| Later | Where it plugs in |
|---|---|
| Reader session + `efs.config.json` (C2) | `boot/main.ts`, marked `C2 seam` |
| Write slice, wallet, action review (C3) | a lazy `features/files/write/entry.ts` (already an allowed entry in the source rules) |
| Service Worker, manifest, rescue, upgrades (R) | nothing registered today; `release.json` identity is independent of hosting CIDs |
| Dev supervisor, chain, gateway (C1) | `tools/dev/`; never importable from `apps/web` |

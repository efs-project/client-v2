# ADR 0002: OS shell on Web Awesome, Lit and Signals (slice A)

**Status:** proposed with slice A (2026-11-24), for review by the M1 integration owner.
**Supersedes:** in ADR 0001, "Lit and Web Awesome are reserved for lazy write/settings slices".
**Context:** owner direction of 2026-11-24 (relayed by the integration owner): the client is an OS whose first app is the File Browser, built web-native on Web Awesome, Lit and Signals only, with system-following themes, mobile support and user-configurable RPC endpoints, hostable anywhere. Design: `docs/design/shell.md`.

## Decision

1. **Web Awesome 3.15 (free components) is the component library and the theme system.** It renders the shell from the first paint, so Lit, `@lit-labs/signals` and Web Awesome move into the startup set. The 250 KiB brotli startup budget becomes a failing gate; slice A measures 118,363 B (C0: 13,615 B).
2. **The guest boot rule changes** (aligned with system-profiles' "NetworkBootstrap reads LocalSelectionState"):
   - before: "Guest boot stays wallet-free, storage-free and network-free apart from its own static files";
   - after: "Guest boot is wallet-free. It reads only the settings record and the operator's `efs.config.json`, writes nothing to storage unless the user saves a setting, and contacts the network only through the selected RPC and gateways."
3. **Settings** live in IndexedDB (`efs-settings/1`), opened without creating it on read, written with compare-and-set on a revision, newer schemas read-only. Operator networks come from a static `efs.config.json` (`efs-config/1`) shipped beside `index.html`; the build ships one with no networks.
4. **CSP stays strict, with three named exceptions**, each pinned by e2e: `connect-src https: wss:` plus loopback (user-chosen RPCs); two exact `sha256` hashes for the only inline styles Web Awesome renders from markup (one `<style>`, one `style` attribute via `'unsafe-hashes'`); `img-src data:` for Web Awesome's form glyphs. `script-src 'self'` and enforced Trusted Types (`trusted-types lit-html`, Lit's own pass-through policy) are unchanged in spirit; `unsafeHTML`/`unsafeSVG` are banned in source.
5. **Icons** use Web Awesome's sprite-sheet mode against one generated same-origin sprite, because its default mode needs `innerHTML`.

## Consequences

- A Web Awesome upgrade can change the two style hashes; the CSP e2e test fails with the new values. Dependabot PRs for Web Awesome need that update and a re-read of its release-matched skills.
- Web Awesome registers its `wa-*` elements when its modules evaluate, before the support probe's result is checked. On an unsupported browser the static message still shows and none of our code runs, but `wa-*` definitions happen (and a browser without custom elements throws once).
- `wa-markdown`, `wa-include` and string toast helpers are unusable under the policy; markdown needs our own Trusted-Types-safe renderer.
- The UI-library boundary holds where it matters for longevity: `platform/` and `state/` never import Lit or Web Awesome (Biome-enforced), so settings, appearance, routing and outcomes survive a component-library change.

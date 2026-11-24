# AGENTS.md

The EFS v2 web client: a static, IPFS-hostable SPA that grows into a modular Web OS. This file is for humans and agents alike. Keep it short and accurate.

## Status

**C0 (foundation) + slice A (OS shell).** The repo builds, statically hosts, localizes and tests the OS shell: `<wa-page>` layout, the File Browser as its first app (placeholder panes), settings (appearance, per-network RPC and gateway lists, export/import), themes, CSP and Trusted Types. It does not yet read EFS, connect wallets or run a dev chain; those slices need a separate go-ahead. Design: `docs/design/shell.md`. The plan and slice definitions live in the EFS planning vault: `Reviews/2026-09-26-client-v2-initialization-plan/`.

## Setup and commands

Requires Node 24 (`.node-version`) and pnpm 12.6.0 (`packageManager`). Corepack 0.34 can't launch pnpm 12, so install it directly: `npm i -g pnpm@12.6.0`.

| Command | What it does |
|---|---|
| `pnpm install` | Frozen, supply-chain-checked install (1-day minimum release age; no install scripts allowed) |
| `pnpm bootstrap` | Installs Playwright's Chromium, Firefox and WebKit |
| `pnpm check` | Biome, typecheck (browser and Node configs), message catalogs, unit and source-rule tests |
| `pnpm build` | Builds `apps/web/dist` and runs every output check (see below) |
| `pnpm build:repro` | Builds twice and fails unless every shipped byte matches |
| `pnpm test:e2e` | Playwright against the **built** output, at `/` and under a deep prefix |
| `pnpm preview:static` | Serves `apps/web/dist` as plain files (`--prefix /x/y/` to test path hosting) |
| `pnpm messages` | Regenerates the pseudo-locale catalogs after editing `en.json` |
| `pnpm icons` | Regenerates the icon sprite and its typed ids after editing `APP_ICONS` in `tools/build/icons.ts` |

`pnpm build` fails on any of these:
- a forbidden module in the guest startup set (Ethereum libraries, write/wallet/storage paths);
- a startup set over 250 KiB brotli (HTML, probe, startup JS and CSS, icon sprite);
- an icon sprite or message catalog out of date;
- a non-literal `import()`;
- more than one Signals chunk;
- dev keys or admin RPC names in shipped files;
- an unknown license (including the Font Awesome icons shipped in the sprite);
- a script not accounted for by module provenance.

Evidence goes to `apps/web/dist-evidence/`.

## Rules

1. **Guest boot is wallet-free.** It reads only the settings record and the operator's `efs.config.json`, writes nothing to storage unless the user saves a setting, and contacts the network only through the selected RPC and gateways (today: nothing beyond its own static files). Don't import wallet or write code from anything `boot/main.ts` reaches. *(Changed in slice A from "storage-free and network-free apart from its own static files"; see `docs/design/shell.md`.)*
2. **No Kernel singleton, no ambient authority.** Create things in an entry or composition step and pass them explicitly. Module evaluation must do no I/O; `tools/checks/source-rules.test.ts` enforces this.
3. **Custom elements are registered only in `define.ts`** (`efs-*` names), imported only by entry modules (`boot/main.ts`, `apps/*/entry.ts`). Web Awesome's `wa-*` elements are registered by importing their modules in `ui/wa/define.ts`.
4. **Protocol semantics belong to the EFS SDK.** Never decode records, compute IDs, walk pages or treat a wallet acknowledgement as success here. `viem` and `ethers` are banned in `apps/web`.
5. **Signals come only through `src/state/signals.ts`.** Side effects run in `effect(scope, …)` owned by an `OwnerScope`.
6. **Every visible string comes from `src/ui/messages/en.json`** (MF2, narrow contract). Data values render in `translate="no"` elements. Use logical CSS (safe-area insets are the one physical exception). Run `pnpm messages` after editing. MF2 wraps arguments in bidi isolates, so tests match names containing arguments by pattern, not exactly.
7. **Accessibility is a requirement.** Use semantic HTML before ARIA, keep focus visible, target at least 24×24 px, and allow no horizontal scroll at 320 px. axe is a smoke test, not conformance.
8. **Relative URLs only.** The build must work under any path prefix and from any static host. No CDN, remote font or remote module.
9. **Web platform changes need evidence.** Consult the pinned guidance in `docs/web-platform/guidance.lock.json`, add or update the row in `docs/web-platform/feature-policy.md`, and fill in the PR template's evidence line (or write `NO_WEB_SURFACE_CHANGE`).
10. **Web Awesome (3.15, free components) is the component library and theme system.** Load both release-matched skills from the installed package (`apps/web/node_modules/@awesome.me/webawesome/dist/skills/webawesome` and `…/webawesome-design`) before UI work. Import it only through `src/ui/wa/`; theme only with `--wa-*` overrides in `ui/wa/efs-themes.css`. It is startup code. Under our Trusted Types policy never use `unsafeHTML`/`unsafeSVG` (banned), `wa-markdown` or `wa-include`. Icons go through `appIcon()` and the generated sprite; add new ones to `APP_ICONS` and run `pnpm icons`.

## Don'ts

- Don't add dependencies, `allowBuilds` entries or Vite plugins without saying why in the PR.
- Don't add a Service Worker, manifest, public link format, or storage beyond the user's settings record; those are deliberately deferred. Remote requests go only through the SDK to endpoints the user can see in Settings.
- Don't widen the CSP. If something needs it, say why in the PR (`docs/design/shell.md` lists every exception and its reason).
- Don't guess a dev server URL or kill processes by port. (C1 adds owned dev instances.)

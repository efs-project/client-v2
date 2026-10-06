# AGENTS.md

The EFS v2 web client: a static, IPFS-hostable SPA that grows into a modular Web OS. This file is for humans and agents alike. Keep it short and accurate.

## Status

**C0 (foundation) only.** The repo builds, statically hosts, localizes and tests an empty frame. It does not yet read EFS, connect wallets, store anything or run a dev chain. Later slices (C1 dev environment, C2 guest reads, C3 writes) need a separate go-ahead. The plan and slice definitions live in the EFS planning vault: `Reviews/2026-09-26-client-v2-initialization-plan/`.

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

`pnpm build` fails on any of these:
- a forbidden module in the guest startup set;
- a non-literal `import()`;
- more than one Signals chunk;
- dev keys or admin RPC names in shipped files;
- an unknown license;
- a script not accounted for by module provenance.

Evidence goes to `apps/web/dist-evidence/`.

## Rules

1. **Guest boot stays wallet-free, storage-free and network-free** apart from its own static files. Don't import wallet, storage or OS code from anything `boot/main.ts` reaches.
2. **No Kernel singleton, no ambient authority.** Create things in an entry or composition step and pass them explicitly. Module evaluation must do no I/O; `tools/checks/source-rules.test.ts` enforces this.
3. **Custom elements are registered only in `define.ts`** (`efs-*` names), imported only by entry modules.
4. **Protocol semantics belong to the EFS SDK.** Never decode records, compute IDs, walk pages or treat a wallet acknowledgement as success here. `viem` and `ethers` are banned in `apps/web`.
5. **Signals come only through `src/state/signals.ts`.** Side effects run in `effect(scope, …)` owned by an `OwnerScope`.
6. **Every visible string comes from `src/ui/messages/en.json`** (MF2, narrow contract). Data values render in `translate="no"` elements. Use logical CSS. Run `pnpm messages` after editing.
7. **Accessibility is a requirement.** Use semantic HTML before ARIA, keep focus visible, target at least 24×24 px, and allow no horizontal scroll at 320 px. axe is a smoke test, not conformance.
8. **Relative URLs only.** The build must work under any path prefix and from any static host. No CDN, remote font or remote module.
9. **Web platform changes need evidence.** Consult the pinned guidance in `docs/web-platform/guidance.lock.json`, add or update the row in `docs/web-platform/feature-policy.md`, and fill in the PR template's evidence line (or write `NO_WEB_SURFACE_CHANGE`).
10. **Web Awesome is not installed yet.** When a later slice adds it, load both release-matched skills from the installed package (`node_modules/@awesome.me/webawesome/dist/skills/webawesome` and `…/webawesome-design`), keep it to lazy chunks, and import it only through `src/ui/wa/`.

## Don'ts

- Don't add dependencies, `allowBuilds` entries or Vite plugins without saying why in the PR.
- Don't add a Service Worker, manifest, storage, remote requests or a public link format; those are deliberately deferred.
- Don't guess a dev server URL or kill processes by port. (C1 adds owned dev instances.)

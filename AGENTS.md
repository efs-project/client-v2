# AGENTS.md

The EFS v2 web client: a static, IPFS-hostable SPA that grows into a modular Web OS. This file is for humans and agents alike. Keep it short and accurate.

## Status

**C0 (foundation) + slice A (OS shell) + slice B (verified reads) + slice C (write foundation).** The repo builds, statically hosts, localizes and tests the OS shell: `<wa-page>` layout, the File Browser as its first app, settings (appearance, per-network RPC and gateway lists, export/import), themes, CSP and Trusted Types. Through the EFS SDK it pins the deployment and previews files opened by object and revision links (`#/r/<realm>/…`). It connects a wallet only on click (EIP-6963), edits text files from the Preview (review, one approval), and carries saves to "Saved" in the page banner, across reloads and wallet-free on start. An unsaved edit stays in the tab's memory while the person moves around the app, and is discarded only after asking. It lists folders from the realm's shared root (a folder's link is its object link, routed through `openObject`, so it survives a reload), creates folders, and renames, moves, removes and restores the person's own entries (with "Show removed" to find them again), through the same review and banner, and writes new text files in the editor. It does not yet upload files. Design: `docs/design/shell.md`, `docs/design/reads.md`, `docs/design/writes.md`, `docs/design/file-operations.md`. The plan and slice definitions live in the EFS planning vault: `Reviews/2026-09-26-client-v2-initialization-plan/`.

## Setup and commands

Requires Node 24 (`.node-version`) and pnpm 12.6.0 (`packageManager`). Corepack 0.34 can't launch pnpm 12, so install it directly: `npm i -g pnpm@12.6.0`.

The EFS SDK has no public release yet, so `vendor/` holds its packed tarballs (`@efs/sdk`, and `@efs/fixture` for the live-chain tests), pinned by integrity in the lockfile. `vendor/README.md` says where it came from and how to bump it.

| Command | What it does |
|---|---|
| `pnpm install` | Frozen, supply-chain-checked install (1-day minimum release age; no install scripts allowed) |
| `pnpm dev` | This worktree's own local EFS: an `@efs/fixture` chain (needs `anvil`) plus Vite, with a generated config pointing at it. Prints the app URL, wallet settings and an "Edit me" link. `dev:status`, `dev:stop` and `dev:reset` act only on this worktree's `.efs-dev/` |
| `pnpm bootstrap` | Installs Playwright's Chromium, Firefox and WebKit |
| `pnpm check` | Biome, typecheck (browser and Node configs), message catalogs, unit and source-rule tests |
| `pnpm build` | Builds `apps/web/dist` and runs every output check (see below) |
| `pnpm build:repro` | Builds twice and fails unless every shipped byte matches |
| `pnpm test:e2e` | Playwright against the **built** output, at `/` and under a deep prefix |
| `pnpm test:e2e:live` | The write tests against a fresh `@efs/fixture` chain (needs `anvil` 1.8.3 on PATH, or `ANVIL_PATH`) |
| `pnpm transcripts:record` | Re-records the write tests' transcripts from a live chain (never edit them by hand; see `docs/design/writes.md`) |
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

1. **Guest boot is wallet-free.** It reads only the settings record and the operator's `efs.config.json`, writes nothing to storage unless the user saves a setting (and never on a shared IPFS path gateway), and contacts the network only through the selected RPC and gateways (today: nothing beyond its own static files). Don't import wallet or write code from anything `boot/main.ts` reaches. *(Changed in slice A from "storage-free and network-free apart from its own static files"; see `docs/design/shell.md`.)*
2. **No Kernel singleton, no ambient authority.** Create things in an entry or composition step and pass them explicitly. Module evaluation must do no I/O; `tools/checks/source-rules.test.ts` enforces this.
3. **Custom elements are registered only in `define.ts`** (`efs-*` names), imported only by entry modules (`boot/main.ts`, `apps/*/entry.ts`). Web Awesome's `wa-*` elements are registered by importing their modules in `ui/wa/define.ts`.
4. **Protocol semantics belong to the EFS SDK.** Never decode records, compute IDs, walk pages, build or parse links, or treat a wallet acknowledgement as success here. `viem` and `ethers` are banned in `apps/web`. Only `session/reader.ts` creates an SDK instance, and the SDK core stays out of the startup set (reads load it lazily).
5. **Signals come only through `src/state/signals.ts`.** Side effects run in `effect(scope, …)` owned by an `OwnerScope`.
6. **Every visible string comes from `src/ui/messages/en.json`** (MF2, narrow contract). Data values render in `translate="no"` elements. Use logical CSS (safe-area insets are the one physical exception). Run `pnpm messages` after editing. MF2 wraps arguments in bidi isolates, so tests match names containing arguments by pattern, not exactly.
7. **Accessibility is a requirement.** Use semantic HTML before ARIA, keep focus visible, target at least 24×24 px, and allow no horizontal scroll at 320 px. axe is a smoke test, not conformance.
8. **Relative URLs only.** The build must work under any path prefix and from any static host. No CDN, remote font or remote module.
9. **Web platform changes need evidence.** Consult the pinned guidance in `docs/web-platform/guidance.lock.json`, add or update the row in `docs/web-platform/feature-policy.md`, and give the evidence line (`.github/pull_request_template.md`'s, or `NO_WEB_SURFACE_CHANGE`) in the PR, or in the commit message when there's no PR.
10. **Web Awesome (3.15, free components) is the component library and theme system.** Load both release-matched skills from the installed package (`apps/web/node_modules/@awesome.me/webawesome/dist/skills/webawesome` and `…/webawesome-design`) before UI work. Import it only through `src/ui/wa/`; theme only with `--wa-*` overrides in `ui/wa/efs-themes.css`. It is startup code. Under our Trusted Types policy never use `unsafeHTML`/`unsafeSVG` (banned), `wa-markdown` or `wa-include`. Icons go through `appIcon()` and the generated sprite; add new ones to `APP_ICONS` and run `pnpm icons`.

## Pushing (during the MVP push)

**Direct pushes to `main` are for the MVP push only.** When the MVP is finished, the industry-standard PR model comes back for every change, here as in contracts-v2 (James gave its dev the same limit).

**The rule is James's, 2026-11-25.**
- Recorded in planning `Decisions.md` (planning commit `1042fe5`): *"You guys have my permission to push changes to main as we're iterating hard and moving fast. Let's save PRs for really big things that truly need them."*
- To this repo's dev directly: *"Yes you may push to main during this MVP push. … Use PRs where it makes sense. But once MVP is finished we should go back to the industry standard model."*

**How it's applied:**
- **Small work goes to `main`** once the local gates pass: `pnpm check`, `pnpm build`, `pnpm test:e2e`, and `pnpm test:e2e:live`. Nothing else enforces the live-chain job. CI runs on every push to `main` and nightly.
- **Riskier work goes to a branch first.** That covers a new slice, an SDK re-vendor, the save path, or the outcome copy rules. Send the integration owner (PM) the head; after their review, push it to `main` yourself, with no PR.
- **Never force-push or rewrite `main`.** Fetch first and push only a fast-forward.
- **A PR only for something really big,** and ask the PM first.
- **When the MVP is done, go back to PRs for every change.**

## Don'ts

- Don't add dependencies, `allowBuilds` entries or Vite plugins without saying why in the commit message (or the PR, when there is one).
- Don't add a Service Worker, public link format, or storage beyond the user's settings record and the SDK's save journal (created only at the first real save); those are deliberately deferred (`docs/design/offline-brief.md`). Remote requests go only through the SDK to endpoints the user can see in Settings.
- `manifest.webmanifest` is committed with its fixed `id` (`/`, the origin root, so moving the app within its origin never orphans installs; `start_url` and `scope` stay `./`), but `<link rel="manifest">` is emitted only when `efs.config.json` names this origin as `delivery.stableOrigin`: an install anywhere else would be tied to the wrong origin for good. Don't link it unconditionally.
- On a shared IPFS path gateway (`/ipfs/<cid>/…`, `/ipns/<name>/…`) the app is read-only: nothing is stored (settings last for the tab), no journal is opened, no wallet is touched. Keep it that way for anything new that stores or saves.
- Don't widen the CSP. If something needs it, say why in the commit message or PR (`docs/design/shell.md` lists every exception and its reason).
- Don't guess a dev server URL or kill processes by port: `pnpm dev:status` gives this worktree's URLs, and `pnpm dev:stop` stops only what this worktree started.

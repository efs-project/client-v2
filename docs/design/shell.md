# OS shell foundation (slice A)

**Status:** working design for slice A, accepted in scope by the integration owner on 2026-11-24.
**Owner direction (James, 2026-11-24):**
- The client is an OS whose first and only app is the File Browser.
- The layout is a breadcrumb on top, a tree on the left, and configurable column panes (v1's default: README, then the list, then the selected file).
- Web Awesome, Lit and TC39 Signals are the only UI libraries, as web-native as possible.
- Users can configure their RPC endpoints.
- It hosts anywhere.
- It has strong themes that follow the system light/dark setting, and works on mobile.

**Data model:** whether folders and tags are separate is being decided. Nothing in this slice depends on the answer.

## What this slice builds, and what it leaves out

**Builds:**
- the shell (layout, app registry, panes as data, routing);
- settings (store, layers, export/import);
- network configuration (the RPC and gateway lists, handed to the SDK);
- themes and appearance;
- outcome rendering for the SDK's status vocabulary;
- the CSP and Trusted Types;
- the build gates.

**Leaves out:** reading EFS (the SDK's first reads drop), anything folder-, tag- or path-shaped, writes and wallets, the Service Worker and offline mode, and the dev chain supervisor.

## Layers in this repository

```text
boot/       entry: probe result → settings → config → appearance → shell. No app code yet.
platform/   browser adapters with no UI library: scope, locale, appearance, settings/*
state/      Signals adapter (the only signal-polyfill import) and scope-owned effects
ui/         EfsElement (Lit + SignalWatcher), wa/ (the only Web Awesome imports), themes,
            outcome mapping, messages
shell/      efs-shell (<wa-page>), pane host, settings panel, network indicator
apps/       registered apps; files/ is the only one, with placeholder panes
```

Dependency direction: `boot → shell → apps → ui → state/platform`.
- `platform/` and `state/` never import Lit or Web Awesome (enforced by Biome), so the parts of the OS that must survive a UI-library change don't depend on it.
- Apps never import each other or the shell's internals.

## Shell

`<efs-shell>` owns one `<wa-page>`. Following the Web Awesome design skill, the regions are:

| Slot | Content |
|---|---|
| `header` | EFS wordmark, the active app's title, the network indicator, the settings button |
| `subheader` | the active app's location bar (the File Browser puts its breadcrumb here) |
| `navigation` | the active app's navigation view (the File Browser puts its tree here). `<wa-page>` turns it into a drawer on narrow screens, so there is no second copy and no media query. |
| default (`<main>`) | the pane host |

Our own `<header>`, `<nav>` and `<main>` elements are slotted (`<wa-page>` adds none), and there is one skip link.

The shell knows nothing about files. It renders whatever the active app provides for its location bar, navigation and panes.

## Apps and views

An app is a plain descriptor plus a lazily loaded entry:

```ts
interface AppDescriptor {
  id: string;                    // 'files'
  title: MessageId;
  load(): Promise<AppEntry>;     // literal dynamic import
}
interface AppEntry {
  mount(host: AppHost, scope: OwnerScope): AppMount;  // everything it starts belongs to scope
}
interface AppMount {
  views: ReadonlyMap<string, ViewDescriptor>;          // what this app can show in a pane
  defaultLayout: PaneLayout;                           // plain data
  location?: Element;  navigation?: Element;           // slotted by the shell
}
type PaneLayout = { panes: readonly { view: string; size?: number }[] };
```

- The layout is **data**. v1's README / list / preview arrangement is the File Browser's `defaultLayout`. Making panes configurable later means persisting a `PaneLayout` in settings; no code change is needed.
- Panes are keyed on view ids that describe "entries of X", never directory-specific fields, so the shape survives the folder/tag decision.
- When `<main>` is at least 18rem per pane wide, panes sit side by side in nested `<wa-split-panel>`s, with keyboard-resizable dividers. Narrower, they become tabs (`<wa-tab-group>`), one visible at a time. Each view element is created once and kept, so switching presentation or tab loses no state. Drill-in (choosing an entry moves to the next pane on a phone) arrives with real data.
- There is no compositor, plugin container or service locator. Third-party apps and the Session Shell come later through the module/runner design. A descriptor plus `mount` on a scope is the seam that grows into that.

## Routing

The client ↔ SDK routing contract (PM ledger, 2026-11-24; naming review §6):

| Family | Fragment | Who parses it | Permanent? |
|---|---|---|---|
| Object link | `#/r/<realm>/~efs/o/<subject>[?lens=…]` | the SDK's `parseLink` | yes |
| Revision link | `#/r/<realm>/~efs/v/<record>` | the SDK's `parseLink` | yes |
| Path link | `#/r/<realm>/<path>` | the SDK (after the folder ruling) | yes |
| App route | `#/<app>/<rest>` | the app | no (bookmarkable UI state) |

- `<realm>` is a network `id` from `efs.config.json` (`sepolia`, `local-1`) or the full form `eip155:<chainId>/0x<ledger>`, matched against each network's `chainId` and `core` (its ledger proxy address). A realm the site doesn't configure is reported with its full id, never swapped for another network.
- **Reservations**, so the families never collide: app ids are 2–32 characters of `[a-z0-9-]` starting with a letter, with no dot (keeping a later ENS-named layer such as `#/alice.eth/…` free). Every single-letter first segment is reserved for link forms; `r` is the only one in use.
- Realm links open in the default app (the File Browser handles links). The route's realm picks the network for the view; Settings' choice is the *default network*, used only when the route names none.
- `#/` is replaced (not pushed) with `#/r/<default network>/`. Links are replaced with the SDK's canonical form (for example, uppercase hex) in place.
- Routes longer than 8,192 characters (a 64-entry `?lens=` is about 4.3 KB) are refused with a visible message, never truncated.
- Link strings are only ever produced by the SDK's `link()` and parsed by its `parseLink()`. The router reads only the realm head; it moves to the SDK's `splitRealm` from the dependency-free `@efs/sdk/links` once that ships, so even the realm grammar lives in the SDK.

## Settings

| Layer | Source | Notes |
|---|---|---|
| Built-in | the bundle | no networks; appearance follows the system |
| Operator | `efs.config.json` beside `index.html` | static, public, validated input; never a backend |
| User | IndexedDB `efs-client` / `settings` / `user` | `efs-settings/1`, revisioned |

- **Writes are compare-and-set on `revision`.** A second tab gets `CONFLICT` instead of silently overwriting. Saves are announced on a BroadcastChannel so other tabs reload.
- **Unknown fields survive.** A settings record from a newer schema is shown read-only and never overwritten, which keeps rollback to an older client safe.
- **Guest visits write nothing.** Boot opens the database without creating it; e2e asserts no database, storage, cookie or worker exists after a visit that also opens Settings.
- **Settings → About** replaces C0's diagnostics disclosure. The release manifest is fetched only when Settings opens, never at boot.
- **The boot rule changes**, aligned with system-profiles ("NetworkBootstrap reads LocalSelectionState"):
  - *Before:* "Guest boot stays wallet-free, storage-free and network-free apart from its own static files."
  - *After:* "Guest boot is wallet-free. It reads only the settings record and the operator's `efs.config.json`, writes nothing to storage unless the user saves a setting, and contacts the network only through the selected RPC and gateways."
- **Appearance has a localStorage mirror** that the classic boot probe reads, so the first paint uses the right scheme. IndexedDB remains the truth.
- **Export and import** are plain JSON files. The export warns that RPC URLs can contain API keys. Settings are per origin: a different IPFS CID or host starts empty, so export/import is how settings move between them.

## Network configuration

- An effective network is the operator's definition overlaid with the user's replacement RPC and gateway lists, enabled entries only, in the user's order.
- The client hands the SDK only that ordered list. The SDK records an endpoint as its label or origin, never the full URL (ledger: result shape).
- **Accepted endpoints:**
  - https/wss anywhere;
  - http/ws on loopback only (`localhost`, `127.0.0.1`, `*.localhost`) for a user's own node;
  - no user-info credentials;
  - no IPV6 literals, because CSP can't allow them.
- **The header shows the active network and endpoint label** ("a default endpoint is named input, never invisible authority").
- A local node reached from an HTTPS-hosted copy triggers the browser's local-network permission prompt. The UI must distinguish "blocked by browser permission" from "node down".

## Appearance and themes

- Web Awesome's theme system is the design system. There's no parallel `--efs-*` vocabulary.
- EFS themes are one stylesheet of `--wa-*` overrides under `.efs-theme-<id>`, in both schemes. `cypher` (the default) is monospace accents, a green-on-black terminal palette in dark and ink-on-paper in light. `paper` is a quieter reading theme.
- `wa-light` / `wa-dark` follow the system unless the user chooses otherwise.
- Stored settings hold only mode and theme ids, never Web Awesome attributes.

## Icons

- `<wa-icon>`'s default mode fetches each SVG and assigns it with `innerHTML`, which enforced Trusted Types forbids: icons silently never render.
- Both icon libraries (`system`, which Web Awesome's components use internally, and `default`, ours) run in sprite-sheet mode against one same-origin sprite, `icons/efs-icons.svg`, generated by `tools/build/icons.ts` from Web Awesome's system set and the app icons listed there (Font Awesome Free, CC BY 4.0, attributed in the sprite and `THIRD_PARTY_LICENSES.txt`). No CDN, no `innerHTML`. `pnpm icons` regenerates; the build fails on drift.
- App code names icons through `appIcon()`, typed against the generated ids, so a typo is a type error.
- Sprite-mode icons give no load or error event (Web Awesome's icon docs say so). Boot fetches the sprite once (`force-cache`, so the `<use>` references reuse it); if that fails, `<html data-efs-icons="missing">` turns icon-only controls into their text labels.

## Failure behaviour

| What fails | What the user sees |
|---|---|
| A required browser feature | The static "can't run" message from the boot probe; none of our code runs |
| A startup module or the stylesheet (Web Awesome and app styles) | The static "didn't load" message with a Reload link to this document |
| The icon sprite | The working shell, with icon-only controls shown as text |
| An app's lazy chunk | The shell, with "This app didn't load" and Try again (a page reload: browsers keep a failed module fetch in their module map, so an in-page retry can't succeed). WebKit needs one more condition: an app's entry chunk must statically import only startup chunks. Otherwise, once the chunk has failed, WebKit keeps the failure across reloads (measured during slice B), so `check-graph` enforces it. |
| The operator config is absent or invalid | The shell; the File Browser explains there is no usable network. The build ships an empty `efs.config.json`, so a normal visit never 404s |

## Outcomes

`ui/outcome.ts` maps the SDK's status vocabulary (read, coverage, bytes, write, pin) to a tone, a message and a retry hint. Statuses are open unions, so an unrecognized code always renders as "unrecognized, not success" with its raw code. Only `COMMITTED` ever renders as done. The mapping is built and tested; the `<efs-outcome>` element that renders it arrives with the first SDK reads, where there is something to render.

## Security policy (CSP)

The meta policy (`apps/web/vite.config.ts`), checked directive by directive in e2e:

```text
default-src 'self'; script-src 'self';
style-src 'self' 'sha256-<wa-page mobile styles>' 'report-sample';
style-src-attr 'unsafe-hashes' 'sha256-<"display: block; height: 0;">' 'report-sample';
img-src 'self' data:; font-src 'self';
connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* http://*.localhost:*
            ws://localhost:* ws://127.0.0.1:* ws://*.localhost:*;
worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';
require-trusted-types-for 'script'; trusted-types lit-html
```

- `connect-src` is scheme-wide so users can add any RPC or gateway; `script-src 'self'` and enforced Trusted Types keep that from becoming an exfiltration path.
- **Trusted Types:** the only policy is Lit's own, named `lit-html` (lit-html 3.x creates it, pass-through). Because it passes strings through, `unsafeHTML`/`unsafeSVG`/`unsafeMathML` are banned in our source (Biome). Web Awesome creates no policy. The default no-duplicates rule makes a second Lit copy fail loudly.
- **The two style hashes** cover the only inline styles Web Awesome renders from markup: `<wa-page>`'s mobile-breakpoint `<style>` (depends on the Web Awesome version and `mobile-breakpoint="920"`) and one `style` attribute on its empty measuring div. `'unsafe-hashes'` admits only an attribute whose entire text matches that hash; every other inline style stays blocked. Without it, every page load logged a CSP error. e2e recomputes both hashes from the live page and fails with the new value when either drifts (a Web Awesome bump will do this).
- Styles set through CSSOM (`el.style.x = …`, Lit's `styleMap`) are not inline styles under CSP and are unaffected.
- `img-src data:` is for Web Awesome's `native.css` form-control glyphs.
- Unusable Web Awesome helpers under this policy: `wa-markdown` and `wa-include` (they assign HTML strings), and the string forms of toast helpers. Markdown rendering will need our own Trusted-Types-safe renderer.
- The SDK confirmed (2026-11-24) its browser entry points use no WebAssembly, eval, workers or DOM sinks, so it needs nothing beyond `connect-src`.

## Startup budget

Lit, Signals and Web Awesome are now startup code, a deliberate change from C0 (whose startup set was 13,615 B brotli). The 250 KiB budget is now a failing gate in `tools/build/check-graph.ts`, and counts the icon sprite as well as everything `index.html` loads.

| | Brotli bytes |
|---|---|
| C0 startup set | 13,615 |
| Slice A startup set (HTML, probe, JS, CSS, sprite) | 118,363 |
| Budget | 256,000 (250 KiB) |

The File Browser's own code is a separate lazy chunk. The SDK will live in that chunk, not in startup: its guest read path is about 24 KB brotli, and it uses viem/ox internals that the startup gate forbids.

## Known Web Awesome 3.15 issues, worked around here

- Sprite-mode `<svg>` has no `viewBox`, so its width fell back to 300px and overflowed the page; our icon mutator sets `width: 100%`.
- The tab group's scroll buttons keep the inner button's padding inside a 1.5em box and spilled past the page at 320px; fixed through `::part(scroll-button__base)`.
- `native.css` gives form controls an explicit `display`, defeating `[hidden]`; an unlayered `[hidden] { display: none }` restores it.
- The drawer's default 25rem is wider than small phones; capped at `100vw`.
- `<wa-page>`'s skip link is `href="#main-content"`, which would rewrite our hash route; the shell intercepts it and moves focus to `<main>`, and in-page anchors never change the route.

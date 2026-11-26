# EFS web client (v2)

The web client for the [Ethereum File System](https://github.com/efs-project) v2: a static, IPFS-hostable app that opens EFS links without a wallet or backend, and grows into a modular, user-owned Web OS.

**Status: the File Browser MVP.** It opens files by EFS link and shows only verified contents. It lists folders and addresses, and tags, word pages and the tags on a file, each row saying whose it is. A connected wallet can create, upload, edit, rename, move, remove and restore its own entries, tag and untag, and block names in places it owns: each a review, then one approval, carried through reloads to "Saved". Settings cover appearance and RPC/gateway endpoints, with themes that follow the system's light/dark setting and a mobile layout.

To point a deployment at a network, replace `efs.config.json` beside `index.html` (format `efs-config/1`, see `apps/web/src/platform/settings/model.ts`). Users can then reorder, disable or add their own RPC endpoints and gateways in Settings.

## Try it

`pnpm install && pnpm demo` starts this checkout's own EFS chain (needs `anvil`, Foundry 1.8.3) and the app, and fills the chain with a small demo: folders with READMEs, text files and an image, files at two addresses, tags by three people and a tag's name. It prints the links below and a network and public test account (Alice's) to add to your wallet. Then try:

1. **The root**: Guides/, Photos/ and Notes/. Open Guides/ to see its README in the Overview, then a file in the Preview, checked against the chain.
2. **Edit a file** (connected as Alice): Edit → Review and save → approve once, then "Saved".
3. **A tag, `photos/sunsets`**, named "Sunset photos": Alice's photo under the people you trust, Bob's under everyone else. Switch to Unfiltered to see Carol's stray tag, which Alice said "not this" to.
4. **A word's page, `sunsets`**: every place that uses the word, the plain tag first.
5. **Bob's address**: his own entries, and the note Alice left there, labelled as hers ("yours" when you're connected as Alice).

`pnpm dev` is the same without the demo data. `pnpm dev:stop` stops either.

## Quick start

```sh
npm i -g pnpm@12.6.0     # Node 24 required; corepack 0.34 can't launch pnpm 12
pnpm install
pnpm bootstrap           # Playwright browsers
pnpm check && pnpm build && pnpm test:e2e
pnpm preview:static      # serve the built files
```

See [AGENTS.md](AGENTS.md) for all commands and contribution rules, and [docs/architecture.md](docs/architecture.md) for the structure.

## Browser support

Chrome/Edge 120+, Firefox 124+, Safari 17.4+ (including iOS). Older browsers get a short "unsupported browser" message instead of a broken page. Details: [docs/web-platform/feature-policy.md](docs/web-platform/feature-policy.md).

## Hosting

`apps/web/dist` is plain static files with relative URLs. It works from any static host, under any path prefix, including IPFS gateways. It needs no server-side code. Each build includes `release.json` (SHA-256 of every shipped file) and `THIRD_PARTY_LICENSES.txt`.

## License

EFS's original software is [MIT](LICENSE). That license covers the software, not content read or published through EFS. Third-party components keep their own licenses, listed in each build's `THIRD_PARTY_LICENSES.txt`.

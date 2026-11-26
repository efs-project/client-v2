# EFS web client (v2)

The web client for the [Ethereum File System](https://github.com/efs-project) v2: a static, IPFS-hostable app that opens EFS links without a wallet or backend, and grows into a modular, user-owned Web OS.

**Status: the File Browser MVP.** What you can click today (in `pnpm demo`, below):

- **Read, no wallet needed:** open any file by its EFS link and see only verified contents (text, images, media); browse folders and addresses, with a folder's README in the Overview and every row saying whose it is.
- **Tags:** a tag's page in three views (people you trust, everyone, unfiltered), here or with everything below; a kind filter (files, folders, addresses, other); "Include tags that mean the same"; what it's also called and what it's under; a word's page across every place that uses it; and the tags on a file.
- **Write, once connected:** create folders and text files, upload, edit, rename, move, remove and restore your own entries, at a folder or an address; tag, say "not this", and take your tag back; name a tag, and say two tags are the same or one is under another; block names in places you own; and link a file stored elsewhere (IPFS, Arweave or a web address), with public gateways only if you choose them. Each is one review, then one approval, carried through reloads to "Saved".
- **Testing:** EFS dev accounts on the local chain (twenty personas, no keys), and Settings for appearance and your own RPC and gateway lists.

To point a deployment at a network, replace `efs.config.json` beside `index.html` (format `efs-config/1`, see `apps/web/src/platform/settings/model.ts`). Users can then reorder, disable or add their own RPC endpoints and gateways in Settings.

## Try it

`pnpm install && pnpm demo` starts this checkout's own EFS chain (needs `anvil`, Foundry 1.8.3) and the app, and fills the chain with a small demo: folders with READMEs, text files and an image, files at two addresses, tags by three people and a tag's name. It prints the links below. To act, click Connect and choose **EFS dev accounts**, then pick any persona (Satoshi Nakamoto, Hal Finney, Wei Dai…): no wallet or keys needed, the local chain signs for them, and "Switch persona" in the wallet panel changes who you are. (They exist only on the local test chain; a network you add your own wallet to works too.) Then try:

1. **The root**: Guides/, Photos/ and Notes/. Open Guides/ to see its README in the Overview, then a file in the Preview, checked against the chain.
2. **Edit a file** (as Satoshi Nakamoto): Edit → Review and save → approve once, then "Saved".
3. **A tag, `photos/sunsets`**, named "Sunset photos": Satoshi's photo under the people you trust, Hal's under everyone else. Switch to Unfiltered to see Wei Dai's stray tag, which Satoshi said "not this" to.
4. **A word's page, `sunsets`**: every place that uses the word, the plain tag first.
5. **Hal's address**: his own entries, and the note Satoshi left there, labelled with Satoshi's name ("yours" when you're Satoshi).

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

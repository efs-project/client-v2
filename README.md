# EFS web client (v2)

The web client for the [Ethereum File System](https://github.com/efs-project) v2: a static, IPFS-hostable app that opens EFS links without a wallet or backend, and grows into a modular, user-owned Web OS.

**Status: foundation (C0).** This builds and tests an empty, accessible, localized frame. It can't read or write EFS yet.

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

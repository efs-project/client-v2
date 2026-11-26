// One-command local development: `pnpm dev` starts this worktree's own EFS chain (@efs/fixture
// on anvil) and the Vite dev server, serves an efs.config.json that points at that chain, and
// prints what to add to a wallet and a link to an editable file.
//
//   pnpm dev           start (foreground; Ctrl-C stops both)
//   pnpm demo          the same, with a small demo dataset seeded on the chain (demo.ts)
//   pnpm dev:status    this worktree's instance, if any
//   pnpm dev:stop      stop this worktree's instance
//   pnpm dev:reset     stop it and forget its state (the next start is a fresh chain anyway)
//
// Ownership: everything is recorded in this worktree's `.efs-dev/state.json` (gitignored).
// status/stop/reset read only that file, and stop signals only the process it records, after
// checking that the process is this worktree's dev command. Nothing is ever killed by port.
// The chain is the fixture's, fresh at each start, named after this worktree (efs-dev-<6 hex>)
// with its sticky chain id. It stops itself after 24 h even if this process is killed outright
// (the fixture's watchdog); before then, the next start or dev:reset stops it by its lease.

import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DemoLinks, seedDemo } from './demo.ts';
import { devIdentity } from './identity.ts';
import { isSameProcess, processFacts } from './ownership.ts';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const STATE_DIR = join(ROOT, '.efs-dev');
const STATE_FILE = join(STATE_DIR, 'state.json');
/** The fixture's lease registry and state for this worktree's chain. */
const FIXTURE_HOME = join(STATE_DIR, 'fixture');
const NETWORK_ID = 'dev';
/** The fixture's watchdog stops anvil after this, even if this process dies without cleanup. */
const CHAIN_TTL_SECONDS = 24 * 3600;

interface DevState {
  readonly schema: 'efs-dev-state/1';
  readonly pid: number;
  /** `ps -o lstart=` of `pid` when it started: a reused pid never matches it. */
  readonly startTime: string;
  readonly worktree: string;
  readonly uiUrl: string;
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly startedAt: string;
}

const readState = (): DevState | undefined => {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as DevState;
    return state.schema === 'efs-dev-state/1' && state.worktree === ROOT ? state : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether the recorded process is still this worktree's dev command: alive, started at the
 * recorded time (a reused pid isn't), and running the dev script. Checked before every signal.
 */
const isOurs = (state: DevState): boolean => isSameProcess(state, processFacts(state.pid));

const running = (): DevState | undefined => {
  const state = readState();
  return state && isOurs(state) ? state : undefined;
};

async function status(): Promise<void> {
  const state = readState();
  if (!state) {
    console.log('No dev instance for this worktree. Start one with: pnpm dev');
    return;
  }
  if (!isOurs(state)) {
    console.log(`Not running (stale state from ${state.startedAt}). pnpm dev:reset clears it.`);
    return;
  }
  let chain = 'not answering';
  try {
    const response = await fetch(state.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const { result } = (await response.json()) as { result?: string };
    if (result) chain = `block ${Number.parseInt(result, 16)}`;
  } catch {
    // reported as not answering
  }
  console.log(`Running since ${state.startedAt} (pid ${state.pid})`);
  console.log(`  App:   ${state.uiUrl}`);
  console.log(`  Chain: ${state.rpcUrl} (chain id ${state.chainId}), ${chain}`);
}

async function stop(): Promise<boolean> {
  const state = readState();
  if (!state || !isOurs(state)) {
    console.log('No dev instance is running for this worktree.');
    return true;
  }
  process.kill(state.pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    if (!isOurs(state)) {
      console.log('Stopped.');
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`pid ${state.pid} is still stopping; try pnpm dev:status in a moment.`);
  return false;
}

async function reset(): Promise<void> {
  if (!(await stop())) {
    process.exitCode = 1;
    return;
  }
  // A chain left by a run that was killed outright: only this worktree's, by its lease.
  const { stopFixtureChain } = await import('@efs/fixture');
  const left = await stopFixtureChain({ name: devIdentity(ROOT).tag, home: FIXTURE_HOME });
  if (left.wasLive) console.log('Stopped a chain a previous run left behind.');
  rmSync(STATE_DIR, { recursive: true, force: true });
  console.log('State cleared. The next pnpm dev starts a fresh chain.');
}

function devConfig(
  chainId: number,
  ledger: string,
  rpcUrl: string,
): { readonly config: unknown; readonly label: string } {
  const label = `Local dev chain ${chainId}`;
  return {
    label,
    config: {
      schema: 'efs-config/1',
      defaultNetwork: NETWORK_ID,
      networks: [
        {
          id: NETWORK_ID,
          label,
          chainId,
          core: ledger.toLowerCase(),
          deployment: `deployments/${NETWORK_ID}.json`,
          release: `deployments/${NETWORK_ID}-release.json`,
          rpcs: [{ url: rpcUrl, label: 'This worktree’s anvil' }],
          ipfsGateways: [],
          arweaveGateways: [],
        },
      ],
    },
  };
}

async function start(demo = false): Promise<void> {
  const already = running();
  if (already) {
    console.log(`Already running: ${already.uiUrl} (pnpm dev:status, pnpm dev:stop)`);
    return;
  }
  const id = devIdentity(ROOT, {
    uiPort: process.env.EFS_DEV_UI_PORT,
    rpcPort: process.env.EFS_DEV_RPC_PORT,
  });
  // Recorded so stop/reset can tell this process from a later one that reuses its pid.
  const startTime = processFacts(process.pid)?.startTime;
  if (!startTime) throw new Error("couldn't read this process's start time with ps");
  mkdirSync(STATE_DIR, { recursive: true });
  console.log(`Starting this worktree's chain on port ${id.rpcPort} (chain id ${id.chainId})…`);

  const [{ startFixtureChain, stopFixtureChain }, { link }, { createServer }] = await Promise.all([
    import('@efs/fixture'),
    import('@efs/sdk'),
    import('vite'),
  ]);
  const owned = { name: id.tag, home: FIXTURE_HOME };
  const options = {
    ...owned,
    chainId: id.chainId,
    port: id.rpcPort,
    ttlSeconds: CHAIN_TTL_SECONDS,
    ...(process.env.ANVIL_PATH ? { anvilPath: process.env.ANVIL_PATH } : {}),
  };
  let chain: Awaited<ReturnType<typeof startFixtureChain>>;
  try {
    chain = await startFixtureChain(options);
  } catch (error) {
    // A chain from a run that was killed outright still holds this worktree's lease: stop that
    // one (the fixture signals only the anvil its lease names) and start fresh.
    if (!/already leased/i.test(String(error))) throw error;
    console.log('Stopping the chain a previous run left behind…');
    await stopFixtureChain(owned);
    chain = await startFixtureChain(options);
  }

  const ledger = String((chain.deployment as { ledger?: unknown }).ledger ?? '');
  const { config, label } = devConfig(chain.chainId, ledger, chain.rpcUrl);
  const files = new Map<string, string>([
    ['/efs.config.json', JSON.stringify(config, null, 2)],
    [`/deployments/${NETWORK_ID}.json`, JSON.stringify(chain.deployment, null, 2)],
  ]);
  const server = await createServer({
    configFile: join(ROOT, 'apps/web/vite.config.ts'),
    root: join(ROOT, 'apps/web'),
    server: { host: '127.0.0.1', port: id.uiPort, strictPort: true },
    // Serves this instance's config and deployment from memory, so nothing is written into the
    // repository and the committed efs.config.json (no networks) stays what the build ships.
    plugins: [
      {
        name: 'efs-dev-config',
        configureServer(vite) {
          vite.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
            const body = req.url ? files.get(req.url.split('?')[0] ?? '') : undefined;
            if (body === undefined) return next();
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'no-store');
            res.end(body);
          });
        },
      },
    ],
  });
  try {
    await server.listen();
  } catch (error) {
    await chain.stop();
    throw error;
  }
  const uiUrl = `http://127.0.0.1:${id.uiPort}/`;
  const state: DevState = {
    schema: 'efs-dev-state/1',
    pid: process.pid,
    startTime,
    worktree: ROOT,
    uiUrl,
    rpcUrl: chain.rpcUrl,
    chainId: chain.chainId,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping…');
    // The chain first: it's the part that would outlive this process.
    await chain.stop().catch((error: unknown) => console.error('the chain did not stop', error));
    await server.close().catch(() => undefined);
    if (readState()?.pid === process.pid) rmSync(STATE_FILE, { force: true });
    // A failure on the way (the demo's seed) has set exitCode already.
    process.exit();
  };
  // Ctrl-C, dev:stop, and a closed terminal all stop the chain with the app. Vite installs its
  // own SIGTERM handler, which exits before the chain is stopped; this process owns shutdown.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.removeAllListeners(signal);
    process.on(signal, () => void shutdown());
  }

  let links: DemoLinks | undefined;
  if (demo) {
    console.log('Seeding the demo: folders, files, two addresses, tags and a label…');
    try {
      links = await seedDemo(chain, (l) => `${uiUrl}#/r/${NETWORK_ID}/${l}`);
    } catch (error) {
      console.error(
        'The demo could not be seeded:',
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
      await shutdown();
    }
  }

  const readme = chain.seed.files.find((f) => f.name === 'readme.txt');
  const fileLink = readme
    ? `${uiUrl}#/r/${NETWORK_ID}/${link({ kind: 'object', subject: readme.subjectId })}`
    : undefined;
  const account = chain.accounts.fixture;
  console.log(`
EFS dev is running for this worktree.

  App:      ${uiUrl}
  Edit me:  ${fileLink ?? '(the fixture seeded no readme.txt)'}

Add this network to your wallet:
  Network:  ${label}
  RPC URL:  ${chain.rpcUrl}
  Chain ID: ${chain.chainId}
  Currency: ETH

Import this account (it authored the seeded files, so your edits show in the default view):
  Address:     ${account.address}
  Private key: ${account.privateKey}   <- public test key, never use elsewhere

The chain is fresh on every start. If your wallet then shows stale nonces or activity,
clear it for this network (MetaMask: Settings > Advanced > Clear activity tab data).

pnpm dev:status | pnpm dev:stop | pnpm dev:reset    Ctrl-C stops both.`);
  if (links) console.log(demoText(uiUrl, links));
}

/** What the demo seeded, and where to click. */
function demoText(uiUrl: string, links: DemoLinks): string {
  return `
Demo data is in. Connect as the account above: that's Alice (the default view's author).
Bob is ${links.bob}.

Try it:
  1. The root, with Guides/, Photos/ and Notes/:   ${uiUrl}
  2. A folder (its README in the Overview):        ${links.folder}
  3. A tag, photos/sunsets ("Sunset photos"):      ${links.tag}
     Alice's and Bob's photos; switch to Unfiltered to see Carol's stray tag on
     getting-started.txt, which Alice said "not this" to ("1 of 2 say it applies")
  4. A word's page, sunsets (two places use it):  ${links.word}
  5. Bob's address (Alice's welcome.txt is there): ${links.address}
     Alice's entry says "yours"; open it without a wallet and it says whose it is.
  An image, checked against the chain:            ${links.image}`;
}

const command = process.argv[2] ?? 'start';
const commands: Record<string, () => Promise<unknown>> = {
  start: () => start(process.argv.includes('--demo')),
  status,
  stop,
  reset,
};
const run = commands[command];
if (!run) {
  console.error(`Unknown command ${command}. Use: start, status, stop, reset.`);
  process.exitCode = 2;
} else {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

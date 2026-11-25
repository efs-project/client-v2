// The write tests' chain and wallet, in one of three modes (EFS_CHAIN):
//
// - replay (default, every PR, all browsers): answers the page's JSON-RPC and wallet requests
//   from transcripts this client recorded. The wallet half is strict: a request made more often
//   than recorded (a second eth_sendTransaction, say) fails the test.
// - live (CI's live-chain job): a fresh @efs/fixture chain (anvil) per test, and a wallet that
//   signs through anvil's unlocked accounts, as a real wallet would through eth_sendTransaction.
// - record (`pnpm transcripts:record`): live, with the SDK's recordingFetch and
//   recordingProvider around both halves; writes tests/e2e/transcripts/<case>.json (the SDK's
//   efs-sdk-rpc-transcript/1) and <case>.deployment.json. Never edit those files by hand:
//   replay matches calls by order, so the order belongs to this client and changes with it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { FixtureChain } from '@efs/fixture';
import {
  createRpcReplay,
  type RpcTranscript,
  recordingFetch,
  recordingProvider,
  replayProvider,
} from '@efs/sdk/testing';
import type { Page } from '@playwright/test';

type FetchLike = Parameters<typeof recordingFetch>[0];

export type ChainMode = 'replay' | 'live' | 'record';
export const CHAIN_MODE: ChainMode = (() => {
  const mode = process.env.EFS_CHAIN ?? 'replay';
  if (mode !== 'replay' && mode !== 'live' && mode !== 'record') {
    throw new Error(`EFS_CHAIN must be replay, live or record (got ${mode})`);
  }
  return mode;
})();

const TRANSCRIPTS = 'tests/e2e/transcripts/';
/** The fake RPC origin TEST_CONFIG names; the page's requests to it are answered here. */
const RPC_ORIGIN = /^https:\/\/rpc\.example\.net\//;

/** anvil account #6: not the fixture principal, so the default Lens leaves it out. */
const EDITOR_INDEX = 6;

type Rpc = (method: string, params?: readonly unknown[]) => Promise<unknown>;

interface WalletRequest {
  readonly method: string;
  readonly params?: unknown;
}
type WalletAnswer =
  | { readonly result: unknown }
  | { readonly error: { readonly code?: number; readonly message: string } };

/** What a Node-side actor gets: the real SDK, as one anvil account. */
export interface ActAs {
  readonly efs: import('@efs/sdk').Efs;
  readonly writer: import('@efs/sdk/actions').EfsWriter;
  readonly files: typeof import('@efs/sdk/files');
  /** The account, lowercase. */
  readonly account: string;
  /** This account first, then the default Lens. */
  readonly lens: import('@efs/sdk').Lens;
  /** The realm's shared root folder (the stand-in parent). */
  readonly root: import('@efs/sdk/files').FolderRef;
  /** Sends a PLANNED plan to COMPLETE and returns its review; throws otherwise. */
  save(plan: { status: string; parts?: unknown }): Promise<unknown>;
}

export interface TestChain {
  readonly mode: ChainMode;
  /** The deployment document the page is served. */
  readonly deployment: string;
  /** Ids the test names: the seeded file, the editing account. */
  readonly ids: Readonly<Record<string, string>>;
  /** Every wallet request the page made, in order (all page loads). */
  readonly walletCalls: readonly string[];
  /** Live chain controls; undefined when replaying (the transcript already holds their effect). */
  readonly control:
    | {
        automine(on: boolean): Promise<void>;
        mine(blocks: number): Promise<void>;
      }
    | undefined;
  /** The next eth_sendTransaction is broadcast, but the page gets "connection lost" instead. */
  dropNextSendResponse(): void;
  /** Live: refuse the nth eth_sendTransaction (1-based) in the wallet, before broadcast. */
  refuseSend(n: number): void;
  /** Live: the wallet reports this chain id (undefined: the chain's own again). */
  walletChainId(id: string | undefined): void;
  /** All modes: the next eth_sendTransaction waits (in the wallet) until `release()`. */
  holdNextSend(): { readonly reached: Promise<void>; release(): void };
  /** All modes: break IndexedDB writes in `page` once the next send has been answered. */
  breakJournalAfterSend(page: Page): Promise<void>;
  /** All modes: let `page` write to IndexedDB again. */
  restoreJournal(page: Page): Promise<void>;
  /**
   * Live and record: act on the chain from Node as anvil account `index`, through the real SDK.
   * Whatever ids `act` returns join the transcript's ids, so replay knows them.
   */
  readonly actAs:
    | ((
        index: number,
        act: (sdk: ActAs) => Promise<Record<string, string> | void>,
      ) => Promise<void>)
    | undefined;
  /** Live and record: replace the seeded readme's contents from Node as anvil account `index`. */
  readonly editAs:
    | ((
        index: number,
        content: string | Uint8Array,
        /** The media type the new revision declares (omitted: the file keeps its own). */
        opts?: { readonly mediaType?: string },
      ) => Promise<void>)
    | undefined;
  /** Transactions the wallet actually broadcast (sent, not refused). */
  readonly broadcasts: readonly string[];
  /**
   * Resolves once no RPC request is in flight and none has started for `ms`. Use it with the
   * page clock paused: then the SDK can only continue through answers already in flight (its
   * timers can't fire), so "idle" means its current step is done, not merely quiet for a while.
   */
  idle(ms?: number): Promise<void>;
  /** Routes the page's RPC origin and installs the EIP-6963 test wallet. Call before goto. */
  attach(page: Page): Promise<void>;
  /** Records the steps of this case (written into the transcript in record mode). */
  step(text: string): void;
  /** Replay: fails on any miss. Record: writes the transcript. Live: stops the chain. */
  finish(): Promise<void>;
}

const fault = (message: string, code?: number) =>
  Object.assign(new Error(message), code === undefined ? {} : { code });

function anvilRpc(url: string): Rpc {
  let id = 0;
  return async (method, params = []) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const body = (await response.json()) as {
      result?: unknown;
      error?: { code?: number; message: string };
    };
    if (body.error) throw fault(body.error.message, body.error.code);
    return body.result;
  };
}

/**
 * A wallet over anvil: the editing account, already unlocked there, so eth_sendTransaction is
 * signed by anvil exactly as a wallet would sign it. No EIP-5792 (the SDK goes part by part).
 */
/** What the live test wallet is told to do (record mode captures its answers for replay). */
interface WalletBehaviour {
  /** The next broadcast's answer is lost. */
  drop: boolean;
  /** Refuse these sends (1-based, counting every eth_sendTransaction) with 4001, unsent. */
  readonly refuse: Set<number>;
  /** Report this chain id instead of the chain's (a wallet switched away). */
  chainId?: string | undefined;
  sends: number;
}

function anvilWallet(rpc: Rpc, account: string, state: WalletBehaviour) {
  return {
    async request({ method, params }: WalletRequest): Promise<unknown> {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account];
        case 'eth_chainId':
          return state.chainId ?? rpc('eth_chainId');
        case 'wallet_switchEthereumChain':
          return null;
        case 'eth_sendTransaction': {
          state.sends++;
          if (state.refuse.has(state.sends)) throw fault('User rejected the request.', 4001);
          const hash = await rpc(method, params as unknown[]);
          if (state.drop) {
            state.drop = false;
            // Broadcast, but the answer never reaches the page.
            throw fault('the connection to the wallet was lost');
          }
          return hash;
        }
        default:
          throw fault(`the test wallet does not support ${method}`, 4200);
      }
    },
  };
}

async function startChain(): Promise<FixtureChain> {
  const { startFixtureChain } = await import('@efs/fixture');
  return startFixtureChain(process.env.ANVIL_PATH ? { anvilPath: process.env.ANVIL_PATH } : {});
}

/** The test chain for one case (`name` keys its transcript). */
export async function testChain(name: string, note: string): Promise<TestChain> {
  const calls: string[] = [];
  const steps: string[] = [];
  /** Failures of the test's own chain or wallet plumbing: any one fails the test in finish(). */
  const harnessErrors: unknown[] = [];
  let lastRpc = Date.now();
  let inFlight = 0;
  const drop: WalletBehaviour = { drop: false, refuse: new Set(), sends: 0 };
  /** The send to hold, and how to let it go. */
  let hold: { reached: () => void; released: Promise<void> } | undefined;
  /** Pages whose journal breaks once the next send is answered. */
  const breakAfterSend = new Set<Page>();
  const broadcasts: string[] = [];
  let editAs: TestChain['editAs'];
  let actAs: TestChain['actAs'];

  let answerRpc: (body: unknown) => Promise<unknown>;
  let askWallet: (r: WalletRequest) => Promise<unknown>;
  let deployment: string;
  let ids: Record<string, string>;
  let control: TestChain['control'];
  let finish: () => Promise<void>;

  if (CHAIN_MODE === 'replay') {
    const transcript = JSON.parse(
      readFileSync(`${TRANSCRIPTS}${name}.json`, 'utf8'),
    ) as RpcTranscript;
    deployment = readFileSync(`${TRANSCRIPTS}${name}.deployment.json`, 'utf8');
    ids = { ...transcript.ids };
    const rpc = createRpcReplay(transcript);
    const wallet = replayProvider(transcript, { strict: true });
    answerRpc = async (body) => rpc.answer(body);
    askWallet = (r) => wallet.request(r as never);
    finish = async () => {
      const misses = [...rpc.misses, ...wallet.misses];
      if (misses.length > 0) {
        throw new Error(
          `replay misses (re-record with pnpm transcripts:record if the client's calls changed):\n${misses.join('\n')}`,
        );
      }
    };
  } else {
    const chain = await startChain();
    const rpc = anvilRpc(chain.rpcUrl);
    const account = (chain.accounts.unlocked[EDITOR_INDEX] as string).toLowerCase();
    const readme = chain.seed.files.find((f) => f.name === 'readme.txt');
    if (!readme) throw new Error('the fixture seed has no readme.txt');
    deployment = `${JSON.stringify(chain.deployment, null, 2)}\n`;
    ids = { file: readme.subjectId, account };
    actAs = async (index, act) => {
      const [{ createEfs }, { createWriter, memoryJournal }, files] = await Promise.all([
        import('@efs/sdk'),
        import('@efs/sdk/actions'),
        import('@efs/sdk/files'),
      ]);
      const efs = createEfs({ rpcs: [chain.rpcUrl], deployment: chain.deployment as never });
      const who = (chain.accounts.unlocked[index] as string).toLowerCase();
      const wallet = anvilWallet(rpc, who, { drop: false, refuse: new Set(), sends: 0 });
      const writer = await createWriter(efs, {
        authorizer: { kind: 'eip1193', profile: 'direct', provider: wallet, account: who as never },
        journal: memoryJournal(),
      });
      const root = (
        chain.deployment as unknown as {
          root: { directoryRecordId: string; subjectId: string; principalId: string };
        }
      ).root;
      const save = async (plan: { status: string; parts?: unknown }) => {
        if (plan.status !== 'PLANNED')
          throw new Error(
            `actAs: ${JSON.stringify(plan, (_, v) => (typeof v === 'bigint' ? `${v}` : v))}`,
          );
        const done = await writer.runSequence(plan.parts as never);
        if (done.state !== 'COMPLETE') throw new Error(`actAs: ${done.state}`);
        return (plan as unknown as { review: unknown }).review;
      };
      const out = await act({
        efs,
        writer,
        files,
        account: who,
        lens: efs.lens.mineFirst(who as never),
        root: {
          kind: 'folder',
          directory: root.directoryRecordId,
          subject: root.subjectId,
          owner: root.principalId,
        } as never,
        save,
      });
      if (out) Object.assign(ids, out);
    };
    editAs = async (index, contentIn, opts = {}) => {
      const [{ createEfs }, { createWriter, memoryJournal }, { openFile, planEditFile }] =
        await Promise.all([
          import('@efs/sdk'),
          import('@efs/sdk/actions'),
          import('@efs/sdk/files'),
        ]);
      const efs = createEfs({ rpcs: [chain.rpcUrl], deployment: chain.deployment as never });
      const who = (chain.accounts.unlocked[index] as string).toLowerCase();
      const wallet = anvilWallet(rpc, who, { drop: false, refuse: new Set(), sends: 0 });
      const writer = await createWriter(efs, {
        authorizer: { kind: 'eip1193', profile: 'direct', provider: wallet, account: who as never },
        journal: memoryJournal(),
      });
      const file = { kind: 'file', subject: readme.subjectId as `0x${string}` } as const;
      const opened = await openFile(efs, file);
      if (opened.status !== 'PRESENT') throw new Error(`editAs: ${opened.status}`);
      const plan = await planEditFile(efs, writer, {
        file,
        base: { kind: 'revision', recordId: opened.file.revision },
        content: typeof contentIn === 'string' ? new TextEncoder().encode(contentIn) : contentIn,
        ...(opts.mediaType === undefined ? {} : { mediaType: opts.mediaType }),
      });
      if (plan.status !== 'PLANNED') throw new Error(`editAs: ${plan.status}`);
      const done = await writer.runSequence(plan.parts);
      if (done.state !== 'COMPLETE') throw new Error(`editAs: ${done.state}`);
    };
    control = {
      automine: async (on) => {
        await rpc('evm_setAutomine', [on]);
      },
      mine: async (blocks) => {
        await rpc('anvil_mine', [`0x${blocks.toString(16)}`]);
      },
    };
    const toAnvil: FetchLike = (url, init) => fetch(url, init as RequestInit);
    const recorder = recordingFetch(toAnvil);
    const base = anvilWallet(rpc, account, drop);
    const recorded = recordingProvider(base as never);
    const record = CHAIN_MODE === 'record';
    const send = record ? recorder.fetch : toAnvil;
    answerRpc = async (body) => {
      // The SDK's FetchLike: its recorder answers with text(), not json().
      const response = await send(chain.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return JSON.parse(await response.text());
    };
    askWallet = (r) => (record ? recorded.provider : base).request(r as never);
    finish = async () => {
      try {
        if (!record) return;
        const transcript: RpcTranscript = {
          schema: 'efs-sdk-rpc-transcript/1',
          case: name,
          note,
          contractsCommit: chain.contracts.commit,
          ids,
          steps,
          calls: recorder.calls,
          wallet: recorded.calls,
        };
        mkdirSync(TRANSCRIPTS, { recursive: true });
        writeFileSync(`${TRANSCRIPTS}${name}.json`, `${JSON.stringify(transcript, null, 2)}\n`);
        writeFileSync(`${TRANSCRIPTS}${name}.deployment.json`, deployment);
      } finally {
        await chain.stop();
      }
    };
  }

  return {
    mode: CHAIN_MODE,
    deployment,
    ids,
    walletCalls: calls,
    control,
    dropNextSendResponse() {
      drop.drop = true;
    },
    refuseSend(n) {
      drop.refuse.add(n);
    },
    walletChainId(id) {
      drop.chainId = id;
    },
    holdNextSend() {
      let reached: () => void = () => {};
      let release: () => void = () => {};
      const reachedP = new Promise<void>((resolve) => (reached = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      hold = { reached, released };
      return { reached: reachedP, release };
    },
    async breakJournalAfterSend(page) {
      breakAfterSend.add(page);
    },
    async restoreJournal(page) {
      await page.evaluate(() => {
        (window as unknown as { __efsBreakJournal?: boolean }).__efsBreakJournal = false;
      });
    },
    editAs,
    actAs,
    broadcasts,
    async idle(ms = 300) {
      for (;;) {
        const quiet = Date.now() - lastRpc;
        if (inFlight === 0 && quiet >= ms) return;
        await new Promise((resolve) => setTimeout(resolve, Math.max(20, ms - quiet)));
      }
    },
    step(text) {
      steps.push(text);
    },
    async finish() {
      try {
        if (harnessErrors.length > 0) {
          throw new Error(`the test chain failed:\n${harnessErrors.map(String).join('\n')}`);
        }
      } finally {
        await finish();
      }
    },
    async attach(page) {
      await page.route(RPC_ORIGIN, async (route) => {
        lastRpc = Date.now();
        inFlight++;
        try {
          let json: unknown;
          try {
            json = await answerRpc(JSON.parse(route.request().postData() ?? 'null'));
          } catch (error) {
            // The harness itself failed (anvil down, a broken transcript): fail the test.
            harnessErrors.push(error);
            await route.abort('failed').catch(() => undefined);
            return;
          }
          await route.fulfill({ json }).catch((error: unknown) => {
            // Only a page that has navigated away (the reload test) may drop an answer.
            if (!/closed|detached|navigat|already handled/i.test(String(error))) {
              harnessErrors.push(error);
            }
          });
        } finally {
          inFlight--;
          lastRpc = Date.now();
        }
      });
      await page.exposeFunction('__efsTestWallet', async (r: WalletRequest) => {
        calls.push(r.method);
        try {
          if (r.method === 'eth_sendTransaction' && hold) {
            const held = hold;
            hold = undefined;
            held.reached();
            await held.released;
          }
          const result = await askWallet(r);
          if (r.method === 'eth_sendTransaction') {
            broadcasts.push(String(result));
            if (breakAfterSend.delete(page)) {
              await page.evaluate(() => {
                (window as unknown as { __efsBreakJournal?: boolean }).__efsBreakJournal = true;
              });
            }
          }
          return { result } satisfies WalletAnswer;
        } catch (error) {
          const { code, message } = error as { code?: number; message: string };
          return {
            error: code === undefined ? { message } : { code, message },
          } satisfies WalletAnswer;
        }
      });
      await page.addInitScript(() => {
        // Lets a test break IndexedDB writes (a browser dropping storage mid-save).
        const win = window as unknown as { __efsBreakJournal?: boolean };
        for (const method of ['put', 'add', 'delete'] as const) {
          const original = IDBObjectStore.prototype[method] as (...a: unknown[]) => IDBRequest;
          IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
            if (win.__efsBreakJournal) throw new DOMException('storage was lost', 'UnknownError');
            return original.apply(this, args);
          } as never;
        }
      });
      await page.addInitScript(() => {
        const call = (window as unknown as { __efsTestWallet(r: unknown): Promise<WalletAnswer> })
          .__efsTestWallet;
        const provider = {
          async request(r: { method: string; params?: unknown }) {
            const answer = await call(r);
            if ('error' in answer) {
              throw Object.assign(
                new Error(answer.error.message),
                answer.error.code === undefined ? {} : { code: answer.error.code },
              );
            }
            return answer.result;
          },
          on() {},
          removeListener() {},
        };
        const detail = Object.freeze({
          info: Object.freeze({
            uuid: '00000000-0000-4000-8000-000000000006',
            name: 'Test Wallet',
            icon: '',
            rdns: 'net.example.testwallet',
          }),
          provider,
        });
        window.addEventListener('eip6963:requestProvider', () =>
          window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })),
        );
      });
    },
  };
}

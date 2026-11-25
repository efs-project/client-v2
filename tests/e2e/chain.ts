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
  /** Resolves once the page has made no RPC request for `ms`. */
  quiet(ms: number): Promise<void>;
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
function anvilWallet(rpc: Rpc, account: string, state: { drop: boolean }) {
  return {
    async request({ method, params }: WalletRequest): Promise<unknown> {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account];
        case 'eth_chainId':
          return rpc('eth_chainId');
        case 'wallet_switchEthereumChain':
          return null;
        case 'eth_sendTransaction': {
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
  let lastRpc = Date.now();
  const drop = { drop: false };

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
    async quiet(ms) {
      for (;;) {
        const idle = Date.now() - lastRpc;
        if (idle >= ms) return;
        await new Promise((resolve) => setTimeout(resolve, ms - idle));
      }
    },
    step(text) {
      steps.push(text);
    },
    finish: () => finish(),
    async attach(page) {
      await page.route(RPC_ORIGIN, async (route) => {
        lastRpc = Date.now();
        try {
          const json = await answerRpc(JSON.parse(route.request().postData() ?? 'null'));
          lastRpc = Date.now();
          await route.fulfill({ json });
        } catch {
          // The page navigated away while this was answered.
        }
      });
      await page.exposeFunction('__efsTestWallet', async (r: WalletRequest) => {
        calls.push(r.method);
        try {
          return { result: await askWallet(r) } satisfies WalletAnswer;
        } catch (error) {
          const { code, message } = error as { code?: number; message: string };
          return {
            error: code === undefined ? { message } : { code, message },
          } satisfies WalletAnswer;
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

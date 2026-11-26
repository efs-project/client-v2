// "EFS dev accounts": a wallet for the local dev chain only (`pnpm dev` / `pnpm demo`), offered in
// the ordinary wallet picker beside any installed wallet. It holds no keys: the dev chain (anvil)
// has its accounts unlocked and signs for them, so a send is forwarded to the chain's own RPC with
// `from` set to the chosen persona. Loaded only when the person clicks Connect on a network whose
// config names dev accounts and whose RPCs are all on this computer (devAccountsOf).
//
// - eth_requestAccounts asks which persona (the chooser, the app's own dialog); switching later is
//   wallet_requestPermissions, as in other wallets, and says so with accountsChanged.
// - wallet_sendCalls is refused (4200), so the SDK sends part by part.
// - Everything else reads through to the dev chain.

import type { DevAccount } from '../settings/model.ts';
import type { Eip1193Provider, WalletOption } from './discovery.ts';

/** A plain wallet glyph, as a data: image (the picker shows it in an <img>). */
const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="3" fill="#6b7280"/><circle cx="17" cy="12" r="2" fill="#fff"/></svg>',
  );

export interface DevWalletOptions {
  /** The id the picker and the shell know it by (shell/wallet-state.ts DEV_WALLET_RDNS). */
  readonly rdns: string;
  readonly accounts: readonly DevAccount[];
  /** The dev chain's RPC (on this computer). */
  readonly rpcUrl: string;
  readonly chainId: number;
  /** Asks the person which persona; undefined when they close it without choosing. */
  readonly choose: (
    accounts: readonly DevAccount[],
    current: string | undefined,
  ) => Promise<DevAccount | undefined>;
  readonly fetch?: typeof fetch;
  /**
   * The persona this tab chose last (per tab, so two tabs can be two personas), kept across a
   * reload. A remembered one connects without asking again; any choice is remembered.
   */
  readonly remember?: {
    readonly get: () => string | undefined;
    readonly set: (address: string) => void;
  };
}

const fault = (message: string, code: number) => Object.assign(new Error(message), { code });

/** The dev wallet, as the picker lists it. */
export function devWallet(o: DevWalletOptions): WalletOption & {
  /** The persona in use (lowercase address), if any. */
  readonly current: () => string | undefined;
} {
  const fetchImpl = o.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let current: string | undefined;
  let id = 0;
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    const response = await fetchImpl(o.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }),
    });
    const body = (await response.json()) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    if (body.error)
      throw fault(body.error.message ?? 'the dev chain refused', body.error.code ?? -32000);
    return body.result;
  };
  const pick = async (): Promise<string> => {
    const chosen = await o.choose(o.accounts, current);
    if (!chosen) throw fault('No dev account was chosen.', 4001);
    const address = chosen.address.toLowerCase();
    o.remember?.set(address);
    return address;
  };
  /** This tab's last persona, if it is still one of the accounts. */
  const remembered = (): string | undefined => {
    const address = o.remember?.get()?.toLowerCase();
    return o.accounts.some((a) => a.address === address) ? address : undefined;
  };
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
          current ??= remembered() ?? (await pick());
          return [current];
        case 'eth_accounts':
          return current ? [current] : [];
        case 'eth_chainId':
          return `0x${o.chainId.toString(16)}`;
        case 'wallet_requestPermissions': {
          const next = await pick();
          if (next !== current) {
            current = next;
            emit('accountsChanged', [current]);
          }
          return [{ parentCapability: 'eth_accounts' }];
        }
        case 'wallet_switchEthereumChain': {
          const wanted = (params as { chainId?: string }[] | undefined)?.[0]?.chainId;
          if (wanted?.toLowerCase() === `0x${o.chainId.toString(16)}`) return null;
          throw fault('The dev accounts are on the local test chain only.', 4902);
        }
        case 'wallet_sendCalls':
        case 'wallet_getCapabilities':
        case 'wallet_getCallsStatus':
          throw fault('The dev accounts send one transaction at a time.', 4200);
        case 'eth_sendTransaction': {
          const tx = (params as { from?: string }[] | undefined)?.[0];
          if (!current || tx?.from?.toLowerCase() !== current) {
            throw fault('That account is not the dev account in use.', 4100);
          }
          return rpc(method, params);
        }
        case 'personal_sign':
        case 'eth_sign':
        case 'eth_signTypedData_v4':
          // Signing passes through to the chain, which holds the unlocked account.
          return rpc(method, params);
        default:
          return rpc(method, params);
      }
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    uuid: 'efs-dev-accounts',
    name: 'EFS dev accounts',
    icon: ICON,
    rdns: o.rdns,
    provider,
    current: () => current,
  };
}

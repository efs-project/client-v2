// Connecting to a wallet and keeping up with it. Every call that can show the person a prompt
// is named for it, and happens only from an explicit click.

import type { Eip1193Provider } from './discovery.ts';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type ConnectResult =
  | { readonly status: 'CONNECTED'; readonly account: string; readonly chainId: number }
  /** The person declined in their wallet (EIP-1193 4001). */
  | { readonly status: 'REFUSED' }
  /** The wallet already has a request open (-32002): it's waiting in the wallet. */
  | { readonly status: 'PENDING' }
  | { readonly status: 'ERROR'; readonly detail: string };

export type SwitchResult =
  | { readonly status: 'SWITCHED' }
  | { readonly status: 'REFUSED' }
  | { readonly status: 'PENDING' }
  /** The wallet doesn't know this chain (4902); the person must add it in their wallet. */
  | { readonly status: 'UNKNOWN_CHAIN' }
  | { readonly status: 'ERROR'; readonly detail: string };

const codeOf = (error: unknown): number | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
};

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);

export function parseChainId(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) return undefined;
  const id = Number.parseInt(value, 16);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** The first account the wallet offers, lowercase, or undefined. */
export function firstAccount(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first: unknown = value[0];
  return typeof first === 'string' && ADDRESS.test(first) ? first.toLowerCase() : undefined;
}

/** May prompt (eth_requestAccounts). Call only from the person's click. */
export async function connect(provider: Eip1193Provider): Promise<ConnectResult> {
  try {
    const account = firstAccount(await provider.request({ method: 'eth_requestAccounts' }));
    if (!account) return { status: 'ERROR', detail: 'the wallet returned no account' };
    const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }));
    if (chainId === undefined)
      return { status: 'ERROR', detail: 'the wallet returned no chain id' };
    return { status: 'CONNECTED', account, chainId };
  } catch (error) {
    const code = codeOf(error);
    if (code === 4001) return { status: 'REFUSED' };
    if (code === -32002) return { status: 'PENDING' };
    return { status: 'ERROR', detail: detailOf(error) };
  }
}

/** May prompt (wallet_switchEthereumChain). Call only from the person's click. */
export async function switchChain(
  provider: Eip1193Provider,
  chainId: number,
): Promise<SwitchResult> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
    return { status: 'SWITCHED' };
  } catch (error) {
    const code = codeOf(error);
    if (code === 4001) return { status: 'REFUSED' };
    if (code === -32002) return { status: 'PENDING' };
    if (code === 4902) return { status: 'UNKNOWN_CHAIN' };
    return { status: 'ERROR', detail: detailOf(error) };
  }
}

/** Follows the wallet's account and chain changes until `signal` aborts. */
export function watchWallet(
  provider: Eip1193Provider,
  signal: AbortSignal,
  onAccount: (account: string | undefined) => void,
  onChain: (chainId: number | undefined) => void,
): void {
  if (!provider.on || !provider.removeListener) return;
  const accounts = (value: unknown) => onAccount(firstAccount(value));
  const chain = (value: unknown) => onChain(parseChainId(value));
  provider.on('accountsChanged', accounts);
  provider.on('chainChanged', chain);
  signal.addEventListener(
    'abort',
    () => {
      provider.removeListener?.('accountsChanged', accounts);
      provider.removeListener?.('chainChanged', chain);
    },
    { once: true },
  );
}

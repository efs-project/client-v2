// The tab's wallet connection. Nothing here touches a wallet until the person clicks Connect:
// the wallet code (platform/wallet) is a lazy chunk, loaded by connect(), and EIP-6963
// discovery runs only then. Created by boot and passed explicitly; no module-level instance.

import type { OwnerScope } from '../platform/scope.ts';
import type { DevAccount } from '../platform/settings/model.ts';
import type { WalletOption } from '../platform/wallet/discovery.ts';
import { type ReadonlySignal, state } from '../state/signals.ts';

export type WalletState =
  | { readonly status: 'DISCONNECTED' }
  /** Asking installed wallets to announce themselves (a moment, after the click). */
  | { readonly status: 'DISCOVERING' }
  /** More than one wallet: the person picks one. */
  | { readonly status: 'CHOOSING'; readonly options: readonly WalletOption[] }
  | { readonly status: 'NO_WALLET' }
  /** Waiting for the person in their wallet. */
  | { readonly status: 'CONNECTING'; readonly option: WalletOption }
  | {
      readonly status: 'CONNECTED';
      readonly option: WalletOption;
      readonly account: string;
      readonly chainId: number;
    }
  | { readonly status: 'REFUSED'; readonly option: WalletOption }
  /** The wallet already has a request open: the person should look at their wallet. */
  | { readonly status: 'PENDING'; readonly option: WalletOption }
  | { readonly status: 'ERROR'; readonly option?: WalletOption; readonly detail: string }
  /** The wallet code didn't load (blocked or offline). */
  | { readonly status: 'LOAD_FAILED' };

export type SwitchOutcome = 'SWITCHED' | 'REFUSED' | 'PENDING' | 'UNKNOWN_CHAIN' | 'ERROR';

/** The dev chain's wallet ("EFS dev accounts", platform/wallet/dev-accounts.ts), by its id. */
export const DEV_WALLET_RDNS = 'dev.efs.accounts';

/** What the dev wallet needs: the accounts, where to send, and the chain (devAccountsOf). */
export interface DevSetup {
  readonly accounts: readonly DevAccount[];
  readonly rpcUrl: string;
  readonly chainId: number;
}

/** Asks which dev account; undefined when the person closes it without choosing. */
export type ChooseDevAccount = (
  accounts: readonly DevAccount[],
  current: string | undefined,
) => Promise<DevAccount | undefined>;

export interface WalletSession {
  readonly state: ReadonlySignal<WalletState>;
  /** From a click only: discovers wallets, and connects if there is exactly one. */
  connect(): Promise<void>;
  /** From a click only: connects the chosen wallet. */
  choose(option: WalletOption): Promise<void>;
  /** From a click only: asks the wallet to switch chain (one prompt). */
  switchChain(chainId: number): Promise<SwitchOutcome>;
  /** Forgets the connection in this tab (EIP-1193 has no disconnect; the wallet keeps its grant). */
  disconnect(): void;
  /** From a click only, with the dev wallet: choose another dev account (an identity change). */
  switchPersona(): Promise<void>;
}

type ConnectModule = typeof import('../platform/wallet/connect.ts');
type DiscoveryModule = typeof import('../platform/wallet/discovery.ts');

export interface WalletSessionOptions {
  readonly target?: Window;
  readonly load?: () => Promise<[DiscoveryModule, ConnectModule]>;
  /** The dev accounts the selected network offers now (a local test chain only), if any. */
  readonly devSetup?: () => DevSetup | undefined;
  readonly chooseDevAccount?: ChooseDevAccount;
  /** This tab's remembered dev persona (dev-accounts.ts `remember`). */
  readonly devPersona?: {
    readonly get: () => string | undefined;
    readonly set: (address: string) => void;
  };
}

export function createWalletSession(
  scope: OwnerScope,
  {
    target = window,
    load = () =>
      Promise.all([
        import('../platform/wallet/discovery.ts'),
        import('../platform/wallet/connect.ts'),
      ]),
    devSetup,
    chooseDevAccount,
    devPersona,
  }: WalletSessionOptions = {},
): WalletSession {
  const current = state<WalletState>({ status: 'DISCONNECTED' });
  /** The dev wallet, kept per setup so a reconnect keeps its persona. */
  let dev: { readonly key: string; readonly option: WalletOption } | undefined;
  const devOption = async (): Promise<WalletOption | undefined> => {
    const setup = devSetup?.();
    if (!setup || !chooseDevAccount) return undefined;
    const key = JSON.stringify([setup.rpcUrl, setup.chainId, setup.accounts]);
    if (dev?.key !== key) {
      const { devWallet } = await import('../platform/wallet/dev-accounts.ts');
      dev = {
        key,
        option: devWallet({
          ...setup,
          rdns: DEV_WALLET_RDNS,
          choose: chooseDevAccount,
          ...(devPersona ? { remember: devPersona } : {}),
        }),
      };
    }
    return dev.option;
  };
  let run: OwnerScope | undefined;
  let modules: [DiscoveryModule, ConnectModule] | undefined;

  const loaded = async (): Promise<[DiscoveryModule, ConnectModule] | undefined> => {
    try {
      modules ??= await load();
      return modules;
    } catch (error) {
      console.error(error);
      current.set({ status: 'LOAD_FAILED' });
      return undefined;
    }
  };

  const choose = async (option: WalletOption): Promise<void> => {
    const mods = await loaded();
    if (!mods) return;
    run?.dispose();
    const watch = scope.child();
    run = watch;
    current.set({ status: 'CONNECTING', option });
    const result = await mods[1].connect(option.provider);
    if (watch.signal.aborted) return;
    if (result.status !== 'CONNECTED') {
      current.set(
        result.status === 'ERROR'
          ? { status: 'ERROR', option, detail: result.detail }
          : { status: result.status, option },
      );
      return;
    }
    current.set({ status: 'CONNECTED', option, account: result.account, chainId: result.chainId });
    mods[1].watchWallet(
      option.provider,
      watch.signal,
      (account) => {
        const now = current.get();
        if (now.status !== 'CONNECTED') return;
        // The wallet withdrew access: back to disconnected, never a silent account swap.
        if (!account) {
          watch.dispose();
          current.set({ status: 'DISCONNECTED' });
        } else current.set({ ...now, account });
      },
      (chainId) => {
        const now = current.get();
        if (now.status === 'CONNECTED' && chainId !== undefined) current.set({ ...now, chainId });
      },
    );
  };

  return {
    state: current,
    async connect() {
      const mods = await loaded();
      if (!mods) return;
      current.set({ status: 'DISCOVERING' });
      const found = await mods[0].discoverWallets(target, scope.signal);
      // The dev chain's accounts sit beside installed wallets, picked like any of them.
      const devWallet = await devOption().catch((error: unknown) => {
        console.error(error);
        return undefined;
      });
      const options = devWallet ? [...found, devWallet] : found;
      if (options.length === 0) current.set({ status: 'NO_WALLET' });
      else if (options.length === 1) await choose(options[0] as WalletOption);
      else current.set({ status: 'CHOOSING', options });
    },
    choose,
    async switchChain(chainId) {
      const now = current.get();
      const mods = await loaded();
      if (!mods || now.status !== 'CONNECTED') return 'ERROR';
      const result = await mods[1].switchChain(now.option.provider, chainId);
      // A successful switch arrives through chainChanged; nothing is assumed here.
      return result.status;
    },
    disconnect() {
      run?.dispose();
      run = undefined;
      current.set({ status: 'DISCONNECTED' });
    },
    async switchPersona() {
      const now = current.get();
      if (now.status !== 'CONNECTED' || now.option.rdns !== DEV_WALLET_RDNS) return;
      // The new account arrives through accountsChanged, like any wallet's switch.
      await now.option.provider
        .request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
        .catch(() => undefined);
    },
  };
}

/** "0x1234…cdef": for display only, in a translate="no" element. */
export function shortAccount(account: string): string {
  return `${account.slice(0, 6)}…${account.slice(-4)}`;
}

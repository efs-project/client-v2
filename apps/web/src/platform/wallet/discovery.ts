// Finding the person's wallets (EIP-6963), only when they ask to connect. Loaded lazily: this
// module is never part of the startup set (check-graph forbids platform/wallet there), and
// nothing here runs during a guest visit.

/** The slice of EIP-1193 the client uses. */
export interface Eip1193Provider {
  request(args: { readonly method: string; readonly params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  /** EIP-6963 uuid (per page load), or "legacy" for an injected window.ethereum. */
  readonly uuid: string;
  readonly name: string;
  /** A data: image URI from the wallet (shown in an <img>, which can't run script), or "". */
  readonly icon: string;
  /** Reverse-DNS id (io.metamask, com.example.wallet), or "legacy". */
  readonly rdns: string;
  readonly provider: Eip1193Provider;
}

const ICON = /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/;
const MAX_NAME = 64;

const isProvider = (value: unknown): value is Eip1193Provider =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { request?: unknown }).request === 'function';

/** A wallet's announcement, validated: wallets are third-party code, so nothing is trusted. */
export function readAnnouncement(detail: unknown): WalletOption | undefined {
  if (typeof detail !== 'object' || detail === null) return undefined;
  const { info, provider } = detail as { info?: unknown; provider?: unknown };
  if (typeof info !== 'object' || info === null || !isProvider(provider)) return undefined;
  const { uuid, name, icon, rdns } = info as Record<string, unknown>;
  if (typeof uuid !== 'string' || uuid === '' || uuid.length > 128) return undefined;
  if (typeof name !== 'string' || name.trim() === '') return undefined;
  if (typeof rdns !== 'string' || rdns.length > 255) return undefined;
  return {
    uuid,
    name: name.trim().slice(0, MAX_NAME),
    icon: typeof icon === 'string' && ICON.test(icon) && icon.length <= 100_000 ? icon : '',
    rdns,
    provider,
  };
}

/**
 * Asks installed wallets to announce themselves and collects answers for `windowMs`. Falls back
 * to a single injected `window.ethereum` when no wallet speaks EIP-6963.
 */
export async function discoverWallets(
  target: Window,
  signal: AbortSignal,
  windowMs = 300,
): Promise<WalletOption[]> {
  const found = new Map<string, WalletOption>();
  const onAnnounce = (event: Event) => {
    const option = readAnnouncement((event as CustomEvent).detail);
    if (option && !found.has(option.uuid)) found.set(option.uuid, option);
  };
  target.addEventListener('eip6963:announceProvider', onAnnounce);
  try {
    target.dispatchEvent(new Event('eip6963:requestProvider'));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, windowMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  } finally {
    target.removeEventListener('eip6963:announceProvider', onAnnounce);
  }
  if (found.size > 0) return [...found.values()];
  const injected = (target as unknown as { ethereum?: unknown }).ethereum;
  return isProvider(injected)
    ? [{ uuid: 'legacy', name: '', icon: '', rdns: 'legacy', provider: injected }]
    : [];
}

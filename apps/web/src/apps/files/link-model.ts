// "Store it elsewhere and link it": a file whose bytes live where the person put them (IPFS,
// Arweave, or a web address), saved on the chain as its fingerprint and that address alone
// (planCreateFile's external content). Pure, so each rule is tested.
//
// - The fingerprint (SHA-256) and length are made on this device from the file picked: nothing is
//   uploaded or fetched by the app. Readers check the stored copy against the fingerprint.
// - The address is checked as typed: this feature's schemes (ipfs, ar, https) and plain characters
//   here, then the SDK's checkLocator for whether it could ever be read (a well-formed id, no path
//   escape, no credentials). The planner refuses an unreadable one again (MISUSE) before signing.

/** The largest file fingerprinted here: it is read whole into memory to hash. */
export const LINK_MAX_BYTES = 1024 * 1024 * 1024;

/** Where a linked file may say its bytes are: read through readers' gateways, or a web address. */
const SCHEMES = ['ipfs://', 'ar://', 'https://'] as const;

/**
 * What's wrong with an address as typed, if anything (`empty` before anything is typed; `pending`
 * while the SDK's check is still loading).
 */
export type LocatorCheck = 'ok' | 'empty' | 'pending' | 'scheme' | 'chars' | 'shape';

/** The SDK's checkLocator verdict, as far as the dialog needs it. */
export type SdkLocatorCheck = (locator: string) => { readonly ok: boolean };

export function checkLocator(text: string, sdk: SdkLocatorCheck | undefined): LocatorCheck {
  if (text === '') return 'empty';
  // Printable ASCII, no spaces: what a files-external/1 locator holds.
  if (!/^[\x21-\x7e]+$/.test(text)) return 'chars';
  const lower = text.toLowerCase();
  const scheme = SCHEMES.find((s) => lower.startsWith(s));
  if (!scheme || text.length === scheme.length) return 'scheme';
  // Whether it could ever be read is the SDK's to say (protocol semantics stay there).
  if (!sdk) return 'pending';
  return sdk(text).ok ? 'ok' : 'shape';
}

/** A web address: readers fetch it only once they allow that site (not by default). */
export const isHttps = (locator: string): boolean => locator.toLowerCase().startsWith('https://');

/** 0x-prefixed lowercase hex of `bytes`. */
export function hex(bytes: Uint8Array): `0x${string}` {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out as `0x${string}`;
}

/** The file's length and SHA-256, made on this device (WebCrypto). */
export async function fingerprint(
  bytes: Uint8Array,
): Promise<{ readonly length: bigint; readonly sha256: `0x${string}` }> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return { length: BigInt(bytes.byteLength), sha256: hex(new Uint8Array(digest)) };
}

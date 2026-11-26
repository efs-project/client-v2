// "Store it elsewhere and link it": a file whose bytes live where the person put them (IPFS,
// Arweave, or a web address), saved on the chain as its fingerprint and that address alone
// (planCreateFile's external content). Pure, so each rule is tested.
//
// - The fingerprint (SHA-256) and length are made on this device from the file picked: nothing is
//   uploaded or fetched by the app. Readers check the stored copy against the fingerprint.
// - The address is checked here only for its form, as typed (the scheme, plain characters); the
//   SDK checks it again when it plans, and refuses what the chain wouldn't accept.

/** The largest file fingerprinted here: it is read whole into memory to hash. */
export const LINK_MAX_BYTES = 1024 * 1024 * 1024;

/** Where a linked file may say its bytes are: read through readers' gateways, or a web address. */
const SCHEMES = ['ipfs://', 'ar://', 'https://'] as const;

/** What's wrong with an address as typed, if anything (`empty` before anything is typed). */
export type LocatorCheck = 'ok' | 'empty' | 'scheme' | 'chars' | 'shape';

export function checkLocator(text: string): LocatorCheck {
  if (text === '') return 'empty';
  // Printable ASCII, no spaces: what a files-external/1 locator holds.
  if (!/^[\x21-\x7e]+$/.test(text)) return 'chars';
  const lower = text.toLowerCase();
  const scheme = SCHEMES.find((s) => lower.startsWith(s));
  if (!scheme || text.length === scheme.length) return 'scheme';
  const rest = text.slice(scheme.length);
  // Each kind's own id, by shape only (the SDK's checkLocator replaces this when it lands): an
  // IPFS CID (v0 "Qm…" base58, or v1 base32 "b…"), optionally with a path; an Arweave transaction
  // id (43 base64url characters); a web address with a host.
  if (scheme === 'ipfs://') {
    const cid = rest.split('/')[0] ?? '';
    return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{50,}$/.test(cid)
      ? 'ok'
      : 'shape';
  }
  if (scheme === 'ar://') return /^[A-Za-z0-9_-]{43}(\/.*)?$/.test(rest) ? 'ok' : 'shape';
  try {
    const url = new URL(text);
    return url.hostname.includes('.') && !url.username && !url.password ? 'ok' : 'shape';
  } catch {
    return 'shape';
  }
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

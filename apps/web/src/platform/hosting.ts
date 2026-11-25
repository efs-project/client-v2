// How this copy is hosted, as far as storage is concerned. Browser storage belongs to an origin,
// and an IPFS *path* gateway (`gateway/ipfs/<cid>/…`, `gateway/ipns/<name>/…`) serves every
// site it hosts from one origin: any of them can read and change this app's IndexedDB and
// localStorage. There the app runs read-only (PM decision, docs/design/offline-brief.md §2):
// settings last for the tab, no save journal is opened, no wallet is touched.
//
// Pure and tiny: it runs at boot, before anything is stored.

export type Hosting =
  | { readonly shared: false }
  | {
      readonly shared: true;
      readonly namespace: 'ipfs' | 'ipns';
      /** The CID or IPNS name the gateway path names. */
      readonly name: string;
      /** A copy on its own origin to send people to for saving, when one is known. */
      readonly isolated?: string;
    };

interface LocationLike {
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly hash: string;
}

const PATH_GATEWAY = /^\/(ipfs|ipns)\/([^/]+)(\/.*)?$/;
/** A CIDv1 in base32 (lowercase): the only CID form a DNS label can carry. */
const CID_V1_BASE32 = /^b[a-z2-7]{50,}$/;
const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/** An IPNS name as one DNS label (the subdomain-gateway convention: "-" → "--", "." → "-"). */
const ipnsLabel = (name: string): string => name.replaceAll('-', '--').replaceAll('.', '-');

/**
 * The hosting profile of `location`. `configured` is the operator's `delivery.isolatedCopy`
 * (efs.config.json); otherwise the subdomain-gateway form of the same content is derived, when
 * the host can carry it (a hostname, not an IP address; a base32 CID or an IPNS name).
 */
export function hostingOf(location: LocationLike, configured?: string): Hosting {
  const match = PATH_GATEWAY.exec(location.pathname);
  if (!match) return { shared: false };
  const namespace = match[1] as 'ipfs' | 'ipns';
  const name = match[2] as string;
  const rest = match[3] ?? '/';
  if (configured) return { shared: true, namespace, name, isolated: configured };
  const label =
    namespace === 'ipfs' ? (CID_V1_BASE32.test(name) ? name : undefined) : ipnsLabel(name);
  if (!label || IP_HOST.test(location.hostname)) return { shared: true, namespace, name };
  return {
    shared: true,
    namespace,
    name,
    isolated: `${location.protocol}//${label}.${namespace}.${location.host}${rest}${location.hash}`,
  };
}

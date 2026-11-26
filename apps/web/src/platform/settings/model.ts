// User settings and operator configuration: plain, versioned, validated data.
// Layers, lowest to highest: built-in defaults → operator config (efs.config.json beside
// index.html) → the user's own settings (IndexedDB). Unknown fields are preserved so a newer
// client's data survives a round trip through an older one; a newer schema is read-only here.

export const SETTINGS_SCHEMA = 'efs-settings/1';
export const CONFIG_SCHEMA = 'efs-config/1';

export type ColorMode = 'system' | 'light' | 'dark';
export const COLOR_MODES: readonly ColorMode[] = ['system', 'light', 'dark'];
export const THEMES = ['cypher', 'paper'] as const;
export type ThemeId = (typeof THEMES)[number];

export const MAX_ENDPOINTS = 16;
const MAX_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 64;

export interface Endpoint {
  readonly url: string;
  readonly label?: string;
  readonly enabled: boolean;
}

/**
 * A local test account the dev chain unlocks, by a persona name (`pnpm dev` / `pnpm demo` only).
 * Names and addresses, never keys: the chain signs for them.
 */
export interface DevAccount {
  readonly name: string;
  /** Lowercase. */
  readonly address: string;
}

export interface NetworkDefinition {
  readonly id: string;
  readonly label: string;
  readonly chainId: number;
  /**
   * The deployment's ledger proxy address, lowercase: with chainId it identifies the realm in
   * full-form links (`eip155:<chainId>/0x<ledger>`). Cross-checked against the deployment.
   */
  readonly core: string;
  /** Relative or absolute URLs of the contracts deployment and release manifests. */
  readonly deployment: string;
  readonly release: string;
  readonly rpcs: readonly Endpoint[];
  readonly ipfsGateways: readonly Endpoint[];
  readonly arweaveGateways: readonly Endpoint[];
  /**
   * The local dev chain's accounts (the generated config of `pnpm dev` / `pnpm demo`). Kept only
   * for a network whose RPCs are all on this computer (devAccountsOf), so a hosted config can
   * never offer them.
   */
  readonly devAccounts?: readonly DevAccount[];
  /**
   * Tests only: the most head-authors list entries one Versions read scans (fileVersions `limit`),
   * so a short list pages like a long one. Kept only for a network whose RPCs are all on this
   * computer, as devAccounts; never shown, never in the person's settings. Its upper bound is the
   * SDK's own MAX_VERSIONS_PAGE, applied where the SDK is loaded (versions-model `pageLimit`): this
   * module is startup code, which never imports the SDK.
   */
  readonly devVersionsPage?: number;
}

/** The user's replacements for one network's endpoint lists. Absent list = use the defaults. */
export interface NetworkOverrides {
  readonly rpcs?: readonly Endpoint[];
  readonly ipfsGateways?: readonly Endpoint[];
  readonly arweaveGateways?: readonly Endpoint[];
}

export interface UserSettings {
  readonly schema: typeof SETTINGS_SCHEMA;
  /** Compare-and-set counter; every successful save increments it. */
  readonly revision: number;
  readonly appearance: { readonly mode: ColorMode; readonly theme: ThemeId };
  readonly network: {
    readonly selected?: string;
    readonly overrides: Readonly<Record<string, NetworkOverrides>>;
  };
  readonly content: {
    /**
     * Also fetch file contents from a publisher's own https:// address (that host sees the
     * reader's IP). Off by default; the Preview offers a one-time load per host instead.
     */
    readonly publisherLocations: boolean;
  };
  /** Fields this version doesn't understand, kept verbatim. */
  readonly [unknownField: string]: unknown;
}

export interface OperatorConfig {
  readonly schema: typeof CONFIG_SCHEMA;
  readonly defaultNetwork?: string;
  readonly networks: readonly NetworkDefinition[];
  /** How this deployment is delivered (docs/design/offline-brief.md). */
  readonly delivery?: DeliveryConfig;
}

export interface DeliveryConfig {
  /**
   * The one origin where the app may be installed and keep state for good (`https://host[:port]`,
   * no path). The install manifest is linked only there.
   */
  readonly stableOrigin?: string;
  /** A copy of this app on its own origin, to send people to from a shared IPFS path gateway. */
  readonly isolatedCopy?: string;
}

/** An https URL, or http on this computer only (as for endpoints). */
function webUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const local =
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.hostname.endsWith('.localhost');
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url : undefined;
  } catch {
    return undefined;
  }
}

function readDelivery(raw: unknown, issues: string[]): DeliveryConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    issues.push('delivery was malformed and ignored');
    return undefined;
  }
  const delivery: { stableOrigin?: string; isolatedCopy?: string } = {};
  if (raw.stableOrigin !== undefined) {
    const url = webUrl(raw.stableOrigin);
    // An origin exactly: no path, query or fragment.
    if (url && url.origin === raw.stableOrigin) delivery.stableOrigin = url.origin;
    else issues.push('delivery.stableOrigin must be an origin (https://host) and was ignored');
  }
  if (raw.isolatedCopy !== undefined) {
    const url = webUrl(raw.isolatedCopy);
    if (url) delivery.isolatedCopy = url.href;
    else issues.push('delivery.isolatedCopy must be an https URL and was ignored');
  }
  return Object.keys(delivery).length > 0 ? delivery : undefined;
}

export const DEFAULT_SETTINGS: UserSettings = {
  schema: SETTINGS_SCHEMA,
  revision: 0,
  appearance: { mode: 'system', theme: 'cypher' },
  network: { overrides: {} },
  content: { publisherLocations: false },
};

export const EMPTY_CONFIG: OperatorConfig = { schema: CONFIG_SCHEMA, networks: [] };

export type EndpointKind = 'rpc' | 'gateway';

export type EndpointCheck =
  | { readonly status: 'VALID'; readonly url: string; readonly origin: string }
  | {
      readonly status: 'INVALID';
      readonly rule: 'url' | 'scheme' | 'insecure-remote' | 'credentials' | 'length';
    };

// No IPv6 literal: CSP host-source syntax can't allow [::1], so it would validate here and then
// be blocked by connect-src. Keep this list in step with the CSP in vite.config.ts.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * RPC endpoints may be https/wss anywhere, or http/ws on loopback (the user's own node).
 * Gateways are https, or http on loopback. User-info credentials (user:pass@) are refused;
 * API keys in paths or queries are allowed but never leave this device (the SDK only ever
 * sees a label or origin in its evidence).
 */
export function checkEndpoint(raw: string, kind: EndpointKind): EndpointCheck {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH)
    return { status: 'INVALID', rule: 'length' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { status: 'INVALID', rule: 'url' };
  }
  if (url.username !== '' || url.password !== '') return { status: 'INVALID', rule: 'credentials' };
  const secure = kind === 'rpc' ? ['https:', 'wss:'] : ['https:'];
  const local = kind === 'rpc' ? ['http:', 'ws:'] : ['http:'];
  if (!secure.includes(url.protocol) && !local.includes(url.protocol)) {
    return { status: 'INVALID', rule: 'scheme' };
  }
  if (local.includes(url.protocol) && !isLoopbackHost(url.hostname)) {
    return { status: 'INVALID', rule: 'insecure-remote' };
  }
  return { status: 'VALID', url: url.href, origin: url.origin };
}

/** The label the SDK records in evidence: the user's label, or the origin, never the full URL. */
export function endpointLabel(endpoint: Endpoint): string {
  if (endpoint.label && endpoint.label.trim() !== '') return endpoint.label.trim();
  const check = checkEndpoint(endpoint.url, 'rpc');
  return check.status === 'VALID' ? check.origin : 'endpoint';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readEndpoints(
  value: unknown,
  kind: EndpointKind,
  issues: string[],
  where: string,
): Endpoint[] {
  if (!Array.isArray(value)) return [];
  const out: Endpoint[] = [];
  for (const item of value.slice(0, MAX_ENDPOINTS)) {
    if (!isRecord(item) || typeof item.url !== 'string') {
      issues.push(`${where}: malformed endpoint dropped`);
      continue;
    }
    const check = checkEndpoint(item.url, kind);
    if (check.status !== 'VALID') {
      issues.push(`${where}: endpoint refused (${check.rule})`);
      continue;
    }
    const label =
      typeof item.label === 'string' ? item.label.trim().slice(0, MAX_LABEL_LENGTH) : undefined;
    out.push({
      url: check.url,
      enabled: item.enabled !== false,
      ...(label ? { label } : {}),
    });
  }
  if (value.length > MAX_ENDPOINTS) issues.push(`${where}: more than ${MAX_ENDPOINTS} endpoints`);
  return out;
}

const MAX_DEV_ACCOUNTS = 32;

/** Whether every endpoint in `list` is on this computer (and there is at least one). */
const allLocal = (list: readonly Endpoint[]): boolean =>
  list.length > 0 && list.every((e) => isLoopbackHost(new URL(e.url).hostname));

/**
 * A network's dev accounts, kept only when its RPCs are all on this computer: anywhere else they
 * are dropped with an issue, never offered.
 */
function readDevAccounts(
  value: unknown,
  rpcs: readonly Endpoint[],
  issues: string[],
  where: string,
): DevAccount[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !allLocal(rpcs)) {
    issues.push(`${where}.devAccounts: ignored (only for a local test chain)`);
    return undefined;
  }
  const out: DevAccount[] = [];
  for (const item of value.slice(0, MAX_DEV_ACCOUNTS)) {
    if (
      !isRecord(item) ||
      typeof item.name !== 'string' ||
      item.name.trim() === '' ||
      typeof item.address !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(item.address)
    ) {
      issues.push(`${where}.devAccounts: a malformed account was dropped`);
      continue;
    }
    out.push({
      name: item.name.trim().slice(0, MAX_LABEL_LENGTH),
      address: item.address.toLowerCase(),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** A network's test-only Versions page size, kept only on a local test chain (as devAccounts). */
function readDevVersionsPage(
  value: unknown,
  rpcs: readonly Endpoint[],
  issues: string[],
  where: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!allLocal(rpcs)) {
    issues.push(`${where}.devVersionsPage: ignored (only for a local test chain)`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    issues.push(`${where}.devVersionsPage: ignored (a whole number, 1 or more)`);
    return undefined;
  }
  return value;
}

/**
 * The Versions page size a network asks for now: its test-only one, while every RPC in effect is
 * on this computer; else undefined (the SDK's own, the most).
 */
export function versionsPageOf(network: EffectiveNetwork): number | undefined {
  return onLocalChain(network) ? network.definition.devVersionsPage : undefined;
}

/**
 * The dev accounts a network offers right now: its own, while every RPC in effect (the person's
 * edits included) is on this computer; else none. Where they are sent from: the first RPC on.
 */
/** Every enabled RPC is on this computer: a local test chain (dev accounts, timing hints). */
export function onLocalChain(network: EffectiveNetwork): boolean {
  return allLocal(network.rpcs.filter((e) => e.enabled));
}

export function devAccountsOf(
  network: EffectiveNetwork,
): { readonly accounts: readonly DevAccount[]; readonly rpcUrl: string } | undefined {
  const accounts = network.definition.devAccounts;
  const on = network.rpcs.filter((e) => e.enabled);
  const first = on[0];
  if (!accounts || !first || !allLocal(on)) return undefined;
  return { accounts, rpcUrl: first.url };
}

function readOverrides(value: unknown, issues: string[]): Record<string, NetworkOverrides> {
  if (!isRecord(value)) return {};
  const out: Record<string, NetworkOverrides> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const entry: { -readonly [K in keyof NetworkOverrides]: NetworkOverrides[K] } = {};
    if (Array.isArray(raw.rpcs)) entry.rpcs = readEndpoints(raw.rpcs, 'rpc', issues, `${id}.rpcs`);
    if (Array.isArray(raw.ipfsGateways)) {
      entry.ipfsGateways = readEndpoints(raw.ipfsGateways, 'gateway', issues, `${id}.ipfs`);
    }
    if (Array.isArray(raw.arweaveGateways)) {
      entry.arweaveGateways = readEndpoints(raw.arweaveGateways, 'gateway', issues, `${id}.ar`);
    }
    out[id] = entry;
  }
  return out;
}

export type SettingsRead =
  | { readonly status: 'OK'; readonly settings: UserSettings; readonly issues: readonly string[] }
  /** Written by a newer client: shown, never overwritten by this one. */
  | { readonly status: 'NEWER'; readonly settings: UserSettings; readonly schema: string }
  | { readonly status: 'INVALID'; readonly issues: readonly string[] };

/** Validate stored settings. Unknown top-level fields are carried through untouched. */
export function readSettings(raw: unknown): SettingsRead {
  if (raw === undefined) return { status: 'OK', settings: DEFAULT_SETTINGS, issues: [] };
  if (!isRecord(raw)) return { status: 'INVALID', issues: ['not an object'] };
  const issues: string[] = [];
  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  const network = isRecord(raw.network) ? raw.network : {};
  const content = isRecord(raw.content) ? raw.content : {};
  const mode = COLOR_MODES.find((m) => m === appearance.mode) ?? DEFAULT_SETTINGS.appearance.mode;
  const theme = THEMES.find((t) => t === appearance.theme) ?? DEFAULT_SETTINGS.appearance.theme;
  const settings: UserSettings = {
    ...raw,
    schema: SETTINGS_SCHEMA,
    revision:
      typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0
        ? raw.revision
        : 0,
    appearance: { ...appearance, mode, theme },
    network: {
      ...network,
      ...(typeof network.selected === 'string' ? { selected: network.selected } : {}),
      overrides: readOverrides(network.overrides, issues),
    },
    // Only an explicit true turns it on.
    content: { ...content, publisherLocations: content.publisherLocations === true },
  };
  if (raw.schema !== SETTINGS_SCHEMA) {
    if (typeof raw.schema === 'string' && raw.schema.startsWith('efs-settings/')) {
      return { status: 'NEWER', settings, schema: raw.schema };
    }
    return { status: 'INVALID', issues: ['unknown schema'] };
  }
  return { status: 'OK', settings, issues };
}

export type ConfigRead =
  | { readonly status: 'OK'; readonly config: OperatorConfig; readonly issues: readonly string[] }
  | { readonly status: 'ABSENT' }
  | { readonly status: 'INVALID'; readonly issues: readonly string[] };

const NETWORK_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Validate the operator's public efs.config.json. */
export function readConfig(raw: unknown): ConfigRead {
  if (!isRecord(raw) || raw.schema !== CONFIG_SCHEMA || !Array.isArray(raw.networks)) {
    return { status: 'INVALID', issues: ['not an efs-config/1 document'] };
  }
  const issues: string[] = [];
  const networks: NetworkDefinition[] = [];
  const seen = new Set<string>();
  for (const item of raw.networks) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !NETWORK_ID.test(item.id) ||
      seen.has(item.id) ||
      typeof item.label !== 'string' ||
      typeof item.chainId !== 'number' ||
      !Number.isSafeInteger(item.chainId) ||
      item.chainId <= 0 ||
      typeof item.core !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(item.core) ||
      typeof item.deployment !== 'string' ||
      typeof item.release !== 'string'
    ) {
      issues.push('a network definition was malformed and skipped');
      continue;
    }
    seen.add(item.id);
    networks.push({
      id: item.id,
      label: item.label.slice(0, MAX_LABEL_LENGTH),
      chainId: item.chainId,
      core: item.core.toLowerCase(),
      deployment: item.deployment,
      release: item.release,
      rpcs: readEndpoints(item.rpcs, 'rpc', issues, `${item.id}.rpcs`),
      ipfsGateways: readEndpoints(item.ipfsGateways, 'gateway', issues, `${item.id}.ipfs`),
      arweaveGateways: readEndpoints(item.arweaveGateways, 'gateway', issues, `${item.id}.ar`),
    });
    const rpcs = networks.at(-1)?.rpcs ?? [];
    const dev = readDevAccounts(item.devAccounts, rpcs, issues, item.id);
    if (dev)
      networks[networks.length - 1] = {
        ...(networks.at(-1) as NetworkDefinition),
        devAccounts: dev,
      };
    const page = readDevVersionsPage(item.devVersionsPage, rpcs, issues, item.id);
    if (page !== undefined)
      networks[networks.length - 1] = {
        ...(networks.at(-1) as NetworkDefinition),
        devVersionsPage: page,
      };
  }
  const defaultNetwork =
    typeof raw.defaultNetwork === 'string' && seen.has(raw.defaultNetwork)
      ? raw.defaultNetwork
      : undefined;
  const delivery = readDelivery(raw.delivery, issues);
  return {
    status: 'OK',
    config: {
      schema: CONFIG_SCHEMA,
      networks,
      ...(defaultNetwork ? { defaultNetwork } : {}),
      ...(delivery ? { delivery } : {}),
    },
    issues,
  };
}

export interface EffectiveNetwork {
  readonly definition: NetworkDefinition;
  readonly rpcs: readonly Endpoint[];
  readonly ipfsGateways: readonly Endpoint[];
  readonly arweaveGateways: readonly Endpoint[];
  /** Which lists the user replaced, so the UI can offer "reset to defaults". */
  readonly customized: { readonly rpcs: boolean; readonly gateways: boolean };
}

/** The network a link's realm names: by id, or by chainId + ledger for the full form. */
export function findNetwork(
  config: OperatorConfig,
  realm:
    | { readonly kind: 'alias'; readonly id: string }
    | { readonly kind: 'full'; readonly chainId: number; readonly ledger: string },
): NetworkDefinition | undefined {
  return realm.kind === 'alias'
    ? config.networks.find((n) => n.id === realm.id)
    : config.networks.find((n) => n.chainId === realm.chainId && n.core === realm.ledger);
}

/** The network used when no link names one: the user's default, else the site's. */
export function defaultNetwork(
  config: OperatorConfig,
  settings: UserSettings,
): NetworkDefinition | undefined {
  const wanted = settings.network.selected ?? config.defaultNetwork ?? config.networks[0]?.id;
  return config.networks.find((n) => n.id === wanted) ?? config.networks[0];
}

/**
 * Combine one of the operator's networks (by default, the default network) with the user's
 * endpoint overrides for it.
 */
export function effectiveNetwork(
  config: OperatorConfig,
  settings: UserSettings,
  chosen: NetworkDefinition | undefined = defaultNetwork(config, settings),
): EffectiveNetwork | undefined {
  const definition = chosen;
  if (!definition) return undefined;
  const overrides = settings.network.overrides[definition.id] ?? {};
  const enabled = (list: readonly Endpoint[]) => list.filter((e) => e.enabled);
  return {
    definition,
    rpcs: enabled(overrides.rpcs ?? definition.rpcs),
    ipfsGateways: enabled(overrides.ipfsGateways ?? definition.ipfsGateways),
    arweaveGateways: enabled(overrides.arweaveGateways ?? definition.arweaveGateways),
    customized: {
      rpcs: overrides.rpcs !== undefined,
      gateways: overrides.ipfsGateways !== undefined || overrides.arweaveGateways !== undefined,
    },
  };
}

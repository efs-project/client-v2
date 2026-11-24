// What the shell knows about the network before any EFS read: which network is selected and
// which endpoints it will use. The deployment pin (is this really the expected EFS deployment?)
// arrives with the SDK; until then nothing here claims the network is verified.

import type { RealmRef } from '../boot/route.ts';
import {
  type ConfigRead,
  defaultNetwork,
  type EffectiveNetwork,
  EMPTY_CONFIG,
  effectiveNetwork,
  endpointLabel,
  findNetwork,
  type UserSettings,
} from '../platform/settings/model.ts';

export type NetworkState =
  /** The host shipped no efs.config.json and the user has added no network. */
  | { readonly status: 'NONE' }
  /** The host's efs.config.json exists but is unusable; shown, never silently ignored. */
  | { readonly status: 'CONFIG_INVALID'; readonly issues: readonly string[] }
  /** A link names a realm this site doesn't set up. Never silently swapped for another. */
  | { readonly status: 'UNKNOWN_REALM'; readonly realm: RealmRef }
  /** A network is selected but every endpoint is disabled or removed. */
  | { readonly status: 'NO_ENDPOINTS'; readonly network: EffectiveNetwork }
  | {
      readonly status: 'CONFIGURED';
      readonly network: EffectiveNetwork;
      /** Label or origin of the first endpoint: what the header shows. Never a full URL. */
      readonly endpointLabel: string;
    };

/**
 * The network for the current view: the one the route's realm names, or the default network
 * when the route names none (the bare root, or an app's own route).
 */
export function networkState(
  config: ConfigRead,
  settings: UserSettings,
  realm?: RealmRef,
): NetworkState {
  if (config.status === 'INVALID') return { status: 'CONFIG_INVALID', issues: config.issues };
  const operator = config.status === 'OK' ? config.config : EMPTY_CONFIG;
  const chosen = realm ? findNetwork(operator, realm) : defaultNetwork(operator, settings);
  if (realm && !chosen) return { status: 'UNKNOWN_REALM', realm };
  const network = effectiveNetwork(operator, settings, chosen);
  if (!network) return { status: 'NONE' };
  const first = network.rpcs[0];
  if (!first) return { status: 'NO_ENDPOINTS', network };
  return { status: 'CONFIGURED', network, endpointLabel: endpointLabel(first) };
}

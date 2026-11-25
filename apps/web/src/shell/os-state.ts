// Session state for one tab: created by boot, passed explicitly, disposed with its scope.
// There is deliberately no module-level instance (no Kernel singleton).

import type { OsRoute } from '../boot/route.ts';
import { type Appearance, applyAppearance, mirrorAppearance } from '../platform/appearance.ts';
import type { OwnerScope } from '../platform/scope.ts';
import type { ConfigRead, UserSettings } from '../platform/settings/model.ts';
import type { SaveResult, SettingsStore } from '../platform/settings/store.ts';
import { effect } from '../state/effect.ts';
import { computed, type Signal, state } from '../state/signals.ts';
import { type NetworkState, networkState } from './network-state.ts';

export interface SettingsInfo {
  /** False when the browser refused storage: changes last only for this tab. */
  readonly persistent: boolean;
  /** True when stored settings come from a newer client version; this one won't overwrite them. */
  readonly readOnly: boolean;
  readonly issues: readonly string[];
}

export interface OsState {
  readonly settings: Signal.State<UserSettings>;
  readonly settingsInfo: Signal.State<SettingsInfo>;
  readonly config: Signal.State<ConfigRead>;
  readonly route: Signal.State<OsRoute>;
  readonly prefersDark: Signal.State<boolean>;
  readonly network: Signal.Computed<NetworkState>;
  readonly appearance: Signal.Computed<Appearance>;
  /** Apply a change with compare-and-set. On CONFLICT the latest settings are loaded instead. */
  updateSettings(change: (current: UserSettings) => UserSettings): Promise<SaveResult>;
}

export interface OsStateInput {
  readonly store: SettingsStore;
  readonly settings: UserSettings;
  readonly settingsInfo: SettingsInfo;
  readonly config: ConfigRead;
  readonly route: OsRoute;
  readonly prefersDark: boolean;
  readonly root: HTMLElement;
}

export function createOsState(input: OsStateInput, scope: OwnerScope): OsState {
  const settings = state(input.settings);
  const settingsInfo = state(input.settingsInfo);
  const config = state(input.config);
  const route = state(input.route);
  const prefersDark = state(input.prefersDark);
  const network = computed(() => {
    const now = route.get();
    return networkState(config.get(), settings.get(), now.kind === 'realm' ? now.realm : undefined);
  });
  const appearance = computed<Appearance>(() => {
    const { mode, theme } = settings.get().appearance;
    return { mode, theme };
  });

  // The appearance classes on <html> always follow the settings and the system preference.
  effect(scope, () => {
    applyAppearance(input.root, appearance.get(), prefersDark.get());
  });

  const reload = async () => {
    const snapshot = await input.store.load();
    if (snapshot.read.status === 'INVALID') return;
    settings.set(snapshot.read.settings);
    settingsInfo.set({
      persistent: snapshot.persistent,
      readOnly: snapshot.read.status === 'NEWER',
      issues: snapshot.read.status === 'OK' ? snapshot.read.issues : [],
    });
  };
  input.store.onExternalChange(() => void reload(), scope.signal);

  return {
    settings,
    settingsInfo,
    config,
    route,
    prefersDark,
    network,
    appearance,
    async updateSettings(change) {
      if (settingsInfo.get().readOnly) return { status: 'READ_ONLY' };
      const result = await input.store.save(change(settings.get()));
      if (result.status === 'SAVED') {
        settings.set(result.settings);
        mirrorAppearance(result.settings.appearance);
      } else if (result.status === 'CONFLICT') {
        await reload();
      }
      return result;
    },
  };
}

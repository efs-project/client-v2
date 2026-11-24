// Registration module for the shell's elements (efs-* only). Imported by the boot entry only.
import { EfsEndpointList } from './endpoint-list.ts';
import { EfsNetworkIndicator } from './network-indicator.ts';
import { EfsPaneHost } from './pane-host.ts';
import { EfsSettingsPanel } from './settings-panel.ts';
import { EfsShell } from './shell.ts';

export function registerShellElements(): void {
  customElements.define('efs-shell', EfsShell);
  customElements.define('efs-pane-host', EfsPaneHost);
  customElements.define('efs-network-indicator', EfsNetworkIndicator);
  customElements.define('efs-settings-panel', EfsSettingsPanel);
  customElements.define('efs-endpoint-list', EfsEndpointList);
}

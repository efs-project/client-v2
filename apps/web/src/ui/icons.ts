// App icons are typed against the generated sprite ids, so a typo is a type error rather than a
// silently blank icon. Pass a label when the icon is the only content of a control: it becomes
// the accessible name, and is shown as text if the icon sprite failed to load (see app.css).
import { html } from 'lit';
import type { AppIcon } from './wa/icon-ids.ts';

export function appIcon(name: AppIcon, label?: string) {
  if (label === undefined) return html`<wa-icon name=${name}></wa-icon>`;
  return html`<wa-icon name=${name} label=${label}></wa-icon><span class="efs-icon-text">${label}</span>`;
}

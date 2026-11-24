// The one base class for EFS custom elements: Lit for rendering, re-rendering automatically
// when a TC39 Signal it read changes. Only this file imports @lit-labs/signals, so a change in
// that experimental bridge touches one place.
import { SignalWatcher } from '@lit-labs/signals';
import { LitElement } from 'lit';

export const EfsElement = SignalWatcher(LitElement);
export { css, html, nothing } from 'lit';

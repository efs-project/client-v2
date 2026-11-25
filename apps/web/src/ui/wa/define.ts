// The only module that loads Web Awesome, and the registration module for its elements:
// importing a component module defines its wa-* element. Imported by the boot entry only.
//
// Icons: both icon libraries are switched to sprite-sheet mode, pointing at the same-origin
// sprite built by tools/build/icons.ts. In its default mode <wa-icon> fetches each SVG and
// assigns it with innerHTML, which enforced Trusted Types forbids; sprite mode renders
// <svg><use href> through Lit instead, and never contacts a CDN.

import { registerIconLibrary } from '@awesome.me/webawesome/dist/components/icon/library.js';
import '@awesome.me/webawesome/dist/components/breadcrumb/breadcrumb.js';
import '@awesome.me/webawesome/dist/components/breadcrumb-item/breadcrumb-item.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/divider/divider.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/drawer/drawer.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/page/page.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/split-panel/split-panel.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tree/tree.js';
import '@awesome.me/webawesome/dist/components/tree-item/tree-item.js';
import './styles.css';
import { SYSTEM_ICONS } from './icon-ids.ts';

const SPRITE = 'icons/efs-icons.svg';

function spriteUrl(id: string): string {
  return `${new URL(SPRITE, document.baseURI).href}#${id}`;
}

const regular = new Set<string>(SYSTEM_ICONS.regular);

/**
 * Runs on every icon from our libraries. A sprite-mode <svg> has no viewBox of its own, so its
 * width would fall back to the 300px replaced-element default and overflow the page; filling the
 * icon's canvas lets the referenced <symbol> (which has the viewBox) center and scale inside it,
 * like Font Awesome's fixed-width icons. CSSOM styles are allowed under our CSP.
 */
function fitSprite(svg: SVGElement): void {
  svg.setAttribute('fill', 'currentColor');
  svg.style.width = '100%';
}

/**
 * Sprite-sheet icons fail silently when the sprite can't load (blocked, offline, wrong host
 * fallback). Check it once; on failure, mark <html> so icon-only controls show their label as
 * text (ui/icons.ts, app.css) instead of going blank. `force-cache` lets the <use> references
 * reuse this response.
 */
export async function watchIconSprite(root: HTMLElement, signal: AbortSignal): Promise<void> {
  let ok = false;
  try {
    const response = await fetch(new URL(SPRITE, document.baseURI), {
      cache: 'force-cache',
      credentials: 'same-origin',
      signal,
    });
    ok = response.ok && (response.headers.get('content-type') ?? '').includes('svg');
  } catch {
    ok = false;
  }
  if (!ok && !signal.aborted) root.setAttribute('data-efs-icons', 'missing');
}

/** Must run before any element renders an icon (boot calls it before mounting the shell). */
export function registerIconLibraries(): void {
  registerIconLibrary('system', {
    // Same fallback as Web Awesome's own system library: a regular icon if there is one, else solid.
    resolver: (name, _family, variant) =>
      spriteUrl(
        variant === 'regular' && regular.has(name)
          ? `system-regular-${name}`
          : `system-solid-${name}`,
      ),
    mutator: fitSprite,
    spriteSheet: true,
  });
  registerIconLibrary('default', {
    resolver: (name) => spriteUrl(`app-${name}`),
    mutator: fitSprite,
    spriteSheet: true,
  });
}

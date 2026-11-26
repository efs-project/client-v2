// Every e2e click goes through press(); tools/checks/e2e-press.test.ts refuses a raw click.
//
// A wa-button keeps its native button inside its shadow root. Playwright's own "enabled" check
// sees only the host, which it counts as enabled even while the button is disabled or loading,
// and wa-button then drops the click: the inner button is disabled, and its handler stops a
// loading button's click before ours runs. So a test that clicked a button it believed enabled
// could pass while the click did nothing (PM, 2026-11-26: edit-failures case 9 did, every run).
// press() waits for a wa-button (the host, or anything inside it) to be neither disabled nor
// loading, then clicks; any other target gets Playwright's own actionability checks.
//
// A test that must press a disabled button on purpose (a person's second press) clicks raw, on a
// line marked `press-raw:` with the reason.
//
// EFS_PRESS_CENSUS=<file>: the old behaviour (no wait), with one JSON line per wa-button press
// recording its state at the call. Used once, to count the clicks that landed on a disabled one.

import { appendFileSync } from 'node:fs';
import { expect, type Locator, test } from '@playwright/test';

type ClickOptions = Parameters<Locator['click']>[0];

interface ButtonState {
  /** The target is a wa-button, or inside one. */
  readonly button: boolean;
  readonly disabled: boolean;
  readonly loading: boolean;
}

const stateOf = (target: Locator): Promise<ButtonState> =>
  target.evaluate((el: Element) => {
    const root = el.getRootNode();
    const host =
      el.closest('wa-button') ??
      (root instanceof ShadowRoot && root.host.localName === 'wa-button' ? root.host : null);
    if (!host) return { button: false, disabled: false, loading: false };
    const b = host as unknown as { disabled?: unknown; loading?: unknown };
    return { button: true, disabled: b.disabled === true, loading: b.loading === true };
  });

const CENSUS = process.env.EFS_PRESS_CENSUS;

/** The test file and line that called press(), from the stack. */
function callSite(stack: string | undefined): string {
  const frames = (stack ?? '').split('\n').slice(1);
  for (const frame of frames) {
    const m = /tests\/e2e\/([^:()\s]+\.ts):(\d+)/.exec(frame);
    if (m && m[1] !== 'press.ts') return `${m[1]}:${m[2]}`;
  }
  return '?';
}

/** Clicks `target`; a wa-button only once it is neither disabled nor loading (see the header). */
export async function press(target: Locator, options?: ClickOptions): Promise<void> {
  const stack = CENSUS ? new Error().stack : undefined;
  const before = await stateOf(target);
  if (CENSUS) {
    if (before.button) {
      const project = test.info().project.name;
      appendFileSync(CENSUS, `${JSON.stringify({ site: callSite(stack), project, ...before })}\n`);
    }
    await target.click(options);
    return;
  }
  if (before.button && (before.disabled || before.loading)) {
    await expect
      .poll(() => stateOf(target), {
        message: `press(${target}): a disabled or loading wa-button drops the click`,
      })
      .toEqual({ button: true, disabled: false, loading: false });
  }
  await target.click(options);
}

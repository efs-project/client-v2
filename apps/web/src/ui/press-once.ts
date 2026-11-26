/**
 * Disables the button that was just pressed, at once, before the next render: wa-button drops a
 * click while it's disabled, so a second press (a double click, Enter then a click) never reaches
 * the handler. Call it only after the press started its action, and bind that button's
 * `.disabled` with `live()`: the next render then sets it from the state again, so it can't stay
 * disabled once the action is over.
 */
export function pressedOnce(event: Event): void {
  const button = event.currentTarget;
  if (button instanceof HTMLElement && 'disabled' in button) button.disabled = true;
}

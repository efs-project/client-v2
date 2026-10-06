// The only module that imports the Signals polyfill. The TC39 proposal is at
// Stage 1; a proposal revision should change this file and nothing else.
import { Signal } from 'signal-polyfill';

export { Signal };

export interface ReadonlySignal<T> {
  get(): T;
}

export function state<T>(initial: T): Signal.State<T> {
  return new Signal.State(initial);
}

export function computed<T>(fn: () => T): Signal.Computed<T> {
  return new Signal.Computed(fn);
}

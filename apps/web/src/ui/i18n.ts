import { MessageFormat } from 'messageformat';
import { type Direction, directionOf } from '../platform/locale.ts';
import en from './messages/en.json';

export type MessageId = keyof typeof en;
export type Catalog = Readonly<Record<MessageId, string>>;
export type MessageValues = Readonly<Record<string, string | number>>;

export const SOURCE_LOCALE = 'en';
/** Pseudo-locales ship so the exact tested artifact can be checked; they are chosen only on exact request. */
export const PSEUDO_LOCALES = ['en-XA', 'ar-XB'] as const;
export const AVAILABLE_LOCALES = [SOURCE_LOCALE, ...PSEUDO_LOCALES] as const;

// Literal specifiers only: no module URL is ever assembled at runtime.
const loaders: Record<string, () => Promise<{ default: Catalog }>> = {
  'en-XA': () => import('./messages/en-XA.json'),
  'ar-XB': () => import('./messages/ar-XB.json'),
};

export interface Translator {
  readonly locale: string;
  readonly dir: Direction;
  t(id: MessageId, values?: MessageValues): string;
}

export async function loadTranslator(locale: string): Promise<Translator> {
  const loader = loaders[locale];
  const catalog: Catalog = loader ? (await loader()).default : en;
  const resolved = loader ? locale : SOURCE_LOCALE;
  const dir = directionOf(resolved);
  const formatters = new Map<MessageId, MessageFormat>();
  return {
    locale: resolved,
    dir,
    t(id, values = {}) {
      let formatter = formatters.get(id);
      if (!formatter) {
        formatter = new MessageFormat(resolved, catalog[id], { dir });
        formatters.set(id, formatter);
      }
      return formatter.format(values);
    },
  };
}

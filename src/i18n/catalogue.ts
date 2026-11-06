import { en, type Messages } from './messages/en.ts';
import type { Locale } from './locales.ts';
export async function loadMessages(locale: Locale): Promise<Messages> {
  switch (locale) {
    case 'hu':
      return (await import('./messages/hu.ts')).hu;
    case 'sv':
      return (await import('./messages/sv.ts')).sv;
    default:
      return en;
  }
}
export type MessageKey = keyof Messages;
export type Translate = (key: MessageKey, ...values: (string | number)[]) => string;
export function translator(messages: Messages): Translate {
  return (key, ...values) =>
    messages[key].replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''));
}

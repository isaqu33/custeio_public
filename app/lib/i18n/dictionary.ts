import { enUS, type AppCopy } from './en-us';
import { ptBR } from './pt-br';
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from './locales';

export type { AppCopy };

export const DICTIONARIES: Record<SupportedLocale, AppCopy> = {
  'en-US': enUS,
  'pt-BR': ptBR,
};

export function getCopy(locale: unknown): AppCopy {
  return DICTIONARIES[normalizeLocale(locale)];
}

export const defaultCopy = DICTIONARIES[DEFAULT_LOCALE];

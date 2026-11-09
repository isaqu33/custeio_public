export const SUPPORTED_LOCALES = ['en-US', 'pt-BR'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'pt-BR';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'en-US': 'English (US)',
  'pt-BR': 'Português (Brasil)',
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function normalizeLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

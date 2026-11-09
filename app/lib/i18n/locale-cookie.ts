import type { SupportedLocale } from './locales';

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Persists the preferred locale for server-rendered layouts after a profile
 * language change. The value is still validated server-side before use.
 */
export function setAppLocaleCookie(locale: SupportedLocale) {
  document.cookie = `app_locale=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

'use client';

import { createContext, useContext } from 'react';
import { setActiveCopy } from './active-copy';
import type { AppCopy } from './dictionary';
import { defaultCopy } from './dictionary';
import { DEFAULT_LOCALE, type SupportedLocale } from './locales';

type I18nContextValue = {
  locale: SupportedLocale;
  copy: AppCopy;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  copy: defaultCopy,
});

export function I18nProvider({
  locale,
  copy,
  children,
}: I18nContextValue & { children: React.ReactNode }) {
  // Mirrors the dictionary into a module-level slot so non-React helpers such as
  // `showSuccessToast` can localize their default messages. Idempotent, so it is
  // safe to run on every render.
  setActiveCopy(copy);

  return <I18nContext.Provider value={{ locale, copy }}>{children}</I18nContext.Provider>;
}

export function useCopy() {
  return useContext(I18nContext).copy;
}

export function useLocale() {
  return useContext(I18nContext).locale;
}

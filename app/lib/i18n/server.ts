import type { Session } from 'next-auth';
import { cookies } from 'next/headers';
import { getCopy } from './dictionary';
import { normalizeLocale } from './locales';

/**
 * Resolves server-rendered copy for protected pages.
 *
 * The locale cookie is preferred because account language changes can happen
 * before the auth JWT has been refreshed in every browser/E2E path. The value
 * is constrained through `normalizeLocale`, so unsupported values fall back to
 * the session/default locale.
 */
export async function getServerCopyForSession(session: Session | null | undefined) {
  const cookieStore = await cookies();
  const cookieLanguage = cookieStore.get('app_locale')?.value;
  const normalizedCookieLanguage = normalizeLocale(cookieLanguage);
  const locale =
    cookieLanguage && normalizedCookieLanguage === cookieLanguage
      ? normalizedCookieLanguage
      : normalizeLocale(session?.user?.language);
  return getCopy(locale);
}

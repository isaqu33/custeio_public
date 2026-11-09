import { toast } from 'sonner';
import { ApiError } from './api-client';
import { getActiveCopy } from './i18n/active-copy';

/**
 * Success toast. Falls back to the localized standard message.
 *
 * `options` carries the sonner extras a couple of callers need: a second line of
 * detail, and a longer dwell for a toast that explains what happens next rather
 * than just confirming a click.
 *
 * The dictionary is read at call time (not module load) through `getActiveCopy`,
 * which `I18nProvider` keeps in sync — so a toast fired from a non-React helper
 * still follows the user's language.
 */
export function showSuccessToast(
  message?: string,
  options?: { description?: string; duration?: number },
) {
  toast.success(message ?? getActiveCopy().common.actionSuccess, options);
}

/** Error toast. Falls back to the localized standard message. */
export function showErrorToast(message?: string) {
  toast.error(message ?? getActiveCopy().common.actionError);
}

/**
 * Error toast for a failed API call. The server only ever sends a coarse code
 * (`{ done: false, error: 'CONFLICT' }`), so this maps it to a localized
 * message; `overrides` lets a caller say something more specific for a code it
 * knows the meaning of (e.g. CONFLICT on "create store" = duplicate CNPJ).
 */
export function showApiErrorToast(err: ApiError, overrides: Partial<Record<string, string>> = {}) {
  const code = (err.body as { error?: string } | null)?.error;
  const known = getActiveCopy().common.apiErrors as Record<string, string>;
  showErrorToast((code && (overrides[code] ?? known[code])) || undefined);
}

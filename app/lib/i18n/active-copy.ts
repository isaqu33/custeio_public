import { defaultCopy, type AppCopy } from './dictionary';

let activeCopy: AppCopy = defaultCopy;

/**
 * Registers the dictionary for the current browser session so helpers that run
 * outside React (toasts, for example) can read localized strings without a hook.
 *
 * Called by `I18nProvider`. On the server this stays at the default dictionary,
 * which is safe because every consumer runs in the browser, after the provider
 * has rendered.
 */
export function setActiveCopy(copy: AppCopy) {
  activeCopy = copy;
}

/** Dictionary registered by `I18nProvider`, falling back to the default one. */
export function getActiveCopy(): AppCopy {
  return activeCopy;
}

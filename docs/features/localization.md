# Localization

## Purpose

Localization lets each user choose the UI language used across protected pages, navigation,
dialogs, forms, table controls, and client-visible validation.

## Supported languages

- `pt-BR` is the **default** (`DEFAULT_LOCALE`, since 2026-09-14): the product ships in Brazil, so
  an unauthenticated visitor, a stale cookie or an unknown value all land in Portuguese.
- `en-US` is the alternate, and the **source dictionary**: `app/lib/i18n/en-us.ts` defines the
  `AppCopy` type, and `pt-BR` must satisfy the same TypeScript dictionary shape.

`SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `LOCALE_LABELS` and `normalizeLocale` live in
[`app/lib/i18n/locales.ts`](../../app/lib/i18n/locales.ts). `normalizeLocale` collapses any
unknown value to the default, so untrusted input (cookie, form field, stale JWT) can never
reach the `language` enum on the Users schema.

## Behavior

- Users change language from the Account modal ([`components/edit-profile-modal.tsx`](../../components/edit-profile-modal.tsx)).
- The preference is stored on the user record (`Users.language`) and carried in the
  authenticated session (`session.user.language`).
- On save the client writes an `app_locale` cookie **and** calls `updateSession`, then
  `router.refresh()`. The cookie is what makes the very next server render use the new locale —
  the JWT may still carry the previous value until it refreshes.
- `app/(protected)/layout.tsx` resolves the locale in this order: valid `app_locale` cookie →
  stored user preference → session → default. It then renders `<html lang={locale}>` and wraps
  the tree in `I18nProvider`.
- Client components read copy through `useCopy()` / `useLocale()` from
  [`app/lib/i18n/client.tsx`](../../app/lib/i18n/client.tsx).
- Non-React helpers (toasts, for example) read the dictionary through `getActiveCopy()`, which
  `I18nProvider` keeps in sync.
- Isolated component tests that mount no provider get the default (Portuguese) copy, so assert on
  copy from the dictionary rather than on a hardcoded English string.

## Implementation rules

- Add new first-party UI text to `app/lib/i18n/en-us.ts` first — it is the source of the
  `AppCopy` type.
- Update every derived dictionary, currently `app/lib/i18n/pt-br.ts`, in the same change.
  TypeScript enforces this: `ptBR` is typed as `AppCopy`, so a missing or extra key fails
  `npm run typecheck`.
- Use semantic dictionary keys. Do not key strings by the English sentence.
- Use `formatCopy(template, values)` for interpolation — dictionaries carry `{name}`-style
  tokens so copy stays framework-independent.
- Build zod schemas from the active dictionary via a factory (see
  [`components/edit-profile-modal/schema.ts`](../../components/edit-profile-modal/schema.ts)) so
  validation messages follow the user's language instead of being frozen at module load.
- Keep API error codes and machine-readable contracts stable — only user-facing copy is
  translated.
- `app/lib/i18n/pt-br.ts` is in `cspell.json` `ignorePaths`; the spell checker is English-only.

## Provider placement

`I18nProvider` and `AuthProvider` both sit above `SidebarProvider` in the protected layout.
`AuthProvider` (NextAuth's `SessionProvider`) has to be above the sidebar because `NavUser`
renders the Account modal, and that modal calls `useSession()` to refresh the JWT after a
language change.

## Tests

- Dictionary shape, fallback behavior, placeholder formatting and localized validation messages
  are covered by [`__tests__/server/i18n.spec.ts`](../../__tests__/server/i18n.spec.ts).
- `ptBR` conforming to `AppCopy` is enforced by the typecheck, not only by tests.

## Coverage

Every page under `app/(protected)` reads its copy from the dictionary (server pages through
`getServerCopyForSession`, client components through `useCopy`). The dictionary carries only copy for screens that are still in the app. The Playwright specs under `e2e/` still assert English labels and have
not been adapted to the Portuguese default.

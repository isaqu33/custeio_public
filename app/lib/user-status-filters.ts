/**
 * The "Situação" filter on the Users screen.
 *
 * Kept apart from `app/lib/services/users.ts` because the table (a client
 * component) needs the list to render its options, and that service pulls in
 * the Mongo models. Whitelisted: the value arrives in the URL, and anything else
 * is ignored rather than trusted.
 */
export const USER_STATUS_FILTERS = [
  'never_signed_in',
  'no_organization',
  'system_access',
  'disabled',
] as const;

export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

export function isUserStatusFilter(value: string | undefined): value is UserStatusFilter {
  return USER_STATUS_FILTERS.includes(value as UserStatusFilter);
}

import { z } from 'zod';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { defaultCopy } from '@/app/lib/i18n/dictionary';

/**
 * Every schema here is built from the active dictionary so validation messages
 * follow the user's language instead of being frozen at module-evaluation time.
 * Kept out of the client component so tests can exercise them without React.
 */
function buildPieces(copy: AppCopy) {
  const validation = copy.validation;

  const shared = {
    name: z.string().min(2, validation.nameMin),
  };

  return { shared };
}

export function createOrganizationSchema(copy: AppCopy) {
  return z.object(buildPieces(copy).shared);
}

export function updateOrganizationSchema(copy: AppCopy) {
  return z.object({ ...buildPieces(copy).shared, id: z.string().optional() });
}

export type OrganizationCreateValues = z.infer<ReturnType<typeof createOrganizationSchema>>;
export type OrganizationUpdateValues = z.infer<ReturnType<typeof updateOrganizationSchema>>;

/** Default-locale instances, for consumers that only need the inferred shape. */
export const organizationFormSchema = createOrganizationSchema(defaultCopy);
export const organizationUpdateSchema = updateOrganizationSchema(defaultCopy);

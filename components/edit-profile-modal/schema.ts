import { z } from 'zod';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { defaultCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import { SUPPORTED_LOCALES } from '@/app/lib/i18n/locales';
import { PASSWORD_MIN_LENGTH } from '@/app/lib/validations';

/**
 * Built from the active dictionary so validation messages follow the user's
 * language instead of being frozen at module-evaluation time. Kept out of the
 * client component so tests can exercise it without pulling in React.
 */
export function createProfileFormSchema(copy: AppCopy) {
  return z
    .object({
      username: z.string().min(2, {
        message: copy.validation.nameMin,
      }),
      userEmail: z
        .string()
        .trim()
        .min(1, copy.validation.emailRequired)
        .email(copy.validation.invalidEmail),
      password: z.string().optional(),
      confirmPassword: z.string().optional(),
      language: z.enum(SUPPORTED_LOCALES),
    })
    .superRefine((data, ctx) => {
      // If the user filled in the password field, validate both
      if (data.password || data.confirmPassword) {
        if (!data.password || data.password.trim().length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['password'],
            message: copy.validation.passwordCannotBeEmpty,
          });
        } else if (data.password.trim().length < PASSWORD_MIN_LENGTH) {
          ctx.addIssue({
            code: 'custom',
            path: ['password'],
            message: formatCopy(copy.validation.passwordMin, { count: PASSWORD_MIN_LENGTH }),
          });
        }
        if (!data.confirmPassword || data.confirmPassword.trim().length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['confirmPassword'],
            message: copy.validation.confirmPasswordRequired,
          });
        }

        if (data.password && data.confirmPassword && data.password !== data.confirmPassword) {
          ctx.addIssue({
            code: 'custom',
            path: ['confirmPassword'],
            message: copy.validation.passwordsDoNotMatch,
          });
        }
      }
    });
}

export const profileFormSchema = createProfileFormSchema(defaultCopy);

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

import { z } from 'zod';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import { PASSWORD_MIN_LENGTH } from '@/app/lib/validations';

/**
 * Built from the active dictionary so validation messages follow the user's
 * language instead of being frozen at module-evaluation time. Kept out of the
 * client component so tests can exercise it without pulling in React.
 */
export function createUserSchema(copy: AppCopy) {
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
      password: z
        .string()
        .trim()
        .min(
          PASSWORD_MIN_LENGTH,
          formatCopy(copy.validation.passwordMin, { count: PASSWORD_MIN_LENGTH }),
        ),
      confirmPassword: z.string().min(1, {
        message: copy.validation.confirmPasswordRequired,
      }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      path: ['confirmPassword'],
      message: copy.validation.passwordsDoNotMatch,
    });
}

export function updateUserSchema(copy: AppCopy) {
  return z.object({
    username: z.string().min(2, {
      message: copy.validation.nameMin,
    }),
    userEmail: z
      .string()
      .trim()
      .min(1, copy.validation.emailRequired)
      .email(copy.validation.invalidEmail),
  });
}

export type CreateUserValues = z.infer<ReturnType<typeof createUserSchema>>;
export type UpdateUserValues = z.infer<ReturnType<typeof updateUserSchema>>;

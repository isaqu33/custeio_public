'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { PASSWORD_MIN_LENGTH } from '@/app/lib/validations';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { RouterLike, User } from './types';

// Built per render rather than at module load: the messages come from the
// dictionary, and a schema frozen at import time keeps the first language it
// saw.
function createResetPasswordFormSchema(copy: AppCopy) {
  return z
    .object({
      newPassword: z
        .string()
        .min(
          PASSWORD_MIN_LENGTH,
          formatCopy(copy.validation.passwordMin, { count: PASSWORD_MIN_LENGTH }),
        ),
      confirmPassword: z.string(),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: copy.validation.passwordsDoNotMatch,
      path: ['confirmPassword'],
    });
}

type ResetPasswordFormValues = z.infer<ReturnType<typeof createResetPasswordFormSchema>>;

/**
 * Administrative password reset. The server marks the new password temporary,
 * so the user is forced to change it on their next sign-in and the operator who
 * typed it does not keep working access to the account.
 */
export function ResetUserPasswordDialog({ user, router }: { user: User; router: RouterLike }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(createResetPasswordFormSchema(copy)),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ResetPasswordFormValues) {
    setIsSubmitting(true);
    try {
      await apiFetch(endpointFor(AppFeature.USERS_RESET_PASSWORD), {
        method: 'POST',
        body: {
          userId: user._id,
          newPassword: values.newPassword,
          confirmPassword: values.confirmPassword,
        },
        cache: 'no-store',
      });
      showSuccessToast();
      router.refresh();
      handleOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      form.reset();
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <ActionButton
          type="button"
          action="reset"
          variant="outline"
          size="icon"
          title={formatCopy(copy.system.users.resetPasswordFor, { name: user.name })}
          iconOnly
        />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{copy.system.users.resetPasswordTitle}</DialogTitle>
          <DialogDescription>
            {formatCopy(copy.system.users.resetPasswordDescription, { name: user.name })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{copy.system.users.newPassword}</FormLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <FormControl>
                      <Input
                        {...field}
                        className="px-10"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                      />
                    </FormControl>
                    <button
                      type="button"
                      aria-label={
                        showNewPassword
                          ? copy.system.users.hidePassword
                          : copy.system.users.showPassword
                      }
                      className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowNewPassword((value) => !value)}
                    >
                      {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{copy.system.users.confirmPassword}</FormLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <FormControl>
                      <Input
                        {...field}
                        className="px-10"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                      />
                    </FormControl>
                    <button
                      type="button"
                      aria-label={
                        showConfirmPassword
                          ? copy.system.users.hidePassword
                          : copy.system.users.showPassword
                      }
                      className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {copy.common.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? copy.system.users.resetting : copy.common.reset}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

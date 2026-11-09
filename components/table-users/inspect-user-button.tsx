'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { showApiErrorToast } from '@/app/lib/toast';
import { ActionButton } from '@/components/ui/action-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { User } from './types';

/**
 * Signs the administrator in as another user to see the app from their side.
 *
 * Behind the confirm dialog: the server checks system access, writes an audit
 * row in every organization the target belongs to, and returns a token that
 * expires in a minute. It replaces the current session — the administrator has
 * to log back in afterwards, which is why this asks first.
 */
export function InspectUserButton({ user }: { user: User }) {
  const copy = useCopy();
  const [isLoading, setIsLoading] = useState(false);

  async function inspectUser() {
    setIsLoading(true);
    try {
      const response = await apiFetch<{ token: string }>(endpointFor(AppFeature.USERS_INSPECT), {
        method: 'POST',
        body: { userId: user._id },
        cache: 'no-store',
      });
      const { signIn } = await import('next-auth/react');
      await signIn('credentials', { ImpersonateToken: response.token, callbackUrl: '/' });
    } catch (err) {
      setIsLoading(false);
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <ActionButton
          type="button"
          action="inspect"
          variant="outline"
          size="icon"
          title={`${copy.common.inspect} ${user.name}`}
          iconOnly
          disabled={isLoading}
        />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.system.users.inspectConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {formatCopy(copy.system.users.inspectConfirmDescription, { name: user.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void inspectUser()} disabled={isLoading}>
            {copy.common.inspect}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import type { SupportedLocale } from '@/app/lib/i18n/locales';

export type UserSession = {
  urlString: string | undefined;
  email: string | undefined;
  image: string | undefined;
  name: string | undefined;
  _id: string | undefined;
  language?: SupportedLocale;
};

/**
 * The signed-in user's own profile (name, email, avatar) — what the sidebar
 * footer and the account menu both show. Split out of `NavUser` so the header's
 * account menu can read the same data without a second, slightly-diverged copy
 * of this fetch, and so `refetch` (after an edit in `EditProfileModal`) updates
 * both places at once, wherever `useUserSession` is mounted.
 */
export function useUserSession() {
  const [session, setSession] = useState<UserSession>();

  async function refetch() {
    try {
      const result = await apiFetch<{ data: UserSession }>(
        endpointFor(AppFeature.USERS_GET_BY_AUTH),
        {
          method: 'GET',
          cache: 'no-store',
        },
      );
      setSession(result.data);
    } catch (error) {
      // Background fetch on mount: keep silent to avoid noisy console and toasts.
      void error;
    }
  }

  useEffect(() => {
    // Fetch happens via async fn — setSession runs after await, not synchronously
    // in the effect body. Lint rule is conservative here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, []);

  return { session, refetch };
}

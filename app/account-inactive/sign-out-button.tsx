'use client';

import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // Clear the cookie without Auth.js redirecting to an absolute URL (its
        // callbackUrl resolves to the container's bind address in dev), then go to
        // /login on this origin.
        await signOut({ redirect: false });
        router.replace('/login');
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}

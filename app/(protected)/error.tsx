'use client';

import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Home, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('[protected] Render error:', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5" />
            <span className="text-sm font-medium">Something went wrong</span>
          </div>
          <CardTitle>Failed to load this page</CardTitle>
          <CardDescription>
            An unexpected error happened while rendering. You can try again, or go back to the
            dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="mr-2 size-4" />
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/organization/dashboard')}
              className="flex-1"
            >
              <Home className="mr-2 size-4" />
              Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

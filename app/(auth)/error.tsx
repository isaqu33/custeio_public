'use client';

import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[auth] Render error:', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5" />
            <span className="text-sm font-medium">Login unavailable</span>
          </div>
          <CardTitle>Failed to load the login screen</CardTitle>
          <CardDescription>An unexpected error happened. Please try again.</CardDescription>
        </CardHeader>
        <CardContent>
          {error.digest && (
            <p className="mb-3 text-xs text-muted-foreground">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
          <Button onClick={reset} className="w-full">
            <RefreshCw className="mr-2 size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

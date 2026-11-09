'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { PASSWORD_MIN_LENGTH } from '@/app/lib/validations';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

type ClaimValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

// Built from `copy` rather than at module scope, so the messages follow the
// locale instead of freezing whichever loaded first.
function createClaimSchema(copy: ReturnType<typeof useCopy>) {
  return z
    .object({
      name: z.string().trim().min(2, copy.validation.nameMin).max(100),
      email: z
        .string()
        .trim()
        .min(1, copy.validation.emailRequired)
        .email(copy.validation.invalidEmail),
      password: z
        .string()
        .min(
          PASSWORD_MIN_LENGTH,
          formatCopy(copy.validation.passwordMin, { count: PASSWORD_MIN_LENGTH }),
        ),
      confirmPassword: z.string().min(1, copy.validation.confirmPasswordRequired),
    })
    .refine((value) => value.password === value.confirmPassword, {
      message: copy.validation.passwordsDoNotMatch,
      path: ['confirmPassword'],
    });
}

/**
 * The owner of a new organization creates their own login from the invite link.
 * On success they are signed straight in with the credentials just typed, so the
 * first thing they see is the app rather than a login screen.
 */
export function ClaimForm({
  token,
  organizationName,
}: {
  token: string;
  organizationName: string;
}) {
  const copy = useCopy();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const schema = useMemo(() => createClaimSchema(copy), [copy]);
  const form = useForm<ClaimValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  async function onSubmit(values: ClaimValues) {
    setIsLoading(true);
    setError('');
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_CLAIM_INVITE), {
        method: 'POST',
        body: {
          token,
          name: values.name,
          email: values.email,
          password: values.password,
        },
        cache: 'no-store',
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setError(copy.claim.emailTaken);
        else if (err.status === 404) setError(copy.claim.invalidLink);
        else if (err.status === 429) setError(copy.claim.tooManyAttempts);
        else setError(copy.claim.genericError);
      } else {
        setError(copy.claim.genericError);
      }
      setIsLoading(false);
      return;
    }

    // The account exists now. If signing in fails for any reason, the login
    // screen is still the right place for them to land.
    try {
      const res = await signIn('credentials', {
        redirect: false,
        Email: values.email.trim(),
        Password: values.password,
        callbackUrl: '/',
      });
      router.push(res?.error ? '/login' : '/');
      router.refresh();
    } catch {
      router.push('/login');
    }
  }

  return (
    <Form {...form}>
      <Card className="w-full max-w-sm">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <CardHeader className="space-y-2">
            <CardTitle className="text-lg font-bold">{copy.claim.title}</CardTitle>
            <CardDescription>
              {formatCopy(copy.claim.description, { organization: organizationName })}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid gap-2">
                  <FormLabel>{copy.claim.name}</FormLabel>
                  <div className="relative">
                    <User className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="name"
                        placeholder={copy.claim.namePlaceholder}
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="grid gap-2">
                  <FormLabel>{copy.claim.email}</FormLabel>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        autoComplete="email"
                        placeholder={copy.claim.emailPlaceholder}
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem className="grid gap-2">
                  <FormLabel>{copy.claim.password}</FormLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                    <FormControl>
                      <Input
                        {...field}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="px-10"
                        disabled={isLoading}
                      />
                    </FormControl>
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={showPassword ? copy.auth.hidePassword : copy.auth.showPassword}
                      disabled={isLoading}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
                <FormItem className="grid gap-2">
                  <FormLabel>{copy.claim.confirmPassword}</FormLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                    <FormControl>
                      <Input
                        {...field}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error ? (
              <div
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </CardContent>

          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? copy.claim.submitting : copy.claim.submit}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </Form>
  );
}

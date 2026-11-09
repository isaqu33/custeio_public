'use client';

import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import { showErrorToast } from '@/app/lib/toast';
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
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

type SignInValues = {
  Email: string;
  Password: string;
};

/*
  Built from `copy`, not declared at module scope: a schema created once would
  freeze whichever locale happened to load first, and every validation message
  would stay in that language after a locale switch.
*/
function createFormSchema(copy: ReturnType<typeof useCopy>) {
  return z.object({
    Email: z
      .string()
      .trim()
      .min(1, copy.validation.emailRequired)
      .email(copy.validation.invalidEmail),
    Password: z.string().trim().min(1, copy.validation.passwordCannotBeEmpty),
  });
}

export default function SignIn() {
  const copy = useCopy();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const formSchema = useMemo(() => createFormSchema(copy), [copy]);
  const form = useForm<SignInValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      Email: '',
      Password: '',
    },
  });

  // Focus follows the step, so the keyboard lands on the field that just appeared
  // instead of leaving the user to click into it.
  useEffect(() => {
    form.setFocus(step === 'email' ? 'Email' : 'Password');
  }, [form, step]);

  const handleEmailStep = async () => {
    setAuthError('');
    // Only the email is validated here — the password field is not mounted yet,
    // so a full-form submit would fail on a field nobody could have filled in.
    if (await form.trigger('Email')) setStep('password');
  };

  const handleBackToEmail = () => {
    setAuthError('');
    setShowPassword(false);
    setStep('email');
  };

  const handleSubmit = async ({ Email, Password }: SignInValues) => {
    setAuthError('');
    setIsLoading(true);

    try {
      const res = await signIn('credentials', {
        redirect: false,
        Email: Email.trim(),
        Password,
        callbackUrl: '/',
      });

      if (res?.error) {
        setAuthError(copy.auth.invalidCredentials);
        showErrorToast(copy.auth.invalidCredentials);
        return;
      }

      // Navigate with a relative path. `res.url` is an absolute URL that Auth.js
      // builds from the inferred host — under the dev container bound to 0.0.0.0
      // that resolves to http://0.0.0.0:3000 and pushes the browser off-origin.
      router.push('/');
      router.refresh();
    } catch {
      setAuthError(copy.auth.signInError);
      showErrorToast(copy.auth.signInError);
    } finally {
      setIsLoading(false);
    }
  };

  const isEmailStep = step === 'email';
  const email = form.watch('Email');

  return (
    <Form {...form}>
      <Card className="relative w-full max-w-sm" data-e2e-id="auth-login-form">
        <form
          onSubmit={
            isEmailStep
              ? (event) => {
                  event.preventDefault();
                  void handleEmailStep();
                }
              : form.handleSubmit(handleSubmit)
          }
          className="space-y-6"
        >
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{formatCopy(copy.auth.step, { step: isEmailStep ? 1 : 2 })}</span>
              <div className="flex gap-1" aria-hidden="true">
                {[1, 2].map((item) => (
                  <span
                    key={item}
                    className={`h-1.5 w-8 rounded-full ${
                      item <= (isEmailStep ? 1 : 2) ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
            <CardTitle className="text-lg font-bold">
              {isEmailStep ? copy.auth.emailStepTitle : copy.auth.passwordStepTitle}
            </CardTitle>
            <CardDescription>
              {isEmailStep ? copy.auth.emailStepDescription : copy.auth.passwordStepDescription}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isEmailStep ? (
              <FormField
                control={form.control}
                name="Email"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <FormLabel>{copy.account.email}</FormLabel>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          autoComplete="email"
                          placeholder={copy.account.emailPlaceholder}
                          className="pl-10"
                          disabled={isLoading}
                          data-e2e-id="auth-login-email"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <Mail className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={email}>
                      {email}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto shrink-0 px-0 text-xs"
                    onClick={handleBackToEmail}
                    disabled={isLoading}
                    data-e2e-id="auth-login-change-email"
                  >
                    {copy.auth.changeEmail}
                  </Button>
                </div>

                <FormField
                  control={form.control}
                  name="Password"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel>{copy.account.password}</FormLabel>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                        <FormControl>
                          <Input
                            {...field}
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            placeholder={copy.account.passwordPlaceholder}
                            className="px-10"
                            disabled={isLoading}
                            data-e2e-id="auth-login-password"
                          />
                        </FormControl>
                        <button
                          type="button"
                          onClick={() => setShowPassword((visible) => !visible)}
                          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          aria-label={
                            showPassword ? copy.auth.hidePassword : copy.auth.showPassword
                          }
                          disabled={isLoading}
                        >
                          {showPassword ? (
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

                {authError ? (
                  <div
                    className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
                    role="alert"
                    data-e2e-id="auth-login-error"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{authError}</span>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>

          <CardFooter className={isEmailStep ? 'flex-col gap-2' : 'flex-col gap-3'}>
            {isEmailStep ? (
              <Button type="submit" className="w-full bg-primary" disabled={isLoading}>
                {copy.auth.continue}
              </Button>
            ) : (
              /*
                Stacked at every width on purpose. A `sm:` variant keys off the viewport,
                but this card sits in the login grid's narrow `minmax(360px,1fr)` column,
                which leaves the footer roughly 184px of content box. Side by side, the
                back button plus the submit button's min-content width exceed that and
                spill past the card border.
              */
              <div className="flex w-full flex-col-reverse gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={handleBackToEmail}
                  disabled={isLoading}
                >
                  <ArrowLeft className="size-4" />
                  {copy.auth.backToEmail}
                </Button>
                <Button
                  type="submit"
                  className="w-full bg-primary"
                  disabled={isLoading}
                  data-e2e-id="auth-login-submit"
                >
                  {isLoading ? <Loader label={copy.auth.signingIn} /> : copy.auth.signIn}
                </Button>
              </div>
            )}
          </CardFooter>
        </form>
      </Card>
    </Form>
  );
}

function Loader({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <span
        className="size-4 animate-spin rounded-full border-2 border-secondary border-t-transparent"
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

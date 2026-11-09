'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiFetch } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showErrorToast, showSuccessToast } from '@/app/lib/toast';

const formSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

export default function ChangePasswordForm({ userEmail }: { userEmail: string }) {
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const data = await apiFetch<{ done: boolean; error?: string }>(
        endpointFor(AppFeature.USERS_CHANGE_PASSWORD),
        {
          method: 'POST',
          body: values,
        },
      );
      if (!data.done) {
        showErrorToast();
        setSubmitting(false);
        return;
      }
      showSuccessToast();
      // Force re-auth so the JWT gets the updated mustChangePassword=false.
      // Sign out without the built-in redirect (its absolute callbackUrl resolves
      // to http://0.0.0.0:3000 in the dev container), then reload /login relative
      // to the current origin.
      await signOut({ redirect: false });
      window.location.assign('/login');
    } catch (err) {
      showErrorToast();
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2 text-amber-600">
            <ShieldAlert className="size-5" />
            <span className="text-sm font-medium">Action required</span>
          </div>
          <CardTitle>Change your password</CardTitle>
          <CardDescription>
            Your account (<span className="font-medium">{userEmail}</span>) is using an initial
            password. Set a new one to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showNew ? 'text' : 'password'}
                          placeholder="At least 8 characters"
                          className="px-9"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNew((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          tabIndex={-1}
                        >
                          {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showConfirm ? 'text' : 'password'}
                          placeholder="Repeat new password"
                          className="px-9"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirm((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          tabIndex={-1}
                        >
                          {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Saving...' : 'Change password'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

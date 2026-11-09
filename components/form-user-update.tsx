import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Mail, UsersIcon } from 'lucide-react';
import { JSX } from 'react';
import type { SubmitHandler, UseFormReturn } from 'react-hook-form';
import { useCopy } from '@/app/lib/i18n/client';

export default function FormUserUpdate({
  form,
  handleSubmit,
  isLoading,
  canManageSystemAccess = false,
  hasSystemAccess = false,
  onToggleSystemAccess,
}: {
  form: UseFormReturn<{
    username: string;
    userEmail: string;
  }>;
  handleSubmit: SubmitHandler<{
    username: string;
    userEmail: string;
  }>;
  isLoading: boolean;
  // Only rendered for a viewer who may change it (System/Support).
  canManageSystemAccess?: boolean;
  hasSystemAccess?: boolean;
  onToggleSystemAccess?: (_checked: boolean) => void;
}) {
  const copy = useCopy();
  const formCopy = copy.system.users.form;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        {/* <CardContent> */}
        <div className="flex flex-col gap-6">
          {/* Name */}
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem className="grid gap-2">
                <FormLabel>{formCopy.name}</FormLabel>
                <div className="relative">
                  <UsersIcon className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={formCopy.namePlaceholder}
                      type="text"
                      className="pl-10"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Email */}
          <FormField
            control={form.control}
            name="userEmail"
            render={({ field }) => (
              <FormItem className="grid gap-2">
                <FormLabel>{formCopy.email}</FormLabel>
                <div className="relative">
                  <Mail className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={formCopy.emailPlaceholder}
                      type="email"
                      className="pl-10"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {canManageSystemAccess ? (
            <div className="grid gap-2">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={hasSystemAccess}
                  onCheckedChange={(checked) => onToggleSystemAccess?.(checked === true)}
                />
                <span className="min-w-0">
                  <span className="font-medium">{formCopy.systemAccess}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {formCopy.systemAccessHint}
                  </span>
                </span>
              </label>
            </div>
          ) : null}
        </div>
        {/* </CardContent> */}

        <CardFooter className="flex-col gap-2">
          <Button type="submit" className="w-full bg-primary text-white">
            {isLoading ? <Loader></Loader> : copy.common.update}
          </Button>
        </CardFooter>
      </form>
    </Form>
  );
}
export function Loader(): JSX.Element {
  return (
    <div className="flex size-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-4 border-secondary border-t-transparent" />
    </div>
  );
}

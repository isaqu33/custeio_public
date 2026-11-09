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
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Lock, Mail, UsersIcon } from 'lucide-react';
import type { Dispatch, JSX, SetStateAction } from 'react';
import type { SubmitHandler, UseFormReturn } from 'react-hook-form';
import { useCopy } from '@/app/lib/i18n/client';

export default function FormUserCreate({
  form,
  handleSubmit,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  isLoading,
}: {
  form: UseFormReturn<{
    username: string;
    userEmail: string;
    password: string;
    confirmPassword: string;
  }>;
  handleSubmit: SubmitHandler<{
    username: string;
    userEmail: string;
    password: string;
    confirmPassword: string;
  }>;
  showPassword: boolean;
  setShowPassword: Dispatch<SetStateAction<boolean>>;
  showConfirmPassword: boolean;
  setShowConfirmPassword: Dispatch<SetStateAction<boolean>>;
  isLoading: boolean;
}) {
  const copy = useCopy();
  const formCopy = copy.system.users.form;

  return (
    <Form {...form}>
      {/* <Card className="w-full max-w-[700px] relative"> */}
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
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

          {/* Password */}
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="grid gap-2">
                <FormLabel>{formCopy.password}</FormLabel>
                <div className="relative">
                  <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={formCopy.passwordPlaceholder}
                      type={showPassword ? 'text' : 'password'}
                      className="px-10"
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
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
                <FormLabel>{formCopy.confirmPassword}</FormLabel>
                <div className="relative">
                  <Lock className="absolute left-3 top-2 h-5 w-4 text-gray-400" />
                  <FormControl>
                    <Input
                      {...field}
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder={formCopy.confirmPasswordPlaceholder}
                      className="px-10"
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
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
        </div>
        {/* </CardContent> */}

        <CardFooter className="flex-col gap-2">
          <Button type="submit" className="w-full  bg-primary text-white">
            {isLoading ? <Loader></Loader> : copy.common.create}
          </Button>
        </CardFooter>
      </form>
      {/* </Card> */}
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

'use client';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useCopy } from '@/app/lib/i18n/client';
import { Input } from '@/components/ui/input';
import { Building2 } from 'lucide-react';
import { JSX, useState } from 'react';
import type { SubmitHandler, UseFormReturn } from 'react-hook-form';

type OrganizationFormValues = {
  name: string;
};

export default function FormOrganizationCreate({
  form,
  handleSubmit,
}: {
  form: UseFormReturn<OrganizationFormValues>;
  handleSubmit: SubmitHandler<OrganizationFormValues>;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (values: OrganizationFormValues) => {
    setIsLoading(true);
    try {
      await handleSubmit(values);
    } finally {
      setIsLoading(false);
    }
  };

  const organizationsCopy = useCopy().system.organizations;
  const copy = organizationsCopy.form;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto pr-2">
          {/* Organization Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{copy.organizationName}</FormLabel>
                <div className="relative">
                  <Building2 className="absolute left-3 top-2.5 size-4 text-gray-400" />
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={copy.organizationNamePlaceholder}
                      className="pl-10"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="shrink-0 pt-4">
          <Button type="submit" disabled={isLoading} className="w-full bg-primary text-white">
            {isLoading ? <Loader /> : copy.create}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function Loader(): JSX.Element {
  return (
    <div className="flex items-center justify-center">
      <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  );
}

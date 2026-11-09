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
import { Building2, Loader2 } from 'lucide-react';
import { JSX, useState } from 'react';
import type { SubmitHandler, UseFormReturn } from 'react-hook-form';

type OrganizationFormValues = {
  name: string;
  id?: string;
};

export default function FormOrganizationUpdate({
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

  const fullCopy = useCopy();
  const organizationsCopy = fullCopy.system.organizations;
  const copy = organizationsCopy.form;
  const commonCopy = fullCopy.common;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto pr-2">
          <div className="flex flex-col gap-4">
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
                        placeholder={copy.organizationNameEditPlaceholder}
                        className="pl-10"
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="shrink-0 pt-4">
          <Button type="submit" disabled={isLoading} className="w-full bg-primary text-white">
            {isLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : commonCopy.saveChanges}
          </Button>
        </div>
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

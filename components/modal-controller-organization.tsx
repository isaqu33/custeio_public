import { ActionButton } from '@/components/ui/action-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import FormOrganizationCreate from './form-organization-create';
import FormOrganizationUpdate from './form-organization-update';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  type OrganizationCreateValues,
  type OrganizationUpdateValues,
} from './modal-controller-organization/schema';

type RouterLike = {
  refresh: () => void;
};

export function ModalOrganization({
  type = 'create',
  organizationInfo,
  router,
}: {
  type?: 'create' | 'update';
  organizationInfo?: {
    _id: string;
    name: string;
    status: string;
    createdAt: string;
  };
  router: RouterLike;
}) {
  const [open, setOpen] = useState(false);
  const copy = useCopy();
  const formCopy = copy.system.organizations.form;

  // Hook Form for Create
  const form = useForm<OrganizationCreateValues>({
    resolver: zodResolver(createOrganizationSchema(copy)),
    defaultValues: {
      name: '',
    },
  });

  // Hook Form for Update
  const formUpdate = useForm<OrganizationUpdateValues>({
    resolver: zodResolver(updateOrganizationSchema(copy)),
    defaultValues: {
      name: organizationInfo?.name || '',
      id: organizationInfo?._id || '',
    },
  });

  const handleSubmitCreate = async (values: OrganizationCreateValues) => {
    let result: {
      done: boolean;
      message: string;
      data: { organizationId: string };
    };
    try {
      result = await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_CREATE), {
        method: 'POST',
        body: values,
        cache: 'no-store',
      });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
      return;
    }

    if (result?.done === false) {
      showErrorToast();
      return;
    }

    router.refresh();
    showSuccessToast();
    setOpen(false);
  };

  const handleSubmitUpdate = async (values: OrganizationUpdateValues) => {
    let result: { done: boolean; message: string };
    try {
      result = await apiFetch<{ done: boolean; message: string }>(
        endpointFor(AppFeature.ORGANIZATIONS_UPDATE),
        {
          method: 'POST',
          body: values,
          cache: 'no-store',
        },
      );
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
      return;
    }

    if (result?.done === false) {
      showErrorToast();
      return;
    }

    router.refresh();
    showSuccessToast();
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      form.reset();
      formUpdate.reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div>
        <DialogTrigger asChild>
          {type === 'create' ? (
            <ActionButton
              action="create"
              size="icon"
              iconOnly
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
              title={formCopy.createTitle}
            >
              {formCopy.createTitle}
            </ActionButton>
          ) : (
            <ActionButton
              action="edit"
              className="size-8"
              title={formCopy.update}
              variant="outline"
              size="icon"
              iconOnly
            />
          )}
        </DialogTrigger>
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
          {type === 'create' ? (
            <DialogHeader className="shrink-0">
              <DialogTitle>{formCopy.createTitle}</DialogTitle>
              <DialogDescription>{formCopy.createDescription}</DialogDescription>
            </DialogHeader>
          ) : (
            <DialogHeader className="shrink-0">
              <DialogTitle>{formCopy.updateTitle}</DialogTitle>
              <DialogDescription>{formCopy.updateDescription}</DialogDescription>
            </DialogHeader>
          )}

          {type === 'create' ? (
            <FormOrganizationCreate form={form} handleSubmit={handleSubmitCreate} />
          ) : (
            <FormOrganizationUpdate form={formUpdate} handleSubmit={handleSubmitUpdate} />
          )}
        </DialogContent>
      </div>
    </Dialog>
  );
}

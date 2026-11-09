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
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import FormUserCreate from './form-user-create';
import FormUserUpdate from './form-user-update';
import { useCopy } from '@/app/lib/i18n/client';
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserValues,
  type UpdateUserValues,
} from './modal-controller-user/schema';

type RouterLike = {
  refresh: () => void;
};

export function ModalUser({
  type = 'create',
  userInfo,
  router,
  canManageSystemAccess = false,
}: {
  type?: 'create' | 'update';
  userInfo?: {
    _id?: string;
    organizationIds: string[];
    hasSystemAccess?: boolean;
    name: string;
    email: string;
  };
  router: RouterLike;
  // Only the viewer's own System/Support access lets them change it.
  canManageSystemAccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hasSystemAccess, setHasSystemAccess] = useState(userInfo?.hasSystemAccess ?? false);
  const copy = useCopy();
  const formCopy = copy.system.users.form;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema(copy)),
    defaultValues: {
      username: '',
      userEmail: '',
      password: '',
      confirmPassword: '',
    },
  });
  const formUpdateUser = useForm<UpdateUserValues>({
    resolver: zodResolver(updateUserSchema(copy)),
    defaultValues: {
      username: userInfo?.name,
      userEmail: userInfo?.email,
    },
  });

  const handleSubmitCreate = async (values: CreateUserValues) => {
    setIsLoading(true);
    let result: { done?: boolean };
    try {
      result = await apiFetch<{ done?: boolean }>(endpointFor(AppFeature.USERS_CREATE), {
        method: 'POST',
        body: {
          name: values.username,
          email: values.userEmail,
          password: values.password,
        },
        cache: 'no-store',
      });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
      return setIsLoading(false);
    }

    if (result?.done === false) {
      setIsLoading(false);
      form.setError('userEmail', {
        type: 'custom',
        message: formCopy.emailAlreadyExists,
      });
      return;
    }

    showSuccessToast();
    router.refresh();
    setOpen(false);
  };
  const handleSubmitUpdate = async (values: UpdateUserValues) => {
    setIsLoading(true);
    let result: { done?: boolean };
    try {
      result = await apiFetch<{ done?: boolean }>(endpointFor(AppFeature.USERS_UPDATE), {
        method: 'POST',
        body: {
          userId: userInfo?._id as string,
          name: values.username,
          email: values.userEmail,
          // Omitted entirely when the viewer cannot manage it, so the route
          // reads it as "leave system access alone" instead of clearing it.
          ...(canManageSystemAccess ? { hasSystemAccess } : {}),
        },
        cache: 'no-store',
      });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
      return setIsLoading(false);
    }

    if (result?.done === false) {
      setIsLoading(false);
      formUpdateUser.setError('userEmail', {
        type: 'custom',
        message: formCopy.emailAlreadyExists,
      });
      return;
    }

    showSuccessToast();
    router.refresh();
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      form.reset();
      formUpdateUser.reset();
      setHasSystemAccess(userInfo?.hasSystemAccess ?? false);
      setIsLoading(false);
      setShowPassword(false);
      setShowConfirmPassword(false);
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
              title={formCopy.createOpen}
            >
              {formCopy.createOpen}
            </ActionButton>
          ) : (
            <ActionButton
              action="edit"
              className="size-8"
              title={formCopy.updateOpen}
              variant="outline"
              size="icon"
              iconOnly
            />
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          {type === 'create' ? (
            <DialogHeader>
              <DialogTitle>{formCopy.createTitle}</DialogTitle>
              <DialogDescription>{formCopy.createDescription}</DialogDescription>
            </DialogHeader>
          ) : (
            <DialogHeader>
              <DialogTitle>{formCopy.updateTitle}</DialogTitle>
              <DialogDescription>{formCopy.updateDescription}</DialogDescription>
            </DialogHeader>
          )}

          {type === 'create' ? (
            <FormUserCreate
              form={form}
              handleSubmit={handleSubmitCreate}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              showConfirmPassword={showConfirmPassword}
              setShowConfirmPassword={setShowConfirmPassword}
              isLoading={isLoading}
            />
          ) : (
            <FormUserUpdate
              form={formUpdateUser}
              handleSubmit={handleSubmitUpdate}
              isLoading={isLoading}
              canManageSystemAccess={canManageSystemAccess}
              hasSystemAccess={hasSystemAccess}
              onToggleSystemAccess={setHasSystemAccess}
            />
          )}
        </DialogContent>
      </div>
    </Dialog>
  );
}

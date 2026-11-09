'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { showApiErrorToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import { DataTableOrganizationStores, type Store } from './data-table-organization-stores';
import { ModalDataState } from './modal-data-state';

/** One Cliente (Organization) can run more than one Loja, each its own CNPJ and
 * Alloy account — this manages the full set of Stores for it. */
export default function ModalOrganizationStores({ id }: { id: string }) {
  const copy = useCopy().system.organizations.stores;
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await apiFetch<{ done: boolean; data: Store[] }>(
        endpointFor(AppFeature.ORGANIZATIONS_GET_STORES),
        { method: 'POST', body: { organizationId: id }, cache: 'no-store' },
      );
      if (result.done) setStores(result.data);
      else setLoadError(copy.loadFailed);
    } catch (error) {
      setLoadError(copy.loadFailed);
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error);
    } finally {
      setIsLoading(false);
    }
  }, [id, copy.loadFailed]);

  useEffect(() => {
    if (!open) return;
    // Async — the setState call runs after an await, not synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStores();
  }, [open, loadStores]);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setStores(null);
      setLoadError(null);
    }
    setOpen(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full md:size-8"
          title={copy.open}
        >
          <Plug className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-auto">
          <ModalDataState
            isLoading={isLoading}
            loadingMessage={copy.loading}
            errorMessage={loadError}
            hasData={Boolean(stores)}
          />
          {stores ? (
            <DataTableOrganizationStores
              organizationId={id}
              stores={stores}
              onChanged={loadStores}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

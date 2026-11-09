'use client';

import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Store as StoreIcon, Wifi } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ActionButton } from '@/components/ui/action-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/app/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { formatDateShortUtc } from '@/app/lib/date-format';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { DataTableCard, DataTableToolbar } from '@/components/data-table-shell';
import { StoreFormDialog } from './store-form-dialog';
import { TableEmptyStateRow } from './table-empty-state-row';

export type PosStoreProvider = 'alloy' | 'consumer' | 'saipos' | 'grandchef' | 'anota_ai';
export type PosStoreStatus = 'connected' | 'error' | 'disconnected';

export type Store = {
  _id: string;
  cnpj: string;
  legalName?: string;
  name: string;
  whatsappNumber?: string;
  provider: PosStoreProvider;
  externalId: string;
  imageUrl?: string;
  status: PosStoreStatus;
  lastHealthCheckAt?: string;
  lastError?: string;
  lastSyncAt?: string;
  // From Alloy's own rate-limit headers on the last "Testar conexão" — see
  // app/lib/alloy-client.ts. Undefined until the first check ever runs.
  alloyRateLimitLimit?: number;
  alloyRateLimitRemaining?: number;
  createdAt: string;
};

function getColumns({
  onEdit,
  onDelete,
  onTestConnection,
  testingId,
  copy: fullCopy,
}: {
  onEdit: (_store: Store) => void;
  onDelete: (_id: string) => Promise<void>;
  onTestConnection: (_id: string) => Promise<void>;
  testingId: string | null;
  copy: AppCopy;
}): ColumnDef<Store>[] {
  const copy = fullCopy.system.organizations.stores;
  const commonCopy = fullCopy.common;
  const statusStyles: Record<PosStoreStatus, string> = {
    connected: 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
    error: 'border-red-200 bg-red-100 text-red-700 hover:bg-red-100',
    disconnected: 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100',
  };

  return [
    {
      accessorKey: 'name',
      header: copy.columns.store,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarImage src={row.original.imageUrl} alt="" />
            <AvatarFallback>
              <StoreIcon className="size-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-[10px] text-muted-foreground">{row.original.cnpj}</span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'provider',
      header: copy.columns.provider,
      cell: ({ row }) => <span>{copy.providerLabels[row.original.provider]}</span>,
    },
    {
      accessorKey: 'status',
      header: copy.columns.status,
      cell: ({ row }) => {
        const { alloyRateLimitLimit, alloyRateLimitRemaining, provider } = row.original;
        const hasRateData =
          provider === 'alloy' &&
          alloyRateLimitLimit !== undefined &&
          alloyRateLimitRemaining !== undefined;
        return (
          <div className="flex flex-col gap-1">
            <Badge className={statusStyles[row.original.status]} title={row.original.lastError}>
              {copy.statusLabels[row.original.status]}
            </Badge>
            {hasRateData ? (
              <span className="text-[11px] text-muted-foreground">
                {formatCopy(copy.rateLimitUsage, {
                  used: alloyRateLimitLimit - alloyRateLimitRemaining,
                  limit: alloyRateLimitLimit,
                })}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: 'lastSyncAt',
      header: copy.columns.lastSync,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastSyncAt ? formatDateShortUtc(row.original.lastSyncAt) : '-'}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      header: () => <div>{copy.columns.actions}</div>,
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.provider === 'alloy' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 rounded-full md:size-8"
              title={copy.testConnection}
              disabled={testingId === row.original._id}
              onClick={() => void onTestConnection(row.original._id)}
            >
              <Wifi className={cn('size-3.5', testingId === row.original._id && 'animate-pulse')} />
            </Button>
          ) : null}
          <ActionButton
            action="edit"
            variant="outline"
            size="icon"
            iconOnly
            onClick={() => onEdit(row.original)}
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <ActionButton action="delete" variant="outline" size="icon" iconOnly />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{copy.removeQuestion}</AlertDialogTitle>
                <AlertDialogDescription>{copy.removeDescription}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{commonCopy.no}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(row.original._id)}>
                  {commonCopy.yes}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    },
  ];
}

export function DataTableOrganizationStores({
  organizationId,
  stores,
  onChanged,
}: {
  organizationId: string;
  stores: Store[];
  onChanged: () => Promise<void> | void;
}) {
  const copy = useCopy();
  const [formOpen, setFormOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | undefined>(undefined);
  // StoreFormDialog reads `store` into useState only once, at mount — bumping
  // this on every open forces a remount so its fields never carry over from
  // whatever was last created or edited.
  const [formKey, setFormKey] = useState(0);
  const [testingId, setTestingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingStore(undefined);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  };
  const openEdit = (store: Store) => {
    setEditingStore(store);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_DELETE_STORE), {
        method: 'POST',
        body: { id },
        cache: 'no-store',
      });
      showSuccessToast();
      await onChanged();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error);
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_TEST_STORE_CONNECTION), {
        method: 'POST',
        body: { id },
        cache: 'no-store',
      });
      await onChanged();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error, {
        UNPROCESSABLE_ENTITY: copy.system.organizations.stores.unreadableKey,
      });
    } finally {
      setTestingId(null);
    }
  };

  const columns = getColumns({
    onEdit: openEdit,
    onDelete: handleDelete,
    onTestConnection: handleTestConnection,
    testingId,
    copy,
  });

  const table = useReactTable({
    data: stores,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <DataTableCard>
      <DataTableToolbar className="justify-between">
        <ActionButton
          action="refresh"
          variant="ghost"
          iconOnly
          label={copy.common.refreshTable}
          onClick={async () => {
            await onChanged();
            showSuccessToast();
          }}
        />
        <ActionButton
          action="create"
          size="icon"
          iconOnly
          className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
          label={copy.system.organizations.stores.add}
          onClick={openCreate}
        />
      </DataTableToolbar>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableEmptyStateRow
              colSpan={columns.length}
              message={copy.system.organizations.stores.noStores}
            />
          )}
        </TableBody>
      </Table>

      <StoreFormDialog
        key={formKey}
        organizationId={organizationId}
        store={editingStore}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={onChanged}
      />
    </DataTableCard>
  );
}

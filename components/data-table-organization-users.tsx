'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { visiblePageWindow } from '@/app/lib/pagination';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { ActionButton } from '@/components/ui/action-button';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import { TableEmptyStateRow } from './table-empty-state-row';
import { TableLoadingOverlay } from './table-loading-overlay';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type { AppCopy } from '@/app/lib/i18n/dictionary';

export type Admin = {
  _id: string;
  name: string;
  email: string;
  // True when System/Support access already gives the user every organization,
  // whatever this link says.
  bypassesOrganizationScope: boolean;
};

export interface DatabaseAdminType {
  data: Admin[];
  totalPages: number;
  total: number;
}

export function getColumns({
  removeAdmin,
  copy: fullCopy,
}: {
  removeAdmin: (_idToken: string) => Promise<void>;
  copy: AppCopy;
}): ColumnDef<Admin>[] {
  const copy = fullCopy.system.organizations.users;
  const commonCopy = fullCopy.common;
  return [
    {
      accessorKey: 'name',
      header: () => {
        return <div>{copy.columns.name}</div>;
      },
      cell: ({ row }) => <div>{row.getValue('name')}</div>,
    },
    {
      accessorKey: 'email',
      header: () => {
        return <div>{copy.columns.email}</div>;
      },
      cell: ({ row }) => <div>{row.getValue('email')}</div>,
    },

    {
      accessorKey: 'bypassesOrganizationScope',
      header: () => <div>{copy.columns.access}</div>,
      cell: ({ row }) =>
        row.original.bypassesOrganizationScope ? (
          <Badge variant="outline" title={copy.allOrgsHint}>
            {copy.allOrgs}
          </Badge>
        ) : (
          <Badge variant="secondary">{copy.member}</Badge>
        ),
    },
    {
      id: 'actions',
      enableHiding: false,
      header: () => <div>{copy.columns.actions}</div>,
      cell: ({ row }) => {
        const user = row.original;

        return (
          <div className="flex">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <ActionButton
                  action="delete"
                  variant="outline"
                  size="icon"
                  className="size-10 md:size-8"
                  title={copy.unlink}
                  iconOnly
                />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.unlinkQuestion}</AlertDialogTitle>
                  <AlertDialogDescription>{copy.unlinkMemberDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{commonCopy.no}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removeAdmin(user._id)}>
                    {commonCopy.yes}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      },
    },
  ];
}

export function DataTableOrganizationUsers({
  AdminData,
  currentPage,
  setPage,
  id,
  fetchData,
  actions,
}: {
  AdminData: DatabaseAdminType;
  currentPage: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  id: string;
  fetchData: () => Promise<void> | void;
  actions?: ReactNode;
}) {
  const copy = useCopy();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [isLoading, _setIsLoading] = useState(false);

  const totalPages = AdminData?.totalPages ?? 0;

  const visiblePages = visiblePageWindow(currentPage, totalPages as number);

  const removeAdmin = async (userId: string) => {
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_REMOVE_ADMIN), {
        method: 'POST',
        body: { organizationId: id, userId },
      });
      showSuccessToast();
      await fetchData();
    } catch (error) {
      if (error instanceof ApiError) {
        showApiErrorToast(error);
        return;
      }
      showErrorToast();
    }
  };

  let columns = getColumns({
    removeAdmin,
    copy,
  });

  const table = useReactTable({
    data: AdminData?.data || [],
    columns: columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: () => {},
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination: {
        pageIndex: 0,
        pageSize: 10,
      },
    },
  });

  return (
    <div>
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          <ActionButton
            action="refresh"
            variant="ghost"
            iconOnly
            label={copy.common.refreshTable}
            onClick={async () => {
              await fetchData();
              showSuccessToast();
            }}
          />
          {actions}
        </DataTableToolbar>
        {isLoading && <TableLoadingOverlay />}
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
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
                message={copy.system.organizations.users.noResults}
              />
            )}
          </TableBody>
        </Table>
        <DataTableFooter
          total={formatCopy(copy.common.totalItems, { count: AdminData?.total ?? 0 })}
        >
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href={undefined}
                  onClick={() => {
                    if (currentPage > 1) setPage(currentPage - 1);
                  }}
                />
              </PaginationItem>

              {visiblePages.map((page, index) => (
                <PaginationItem key={index}>
                  {page === '...' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      href={undefined}
                      isActive={page === currentPage}
                      onClick={() => setPage(page as number)}
                    >
                      {page}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}

              <PaginationItem>
                <PaginationNext
                  href={undefined}
                  onClick={() => {
                    if (currentPage < totalPages) setPage(currentPage + 1);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </DataTableFooter>
      </DataTableCard>
    </div>
  );
}

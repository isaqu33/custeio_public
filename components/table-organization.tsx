'use client';

import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table';
import { Building2, History, LockKeyhole, LockKeyholeOpen } from 'lucide-react';

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
import * as React from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { formatDateShortUtc } from '@/app/lib/date-format';
import { visiblePageWindow } from '@/app/lib/pagination';
import { showApiErrorToast, showErrorToast, showSuccessToast } from '@/app/lib/toast';

import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ModalOrganization } from './modal-controller-organization';
import ModalOrganizationBilling from './modal-organization-billing';
import ModalOrganizationInvite from './modal-organization-invite';
import ModalOrganizationStores from './modal-organization-stores';
import ModalOrganizationApiUsage from './modal-organization-api-usage';
import { SearchFilter } from '@/components/search-filter';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';
import { Badge } from './ui/badge';
import UserOrganizationModal from './user-modal-organization';
import { useCopy } from '@/app/lib/i18n/client';
import { formatCopy } from '@/app/lib/i18n/format';
import type { AppCopy } from '@/app/lib/i18n/dictionary';

type RouterLike = {
  refresh: () => void;
};

export type OrganizationStatus = 'onboarding' | 'active' | 'suspended' | 'canceled';

export interface Organization {
  _id: string;
  name: string;
  status: OrganizationStatus;
  billingStatus: 'up_to_date' | 'past_due';
  asaasCustomerId?: string;
  hasPendingInvite: boolean;
  createdAt: string;
}

export function getColumns({
  inactivityOrganization,
  router,
  copy,
}: {
  inactivityOrganization: (_id: string) => Promise<void>;
  router: RouterLike;
  copy: AppCopy;
}): ColumnDef<Organization>[] {
  const orgCopy = copy.system.organizations;
  return [
    {
      accessorKey: 'name',
      header: orgCopy.columns.organization,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-medium capitalize">{row.original.name}</span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: orgCopy.columns.status,
      cell: ({ row }) => {
        const status = row.original.status;
        const statusStyles: Record<OrganizationStatus, string> = {
          onboarding: 'border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-100',
          active: 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
          suspended: 'border-red-200 bg-red-100 text-red-700 hover:bg-red-100',
          canceled: 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100',
        };
        return <Badge className={statusStyles[status]}>{orgCopy.statusLabels[status]}</Badge>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: orgCopy.columns.createdAt,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.createdAt ? formatDateShortUtc(row.original.createdAt) : '-'}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      header: () => <div>{orgCopy.columns.actions}</div>,
      cell: ({ row }) => {
        return (
          <div className="flex gap-1">
            <ModalOrganization type="update" organizationInfo={row.original} router={router} />

            <UserOrganizationModal id={row.original._id} />

            <ModalOrganizationInvite
              id={row.original._id}
              hasPendingInvite={row.original.hasPendingInvite}
              router={router}
            />

            <ModalOrganizationStores id={row.original._id} />

            <ModalOrganizationApiUsage id={row.original._id} />

            <ModalOrganizationBilling
              id={row.original._id}
              billingStatus={row.original.billingStatus}
              asaasCustomerId={row.original.asaasCustomerId}
              router={router}
            />

            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-10 rounded-full md:size-8"
              title={orgCopy.viewAuditEvents}
            >
              <Link href={`/system/audit-events?organizationId=${row.original._id}`}>
                <History className="size-3.5" />
              </Link>
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-full md:size-8"
                  title={
                    row.original.status === 'active'
                      ? orgCopy.disableOrganization
                      : orgCopy.enableOrganization
                  }
                >
                  {row.original.status === 'active' ? (
                    <LockKeyhole className="size-3.5" />
                  ) : (
                    <LockKeyholeOpen className="size-3.5" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {row.original.status === 'active'
                      ? orgCopy.disableOrganizationQuestion
                      : orgCopy.enableOrganizationQuestion}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{orgCopy.availabilityDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{copy.common.no}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => inactivityOrganization(row.original._id)}>
                    {copy.common.yes}
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

export function DataTableOrganization({
  allOrganizations,
  totalPages,
  total,
  currentPage,
  searchTerm,
  searchType,
}: {
  allOrganizations: Organization[];
  totalPages: number;
  total: number;
  currentPage: number;
  searchTerm: string;
  searchType: string;
}) {
  const router = useRouter();
  const copy = useCopy();

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  let columns = getColumns({
    inactivityOrganization,
    router,
    copy,
  });

  const table = useReactTable({
    data: allOrganizations,
    columns: columns,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: () => {},
    state: {
      columnFilters,
      columnVisibility,
      pagination: {
        pageIndex: 0,
        pageSize: 20,
      },
    },
  });

  const visiblePages = visiblePageWindow(currentPage, totalPages as number);

  async function inactivityOrganization(id: string) {
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_CHANGE_INACTIVITY), {
        method: 'POST',
        body: { id },
        cache: 'no-store',
      });
      router.refresh();
      showSuccessToast();
    } catch (error) {
      if (error instanceof ApiError) {
        showApiErrorToast(error);
        return;
      }
      showErrorToast();
    }
  }

  async function reloadTable() {
    showSuccessToast();
    router.refresh();
  }

  return (
    <div className="w-full">
      <SearchFilter
        searchTerm={searchTerm}
        searchType={searchType}
        searchTypeParam="orgSearchType"
        searchTypeOptions={[{ value: 'name', label: copy.common.fullName }]}
      />
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          <ActionButton
            action="refresh"
            variant="ghost"
            iconOnly
            label={copy.common.refreshTable}
            onClick={() => reloadTable()}
          />
          <ModalOrganization type="create" router={router} />
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
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="size-8 text-muted-foreground/50" />
                    {copy.system.organizations.noOrganizationsFound}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <DataTableFooter total={formatCopy(copy.common.totalItems, { count: total })}>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href={
                    currentPage > 1
                      ? `?page=${currentPage - 1}${searchTerm ? `&q=${searchTerm}` : ''}`
                      : undefined
                  }
                />
              </PaginationItem>

              {visiblePages.map((page, index) => (
                <PaginationItem key={index}>
                  {page === '...' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      isActive={page === currentPage}
                      href={
                        page === currentPage
                          ? undefined
                          : `?page=${Number(page)}${searchTerm ? `&q=${searchTerm}` : ''}`
                      }
                    >
                      {page}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}

              <PaginationItem>
                <PaginationNext
                  href={
                    currentPage < totalPages
                      ? `?page=${currentPage + 1}${searchTerm ? `&q=${searchTerm}` : ''}`
                      : undefined
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </DataTableFooter>
      </DataTableCard>
    </div>
  );
}

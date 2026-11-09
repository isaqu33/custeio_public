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
import { User as UserIcon, UserCheck, UserX } from 'lucide-react';
import * as React from 'react';
import { visiblePageWindow } from '@/app/lib/pagination';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { formatDateShortUtc } from '@/app/lib/date-format';

import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
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
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from './ui/badge';
import { SearchFilter } from '@/components/search-filter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModalUser } from './modal-controller-user';
import { InspectUserButton } from './table-users/inspect-user-button';
import { ResetUserPasswordDialog } from './table-users/reset-password-dialog';
import type { RouterLike, User } from './table-users/types';
import { useCopy } from '@/app/lib/i18n/client';
import type { AppCopy } from '@/app/lib/i18n/dictionary';
import { formatCopy } from '@/app/lib/i18n/format';
import { USER_STATUS_FILTERS } from '@/app/lib/user-status-filters';
import { DataTableCard, DataTableFooter, DataTableToolbar } from '@/components/data-table-shell';

export type { User } from './table-users/types';

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export function getColumns({
  router,
  copy,
  canManageUsers,
  currentUserId,
  onDelete,
  onSetDisabled,
}: {
  router: RouterLike;
  copy: AppCopy;
  canManageUsers: boolean;
  currentUserId: string;
  onDelete: (_id: string) => Promise<void>;
  onSetDisabled: (_id: string, _disabled: boolean) => Promise<void>;
}): ColumnDef<User>[] {
  const usersCopy = copy.system.users;
  return [
    {
      accessorKey: 'name',
      header: usersCopy.columns.user,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {getInitials(row.original.name)}
          </div>
          <div className="flex flex-col">
            <span className="flex items-center gap-2 font-medium capitalize">
              {row.original.name}
              {row.original.disabled && (
                <Badge variant="destructive" className="text-[10px] normal-case">
                  {usersCopy.disabledBadge}
                </Badge>
              )}
            </span>
            <span className="text-[11px] text-muted-foreground">{row.original.email}</span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'organizationNames',
      header: usersCopy.columns.organizations,
      cell: ({ row }) => {
        const names = row.original.organizationNames;
        if (!names || names === 'No Organization') {
          return (
            <Badge variant="secondary" className="text-[10px]">
              {usersCopy.noOrganization}
            </Badge>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {names.split(', ').map((name, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-normal">
                {name}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: 'hasSystemAccess',
      header: usersCopy.columns.systemAccess,
      cell: ({ row }) =>
        row.original.hasSystemAccess ? (
          <Badge className="text-[10px]">{usersCopy.systemAccessYes}</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">
            {usersCopy.systemAccessNo}
          </Badge>
        ),
    },
    {
      accessorKey: 'lastSignInAt',
      header: usersCopy.columns.lastSignInAt,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastSignInAt
            ? formatDateShortUtc(row.original.lastSignInAt)
            : usersCopy.neverSignedIn}
        </span>
      ),
    },
    {
      id: 'actions',
      enableHiding: false,
      header: () => <div>{usersCopy.columns.actions}</div>,
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user._id === currentUserId;

        return (
          <div className="flex gap-1">
            <ModalUser
              type="update"
              userInfo={user}
              router={router}
              canManageSystemAccess={canManageUsers}
            />
            {/* The three below are System/Support only, and their routes say
                so too — `canManageUsers` is that same check, resolved on the
                server for this page. */}
            {canManageUsers && (
              <>
                <ResetUserPasswordDialog user={user} router={router} />
                <InspectUserButton user={user} />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 rounded-full md:size-8"
                      // Deactivating yourself is refused by the route too; reactivating
                      // yourself is impossible to need, so the button is off either way.
                      disabled={isSelf}
                      title={
                        isSelf
                          ? usersCopy.cannotDisableSelf
                          : formatCopy(
                              user.disabled ? usersCopy.enableUser : usersCopy.disableUser,
                              { name: user.name },
                            )
                      }
                    >
                      {user.disabled ? (
                        <UserCheck className="size-3.5" />
                      ) : (
                        <UserX className="size-3.5" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {formatCopy(
                          user.disabled ? usersCopy.enableQuestion : usersCopy.disableQuestion,
                          { name: user.name },
                        )}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {user.disabled ? usersCopy.enableDescription : usersCopy.disableDescription}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{copy.common.no}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void onSetDisabled(user._id, !user.disabled)}
                      >
                        {copy.common.yes}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <ActionButton
                      action="delete"
                      variant="outline"
                      size="icon"
                      iconOnly
                      disabled={isSelf}
                      title={
                        isSelf
                          ? usersCopy.cannotDeleteSelf
                          : formatCopy(usersCopy.deleteUser, { name: user.name })
                      }
                    />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {formatCopy(usersCopy.deleteQuestion, { name: user.name })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>{usersCopy.deleteDescription}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{copy.common.no}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void onDelete(user._id)}>
                        {copy.common.yes}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        );
      },
    },
  ];
}

export function DataTableUser({
  allUsers,
  totalPages,
  total,
  currentPage,
  searchTerm,
  searchType,
  status = '',
  canManageUsers = false,
  currentUserId = '',
}: {
  allUsers: User[];
  totalPages: number;
  total: number;
  currentPage: number;
  searchTerm: string;
  searchType: string;
  status?: string;
  canManageUsers?: boolean;
  currentUserId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = useCopy();

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  async function handleDeleteUser(userId: string) {
    try {
      await apiFetch(endpointFor(AppFeature.USERS_DELETE), {
        method: 'DELETE',
        body: { userId },
        cache: 'no-store',
      });
      showSuccessToast();
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    }
  }

  async function handleSetDisabled(userId: string, disabled: boolean) {
    try {
      await apiFetch(endpointFor(AppFeature.USERS_SET_STATUS), {
        method: 'POST',
        body: { userId, disabled },
        cache: 'no-store',
      });
      showSuccessToast();
      router.refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      showApiErrorToast(err);
    }
  }

  let columns = getColumns({
    router,
    copy,
    canManageUsers,
    currentUserId,
    onDelete: handleDeleteUser,
    onSetDisabled: handleSetDisabled,
  });

  const table = useReactTable({
    data: allUsers,
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

  // Applied on change rather than behind an apply button: it is a single pick,
  // and the URL stays the source of truth (the search box and the organization
  // scope bar keep their params because this copies the existing ones).
  function changeStatusFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
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
        searchTypeParam="userSearchType"
        searchTypeOptions={[
          { value: 'name', label: copy.common.fullName },
          { value: 'email', label: copy.common.emailField },
        ]}
      />
      <DataTableCard>
        <DataTableToolbar className="justify-between">
          {/* Utility controls grouped on the left; the one action that creates
              something stands alone on the right — see docs/design/data-tables.md. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status || 'all'} onValueChange={changeStatusFilter}>
              <SelectTrigger
                aria-label={copy.system.users.statusFilter.label}
                className="h-10 w-full bg-background sm:w-[220px] md:h-8"
              >
                <SelectValue placeholder={copy.system.users.statusFilter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{copy.system.users.statusFilter.all}</SelectItem>
                {USER_STATUS_FILTERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {copy.system.users.statusFilter[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ActionButton
              action="refresh"
              variant="ghost"
              iconOnly
              label={copy.common.refreshTable}
              onClick={() => reloadTable()}
            />
          </div>
          <ModalUser type="create" router={router} />
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
                    <UserIcon className="size-8 text-muted-foreground/50" />
                    {copy.system.users.noUsersFound}
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

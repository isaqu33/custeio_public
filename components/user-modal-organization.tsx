'use client';

import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/app/lib/utils';
import { Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/app/lib/api-client';
import { AppFeature, endpointFor } from '@/app/lib/features';
import { useCopy } from '@/app/lib/i18n/client';
import {
  DataTableOrganizationUsers,
  type DatabaseAdminType,
} from './data-table-organization-users';
import { ModalDataState } from './modal-data-state';
import { showApiErrorToast, showSuccessToast } from '@/app/lib/toast';

export interface DatabaseAdminSearchType {
  data: {
    _id: string;
    name: string;
    email: string;
    organizationIds: string[];
    organizationNames: string;
  }[];
  done: boolean;
  message: string;
  page: number;
  total: number;
  totalPages: number;
}

/** Everyone tied to one organization, and the way to tie someone else to it. */
export default function UserOrganizationModal({ id }: { id: string }) {
  const fullCopy = useCopy();
  const copy = fullCopy.system.organizations.users;
  const linkCopy = copy.link;
  const commonCopy = fullCopy.common;

  const [open, setOpen] = useState(false);
  const [admins, setAdmins] = useState<DatabaseAdminType | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);
  const [adminsLoadError, setAdminsLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<DatabaseAdminSearchType | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadCurrentAdmins = useCallback(async () => {
    setIsLoadingAdmins(true);
    setAdminsLoadError(null);
    try {
      const result = await apiFetch<DatabaseAdminType & { done: boolean }>(
        endpointFor(AppFeature.ORGANIZATIONS_GET_ADMINS),
        { method: 'POST', body: { page, limit: 5, id } },
      );
      if (result.done) setAdmins(result);
      else setAdminsLoadError(copy.loadFailed);
    } catch (error) {
      setAdminsLoadError(copy.loadFailed);
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error);
    } finally {
      setIsLoadingAdmins(false);
    }
  }, [id, page, copy.loadFailed]);

  const handleSearch = async (isLoadMore: boolean) => {
    if (!searchTerm) return;

    const pageToFetch = isLoadMore ? (searchResults?.page ?? 1) + 1 : 1;
    setIsSearching(true);

    try {
      const result = await apiFetch<DatabaseAdminSearchType>(
        endpointFor(AppFeature.ORGANIZATIONS_GET_USERS),
        {
          method: 'POST',
          body: { q: searchTerm, page: pageToFetch, limit: 5, currentOrganizationId: id },
        },
      );

      if (isLoadMore) {
        setSearchResults((prev) => ({ ...result, data: [...(prev?.data ?? []), ...result.data] }));
      } else {
        setSearchResults(result);
      }

      setHasMore(result.page < result.totalPages);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error);
    } finally {
      setIsSearching(false);
    }
  };

  const selectedUser = searchResults?.data.find((user) => user._id === selectedUserId);

  const addAdmin = async () => {
    if (!selectedUserId) return;
    setIsLinking(true);
    try {
      await apiFetch(endpointFor(AppFeature.ORGANIZATIONS_ADD_ADMIN), {
        method: 'POST',
        body: { organizationId: id, userId: selectedUserId },
      });
      showSuccessToast();
      await loadCurrentAdmins();
      setLinkDialogOpen(false);
      setSearchTerm('');
      setSearchResults(null);
      setSelectedUserId('');
      setHasMore(false);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      showApiErrorToast(error);
    } finally {
      setIsLinking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // Async — the setState call runs after an await, not synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCurrentAdmins();
  }, [open, loadCurrentAdmins]);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setPage(1);
      setAdmins(null);
      setAdminsLoadError(null);
      setSearchTerm('');
      setSearchResults(null);
      setSelectedUserId('');
      setHasMore(false);
      setLinkDialogOpen(false);
    }
    setOpen(newOpen);
  };

  const resetLinkDialog = (newOpen: boolean) => {
    setLinkDialogOpen(newOpen);
    if (newOpen) {
      setSearchTerm('');
      setSearchResults(null);
      setSelectedUserId('');
      setHasMore(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full md:size-8"
          title={copy.manageUsers}
        >
          <Users className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-auto">
          <ModalDataState
            isLoading={isLoadingAdmins}
            loadingMessage={copy.loading}
            errorMessage={adminsLoadError}
            hasData={Boolean(admins)}
          />
          {admins ? (
            <div className="overflow-auto">
              <DataTableOrganizationUsers
                AdminData={admins ?? { data: [], totalPages: 0, total: 0 }}
                currentPage={page}
                setPage={setPage}
                id={id}
                fetchData={loadCurrentAdmins}
                actions={
                  <Dialog open={linkDialogOpen} onOpenChange={resetLinkDialog}>
                    <DialogTrigger asChild>
                      <ActionButton action="create" size="icon" iconOnly title={linkCopy.title} />
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{linkCopy.title}</DialogTitle>
                        <DialogDescription>{linkCopy.description}</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4">
                        <div className="space-y-2">
                          <Label>{linkCopy.userRequired}</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  'w-full justify-start',
                                  !selectedUser && 'text-muted-foreground',
                                )}
                              >
                                {selectedUser
                                  ? `${selectedUser.name} · ${selectedUser.email}`
                                  : linkCopy.selectUserPlaceholder}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
                              <Command shouldFilter={false}>
                                <CommandInput
                                  placeholder={linkCopy.searchUsersPlaceholder}
                                  value={searchTerm}
                                  onValueChange={(value) => {
                                    setSearchTerm(value);
                                    setSelectedUserId('');
                                    setSearchResults(null);
                                    setHasMore(false);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') void handleSearch(false);
                                  }}
                                />
                                <CommandList>
                                  <CommandEmpty>
                                    {isSearching
                                      ? commonCopy.searching
                                      : searchResults
                                        ? linkCopy.noUserFound
                                        : linkCopy.searchHint}
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {(searchResults?.data ?? []).map((user) => (
                                      <CommandItem
                                        key={user._id}
                                        value={`${user.name} ${user.email}`}
                                        onSelect={() => setSelectedUserId(user._id)}
                                      >
                                        <div className="min-w-0">
                                          <p className="truncate font-medium">{user.name}</p>
                                          <p className="truncate text-xs text-muted-foreground">
                                            {user.email}
                                          </p>
                                        </div>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                              <div className="flex gap-2 border-t p-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="flex-1"
                                  disabled={!searchTerm || isSearching}
                                  onClick={() => void handleSearch(false)}
                                >
                                  {commonCopy.search}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="flex-1"
                                  disabled={!hasMore || isSearching}
                                  onClick={() => void handleSearch(true)}
                                >
                                  {commonCopy.loadMore}
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <Button
                          type="button"
                          disabled={!selectedUserId || isLinking}
                          onClick={() => void addAdmin()}
                        >
                          {commonCopy.add}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                }
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

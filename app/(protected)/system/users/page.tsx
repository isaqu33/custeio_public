import { DataTableUser } from '@/components/table-users';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { auth } from '@/app/lib/auth';
import { sessionHasSystemAccess } from '@/app/lib/authorization';
import { getUsersListForSession } from '@/app/lib/services/users';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { logPageLoadError, logPageLoadRejected } from '@/app/lib/page-logging';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { PageShell } from '@/components/page-shell';
import { UsersIcon } from 'lucide-react';
import { redirect } from 'next/navigation';

export type User = {
  done: boolean;
  data: {
    _id: string;
    organizationIds: string[];
    name: string;
    email: string;
    organizationNames: string;
    hasSystemAccess: boolean;
    disabled: boolean;
    lastSignInAt?: string;
  }[];
  total: number;
  page: number;
  totalPages: number;
};

export default async function Users(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const searchType = getSearchParamString(searchParams, 'userSearchType', 'name');
  // The organization comes from the scope bar in the page header
  // (OrganizationWorkspaceFrame), the same way audit-events does it.
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const status = getSearchParamString(searchParams, 'status', '');

  // Only System/Support may manage other accounts — grant system access, reset
  // a password, inspect — so those actions render only for them.
  const canManageUsers = await sessionHasSystemAccess(session);

  let allData: User;
  try {
    allData = await getUsersListForSession(session, {
      page,
      limit: 20,
      q: searchTerm,
      searchType,
      organizationId,
      status,
    });
  } catch (err) {
    logPageLoadError('users', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }
  if (!allData.done) {
    logPageLoadRejected('users');
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if page is empty (after delete). Every applied filter rides along,
  // otherwise deleting the last row of a filtered page silently drops the filter.
  if (allData.data.length === 0 && page > 1) {
    const params = new URLSearchParams({ page: String(page - 1) });
    if (searchTerm) {
      params.set('q', searchTerm);
      params.set('userSearchType', searchType);
    }
    if (organizationId !== 'all') params.set('organizationId', organizationId);
    if (status) params.set('status', status);
    redirect(`/system/users?${params.toString()}`);
  }

  return (
    <PageShell
      title={copy.pages.users.title}
      description={copy.pages.users.description}
      icon={UsersIcon}
    >
      <DataTableUser
        allUsers={allData.data}
        totalPages={allData.totalPages}
        total={allData.total}
        currentPage={page}
        searchTerm={searchTerm}
        searchType={searchType}
        status={status}
        canManageUsers={canManageUsers}
        currentUserId={session.user?.id ?? ''}
      ></DataTableUser>
    </PageShell>
  );
}

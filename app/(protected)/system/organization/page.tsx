import { DataTableOrganization } from '@/components/table-organization';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { auth } from '@/app/lib/auth';
import { getOrganizationsListForSession } from '@/app/lib/services/organizations';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { logPageLoadError, logPageLoadRejected } from '@/app/lib/page-logging';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { PageShell } from '@/components/page-shell';
import { Building2 } from 'lucide-react';
import { redirect } from 'next/navigation';

export type OrganizationType = {
  done: boolean;
  data: {
    _id: string;
    name: string;
    status: 'onboarding' | 'active' | 'suspended' | 'canceled';
    billingStatus: 'up_to_date' | 'past_due';
    asaasCustomerId?: string;
    hasPendingInvite: boolean;
    createdAt: string;
  }[];
  total: number;
  page: number;
  totalPages: number;
};

export default async function Organizations(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const searchType = getSearchParamString(searchParams, 'orgSearchType', 'name');

  let allData: OrganizationType;
  try {
    allData = await getOrganizationsListForSession(session, {
      page,
      limit: 20,
      q: searchTerm,
      searchType,
    });
  } catch (err) {
    logPageLoadError('organizations', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }
  if (!allData.done) {
    logPageLoadRejected('organizations');
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  // Redirect if page is empty (after delete)
  if (allData.data.length === 0 && page > 1) {
    redirect(
      `/system/organization?page=${page === 1 ? page : page - 1}${searchTerm ? `&q=${searchTerm}` : ''}`,
    );
  }

  return (
    <PageShell
      title={copy.pages.organizations.title}
      description={copy.pages.organizations.description}
      icon={Building2}
    >
      <DataTableOrganization
        allOrganizations={allData.data}
        totalPages={allData.totalPages}
        total={allData.total}
        currentPage={page}
        searchTerm={searchTerm}
        searchType={searchType}
      ></DataTableOrganization>
    </PageShell>
  );
}

import { auth } from '@/app/lib/auth';
import {
  type AppPageProps,
  getSearchParamNumber,
  getSearchParamString,
} from '@/app/lib/page-props';
import { getJobsListForSession } from '@/app/lib/services/jobs';
import type { JobsListSuccess } from '@/app/lib/types/jobs';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { logPageLoadError, logPageLoadRejected } from '@/app/lib/page-logging';
import { DataTableJobs, type Job } from '@/components/table-jobs';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { PageShell } from '@/components/page-shell';
import { BriefcaseBusiness } from 'lucide-react';
import { redirect } from 'next/navigation';

export default async function JobsPage(props: AppPageProps) {
  const session = await auth();
  if (!session) redirect('/login');
  // Access is already enforced by app/(protected)/system/layout.tsx
  // (requireSystemAccess) — this page needs no guard of its own.
  const copy = await getServerCopyForSession(session);
  const searchParams = await props.searchParams;
  const page = getSearchParamNumber(searchParams, 'page', 1);
  const searchTerm = getSearchParamString(searchParams, 'q', '');
  const searchType = getSearchParamString(searchParams, 'searchType', 'reference');
  const jobKind = getSearchParamString(searchParams, 'kind', 'all');
  const organizationId = getSearchParamString(searchParams, 'organizationId', 'all');
  const dateFrom = getSearchParamString(searchParams, 'dateFrom', '');
  const dateTo = getSearchParamString(searchParams, 'dateTo', '');

  let jobsData: JobsListSuccess;
  try {
    jobsData = await getJobsListForSession(session, {
      page,
      limit: 20,
      q: searchTerm,
      searchType,
      kind: jobKind,
      organizationId,
      dateFrom,
      dateTo,
    });
  } catch (err) {
    logPageLoadError('jobs', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  if (!jobsData.done) {
    logPageLoadRejected('jobs');
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  if (jobsData.data.length === 0 && page > 1) {
    const params = new URLSearchParams();
    params.set('page', String(page === 1 ? page : page - 1));
    if (searchTerm) params.set('q', searchTerm);
    if (searchType) params.set('searchType', searchType);
    if (jobKind && jobKind !== 'all') params.set('kind', jobKind);
    if (organizationId && organizationId !== 'all') params.set('organizationId', organizationId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    redirect(`/system/jobs?${params.toString()}`);
  }

  return (
    <PageShell
      title={copy.pages.jobs.title}
      description={copy.pages.jobs.description}
      icon={BriefcaseBusiness}
    >
      <DataTableJobs
        jobs={jobsData.data as Job[]}
        totalPages={jobsData.totalPages}
        total={jobsData.total}
        currentPage={page}
        searchTerm={searchTerm}
        searchType={searchType}
        jobKind={jobKind}
        dateFrom={dateFrom}
        dateTo={dateTo}
        // Every viewer who reaches this page is System/Support (the parent
        // layout guards it), so the platform-only CSV reports are always
        // in scope here.
        canManageSystemJobs
      />
    </PageShell>
  );
}

import { auth } from '@/app/lib/auth';
import { getServerCopyForSession } from '@/app/lib/i18n/server';
import { logPageLoadError } from '@/app/lib/page-logging';
import { getCronsOverview, type CronsOverview } from '@/app/lib/services/crons-overview';
import { STANDARD_PAGE_ERROR_MESSAGE } from '@/app/lib/ui-messages';
import { CronsPanel } from '@/components/crons-panel';
import { PageShell } from '@/components/page-shell';
import { Clock } from 'lucide-react';
import { redirect } from 'next/navigation';

export default async function CronsPage() {
  const session = await auth();
  if (!session) redirect('/login');
  // Access is already enforced by app/(protected)/system/layout.tsx
  // (requireSystemAccess) — this page needs no guard of its own.
  const copy = await getServerCopyForSession(session);

  let overview: CronsOverview;
  try {
    overview = await getCronsOverview();
  } catch (err) {
    logPageLoadError('crons', err);
    return <div className="p-8 text-destructive">{STANDARD_PAGE_ERROR_MESSAGE}</div>;
  }

  return (
    <PageShell
      title={copy.pages.crons.title}
      description={copy.pages.crons.description}
      icon={Clock}
    >
      <CronsPanel overview={overview} />
    </PageShell>
  );
}

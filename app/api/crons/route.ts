import { NextResponse } from 'next/server';
import { requireSystemAccess } from '@/app/lib/authorization';
import { requireAuth } from '@/app/lib/errors';
import { AppFeature } from '@/app/lib/features';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { getCronsOverview } from '@/app/lib/services/crons-overview';

/** What is scheduled: the worker's recurring tasks and every store's automatic SEFAZ search. */
export const GET = withObservability<{}>(AppFeature.CRONS_GET_ALL, async () => {
  const session = await requireAuth();
  // Platform administration (System > Crons). Repeated here because the layout
  // guard shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  return NextResponse.json(
    { done: true, data: await getCronsOverview(), message: 'OK' },
    { status: HttpStatus.OK },
  );
});

import { AppFeature } from '@/app/lib/features';
import {
  getAuthorizedOrganizationIds,
  requireSessionUser,
  requireSystemAccess,
} from '@/app/lib/authorization';
import { HttpStatus } from '@/app/lib/http-status';
import { BadRequestError, requireAuth } from '@/app/lib/errors';
import { createAndEnqueueJob } from '@/app/lib/jobs/service';
import { withObservability } from '@/app/lib/observability';
import { z } from 'zod';
import { NextResponse } from 'next/server';

const createAdhocJobSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('users.export.csv') }),
  z.object({ kind: z.literal('organizations.export.csv') }),
]);

const adhocConfig = {
  attempts: 1,
  backoff: { type: 'fixed' as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 1000,
};

export const POST = withObservability<{}>(AppFeature.JOBS_CREATE, async (req, _ctx, { log }) => {
  const session = await requireAuth();
  // Every kind this route can queue is a platform report: the accounts CSV and
  // the organizations CSV span every organization the requester can reach plus
  // the users who belong to none. No group grants this — see
  // `app/lib/jobs/system-only-kinds.ts`.
  await requireSystemAccess(session);
  const sessionWithUser = requireSessionUser(session);
  const input = createAdhocJobSchema.parse(await req.json());

  const authorizedOrganizationIds = await getAuthorizedOrganizationIds(session);
  if (authorizedOrganizationIds.length === 0) {
    throw new BadRequestError('No authorized organizations found for this user.');
  }

  const firstOrganizationId = authorizedOrganizationIds[0];
  if (!firstOrganizationId) {
    throw new BadRequestError('No authorized organization available.');
  }
  const referencePrefix = {
    'users.export.csv': 'ADHOC-USERS-EXPORT',
    'organizations.export.csv': 'ADHOC-ORGANIZATIONS-EXPORT',
  }[input.kind];
  const reference = `${referencePrefix}-${Date.now()}`;

  const created = await createAndEnqueueJob(
    {
      kind: input.kind,
      organizationId: firstOrganizationId,
      reference,
      type: 'AdHoc',
      config: adhocConfig,
      payload: {
        requestedByUserId: sessionWithUser.user.id,
        authorizedOrganizationIds,
      },
    },
    log,
  );

  return NextResponse.json(
    {
      done: true,
      message: 'Ad-hoc job created successfully.',
      data: created,
    },
    { status: HttpStatus.CREATED },
  );
});

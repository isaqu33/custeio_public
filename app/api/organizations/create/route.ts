import { AppFeature } from '@/app/lib/features';
import { requireSessionUser, requireSystemAccess } from '@/app/lib/authorization';
import { parseRouteInput } from '@/app/lib/api-route';
import { HttpStatus } from '@/app/lib/http-status';
import connectDB from '@/app/lib/connect-db';
import { requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { createOrganization } from '@/app/lib/validations';
import OrganizationDB from '@/app/models/organizations';
import UsersDB from '@/app/models/users';
import { NextResponse } from 'next/server';

export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_CREATE, async (req) => {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);
  const sessionWithUser = requireSessionUser(session);

  // .parse() throws ZodError on invalid input; the withObservability
  // wrapper turns that into a 400 with the first issue's message.
  const { name } = await parseRouteInput(req, createOrganization);

  await connectDB();

  const newOrganization = await OrganizationDB.create({
    name,
    // `inviteToken` is not set here — it's generated on demand from the
    // organizations table (see /api/organizations/invite-token), only when
    // the salesperson is actually ready to hand the account off.
  });

  await UsersDB.updateOne(
    { _id: sessionWithUser.user.id },
    { $addToSet: { organizationIds: newOrganization._id } },
  );

  return NextResponse.json(
    {
      done: true,
      message: 'Organization created successfully.',
      data: { organizationId: newOrganization._id },
    },
    { status: HttpStatus.CREATED },
  );
});

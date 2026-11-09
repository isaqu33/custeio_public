import { AppFeature } from '@/app/lib/features';
import type { LeanDoc } from '@/app/lib/mongoose-types';
import { HttpStatus } from '@/app/lib/http-status';
import connectDB from '@/app/lib/connect-db';
import { protectedAccountFilter } from '@/app/lib/protected-account';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess, requireSystemAccess } from '@/app/lib/authorization';
import { BadRequestError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { totalPages } from '@/app/lib/pagination';
import { hasHumanSystemAccess, type SystemLevel } from '@/app/lib/system-levels';
import OrganizationDB from '@/app/models/organizations';
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import UsersDB from '../../../models/users';

const getOrganizationAdminsQuerySchema = z.object({
  id: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

async function handler(req: Request) {
  const session = await requireAuth();
  // Platform administration: the pages this backs all live under `/system`,
  // which is System/Support only. Repeated here because the layout guard
  // shapes the UI and this shapes the request.
  await requireSystemAccess(session);

  const { id, page, limit } = await parseRouteInput(req, getOrganizationAdminsQuerySchema);
  const skip = (page - 1) * limit;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BadRequestError('Invalid organization ID.');
  }

  await connectDB();

  // Who is linked to an organization is that tenant's data — scope it.
  await requireOrganizationAccess(session, id);

  const organizationObjectId = new mongoose.Types.ObjectId(`${id}`);
  const organizationExists = await OrganizationDB.exists({ _id: organizationObjectId });

  if (!organizationExists) throw new NotFoundError('Organization not found.');

  const query = { organizationIds: organizationObjectId, ...protectedAccountFilter() };

  const [linkedUsers, total] = await Promise.all([
    UsersDB.find(query)
      .select('name email systemLevel')
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UsersDB.countDocuments(query),
  ]);

  return NextResponse.json(
    {
      data: linkedUsers.map((doc: LeanDoc) => ({
        ...doc,
        _id: String(doc._id),
        // Flags a user who reaches every organization through System/Support
        // access regardless of this link. Without it a row looks like an
        // ordinary member when it is anything but.
        bypassesOrganizationScope: hasHumanSystemAccess(
          doc.systemLevel as SystemLevel[] | undefined,
        ),
      })),
      total,
      page,
      totalPages: totalPages(total, limit),
      done: true,
      message: 'OK',
    },
    { status: HttpStatus.OK },
  );
}

export const GET = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_ADMINS, handler);
export const POST = withObservability<{}>(AppFeature.ORGANIZATIONS_GET_ADMINS, handler);
